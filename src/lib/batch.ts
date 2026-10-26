import { create } from 'zustand'
import type { BatchItemState, VoiceInfo, VoiceSettings } from '@shared/types'
import { api, ApiClientError, errorMessage } from './api'
import { deleteMeta, getBatchRecord, getNarration, getPages, listBooks, setMeta } from './db'
import { publishNarration } from './cloud'
import { ensureConsent, generateForPage, narrationIsCurrent, storeNarration } from './narration'
import type { BatchRecord } from './types'
import { hashText, markupToPlain } from './utils'
import { useVoices } from '@/stores/voices'

export interface BatchProgress {
  bookId: string
  jobId?: string
  total: number
  done: number
  failed: number
  status: 'starting' | 'running' | 'done' | 'cancelled' | 'failed' | 'error'
  message?: string
  errors: { page: number; message: string }[]
}

export const useBatches = create<{ batches: Record<string, BatchProgress>; set: (bookId: string, p?: Partial<BatchProgress>) => void }>((set, get) => ({
  batches: {},
  set: (bookId, p) => {
    const batches = { ...get().batches }
    if (!p) delete batches[bookId]
    else batches[bookId] = { ...(batches[bookId] ?? { bookId, total: 0, done: 0, failed: 0, status: 'starting', errors: [] }), ...p }
    set({ batches })
  },
}))

const pollers = new Map<string, { stop: boolean }>()
/** Batches run by the browser itself (serverless hosts can't keep background jobs alive). */
const localRuns = new Map<string, { cancelled: boolean }>()

/** Pages that still need audio for this voice config (resuming skips finished pages). */
export async function pagesNeedingAudio(bookId: string, voiceId: string, settings: VoiceSettings) {
  const pages = await getPages(bookId)
  const out: { pageNumber: number; text: string }[] = []
  for (const p of pages) {
    const text = markupToPlain(p.extractedText)
    if (!text) continue
    const existing = await getNarration(bookId, p.pageNumber)
    if (narrationIsCurrent(existing, p, voiceId, settings)) continue
    out.push({ pageNumber: p.pageNumber, text })
  }
  return out
}

export async function startBatch(bookId: string, voice: VoiceInfo, settings: VoiceSettings): Promise<void> {
  if (pollers.has(bookId) || localRuns.has(bookId)) return
  useBatches.getState().set(bookId, { status: 'starting', done: 0, failed: 0, total: 0, errors: [], message: undefined })
  try {
    await ensureConsent()
    const todo = await pagesNeedingAudio(bookId, voice.id, settings)
    if (!todo.length) {
      useBatches.getState().set(bookId, { status: 'done', total: 0, done: 0, message: 'Every page already has up-to-date narration.' })
      return
    }
    if (useVoices.getState().provider?.serverJobs === false) return await runLocalBatch(bookId, voice, settings, todo.map((t) => t.pageNumber))
    const { jobId } = await api.createBatch({ voiceId: voice.id, settings, items: todo.map((t) => ({ key: String(t.pageNumber), text: t.text })) })
    const record: BatchRecord = { bookId, jobId, voiceId: voice.id, settings, pages: todo.map((t) => t.pageNumber), startedAt: Date.now() }
    await setMeta(`batch:${bookId}`, record)
    void poll(record, voice)
  } catch (e) {
    useBatches.getState().set(bookId, { status: 'error', message: errorMessage(e) })
  }
}

async function saveItem(record: BatchRecord, voice: VoiceInfo, item: BatchItemState) {
  const pageNumber = Number(item.key)
  const pages = await getPages(record.bookId)
  const page = pages.find((p) => p.pageNumber === pageNumber)
  if (!page || !item.narrationId) return
  const audio = await api.fetchAudio(item.narrationId)
  const narration = await storeNarration({
    bookId: record.bookId,
    pageNumber,
    voice,
    settings: record.settings,
    textHash: hashText(markupToPlain(page.extractedText)),
    audio,
  })
  void publishNarration(narration)
}

async function poll(record: BatchRecord, voice: VoiceInfo) {
  const { bookId } = record
  const ctl = { stop: false }
  pollers.set(bookId, ctl)
  const saved = new Set<string>()
  const set = useBatches.getState().set
  set(bookId, { jobId: record.jobId, status: 'running', total: record.pages.length })
  try {
    for (;;) {
      const state = await api.getBatch(record.jobId)
      const errors: BatchProgress['errors'] = []
      for (const item of state.items) {
        if (item.status === 'done' && !saved.has(item.key)) {
          try {
            await saveItem(record, voice, item)
            saved.add(item.key)
          } catch (e) {
            // storage-full etc: surface and stop instead of looping forever
            set(bookId, { status: 'error', message: errorMessage(e) })
            await api.cancelBatch(record.jobId).catch(() => undefined)
            return
          }
        }
        if (item.status === 'error') errors.push({ page: Number(item.key), message: item.error?.message ?? 'Failed' })
      }
      const settled = state.status !== 'running'
      set(bookId, { done: saved.size, failed: errors.length, errors, status: settled ? state.status : 'running', message: state.message })
      const doneOnServer = state.items.filter((i) => i.status === 'done').length
      if (settled && saved.size >= doneOnServer) break
      if (ctl.stop) break
      await new Promise((r) => setTimeout(r, 900))
    }
  } catch (e) {
    const gone = e instanceof ApiClientError && e.code === 'not_found'
    set(bookId, {
      status: 'error',
      message: gone ? 'The server no longer has this job (it restarted). Press Resume to continue with the remaining pages.' : errorMessage(e),
    })
  } finally {
    pollers.delete(bookId)
    const final = useBatches.getState().batches[bookId]
    // Keep the record while recoverable; clear when finished cleanly.
    if (final?.status === 'done' && !final.failed) await deleteMeta(`batch:${bookId}`)
  }
}

/**
 * Browser-driven batch: generates the missing chapters one after another through the normal
 * per-chapter endpoint. Keep the tab open; finished chapters are saved as they complete, so a
 * later "Resume" only does what is left.
 */
async function runLocalBatch(bookId: string, voice: VoiceInfo, settings: VoiceSettings, pages: number[]) {
  const ctl = { cancelled: false }
  localRuns.set(bookId, ctl)
  const set = useBatches.getState().set
  const errors: BatchProgress['errors'] = []
  let done = 0
  let message: string | undefined
  set(bookId, { status: 'running', total: pages.length, done: 0, failed: 0, errors: [], message: 'Generating in this browser tab: keep it open until it finishes.' })
  try {
    for (const pageNumber of pages) {
      if (ctl.cancelled) break
      try {
        await generateForPage({ bookId, pageNumber, voice, settings })
        done++
      } catch (e) {
        errors.push({ page: pageNumber, message: errorMessage(e) })
        // Quota/configuration problems will fail every remaining chapter: stop instead.
        if (e instanceof ApiClientError && (e.code === 'quota_exceeded' || e.code === 'not_configured' || e.code === 'aborted')) {
          message = e.message
          break
        }
      }
      set(bookId, { done, failed: errors.length, errors: [...errors] })
    }
  } finally {
    localRuns.delete(bookId)
    const status = message ? 'failed' : ctl.cancelled ? 'cancelled' : 'done'
    set(bookId, { status, done, failed: errors.length, errors: [...errors], message })
  }
}

export async function cancelBatch(bookId: string) {
  const local = localRuns.get(bookId)
  if (local) {
    local.cancelled = true
    return
  }
  const p = useBatches.getState().batches[bookId]
  if (p?.jobId) await api.cancelBatch(p.jobId).catch(() => undefined)
}

export async function retryFailed(bookId: string, current?: { voice: VoiceInfo; settings: VoiceSettings }) {
  // Browser-run batches have no server job to retry: start again for whatever is still missing.
  if (useVoices.getState().provider?.serverJobs === false) {
    if (current) await startBatch(bookId, current.voice, current.settings)
    return
  }
  const record = await getBatchRecord(bookId)
  const voice = useVoices.getState().voices.find((v) => v.id === record?.voiceId)
  if (!record || !voice || pollers.has(bookId)) return
  try {
    await api.retryBatch(record.jobId)
    void poll(record, voice)
  } catch {
    // job gone: fall back to a fresh batch for the remaining pages
    await startBatch(bookId, voice, record.settings)
  }
}

/** On app start: reattach to batches that were running when the page was closed. */
export async function resumeActiveBatches() {
  const voices = useVoices.getState().voices
  for (const book of await listBooks()) {
    const record = await getBatchRecord(book.id)
    const voice = voices.find((v) => v.id === record?.voiceId)
    if (!record || !voice || pollers.has(book.id)) continue
    try {
      const state = await api.getBatch(record.jobId)
      if (state.status === 'running' || state.items.some((i) => i.status === 'done')) void poll(record, voice)
      else await deleteMeta(`batch:${book.id}`)
    } catch {
      await deleteMeta(`batch:${book.id}`)
    }
  }
}
