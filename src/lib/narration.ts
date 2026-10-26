import { create } from 'zustand'
import type { VoiceInfo, VoiceSettings } from '@shared/types'
import { splitForTts } from '@shared/chunk'
import { api, ApiClientError, type GeneratedAudio } from './api'
import { readDuration } from './audioMeta'
import { getNarration, getPage, putNarration } from './db'
import type { Narration, Page } from './types'
import { hashText, markupToPlain, pageId } from './utils'
import { useConsent } from '@/stores/consent'
import { fetchSharedNarration, publishNarration } from './cloud'
import { useVoices } from '@/stores/voices'

export interface JobState {
  state: 'queued' | 'generating' | 'error'
  error?: { code: string; message: string; retryable: boolean }
}

/** Live (non-persisted) generation state per page, keyed `${bookId}:${page}`. */
export const useJobs = create<{ jobs: Record<string, JobState>; set: (key: string, s?: JobState) => void }>((set, get) => ({
  jobs: {},
  set: (key, s) => {
    const jobs = { ...get().jobs }
    if (s) jobs[key] = s
    else delete jobs[key]
    set({ jobs })
  },
}))

export class NoTextError extends Error {
  constructor() {
    super('This page has no text to narrate. If it is a scanned page, run OCR first.')
  }
}
export class ConsentDeniedError extends Error {
  constructor() {
    super('Narration needs your permission to send page text to the TTS provider.')
  }
}

export interface GenerateArgs {
  bookId: string
  bookTitle?: string
  pageNumber: number
  voice: VoiceInfo
  settings: VoiceSettings
  /** Regenerate even if current audio exists. */
  force?: boolean
}

/** True when stored audio matches the page text and the requested voice configuration. */
export function narrationIsCurrent(n: Narration | undefined, page: Pick<Page, 'extractedText'> | undefined, voiceId: string, settings: VoiceSettings): boolean {
  if (!n || !page) return false
  // Audio from an older engine version (e.g. before an emotion-engine fix) is regenerated.
  const engine = useVoices.getState().provider?.engineVersion
  if (engine && n.engine !== engine) return false
  return n.voiceId === voiceId && n.voiceSettings.style === settings.style && n.textHash === hashText(markupToPlain(page.extractedText))
}

/**
 * Serial queue with de-duplication: requesting audio for a page/voice that is already
 * queued or running returns the same promise instead of issuing a second billable request.
 */
class GenerationQueue {
  private inflight = new Map<string, { promise: Promise<Narration>; controller: AbortController }>()
  private chain: Promise<unknown> = Promise.resolve()

  enqueue(dedupeKey: string, jobKey: string, run: (signal: AbortSignal) => Promise<Narration>): Promise<Narration> {
    const existing = this.inflight.get(dedupeKey)
    if (existing) return existing.promise
    const controller = new AbortController()
    useJobs.getState().set(jobKey, { state: 'queued' })
    const promise = this.chain.then(async () => {
      if (controller.signal.aborted) throw new ApiClientError('aborted', 'Generation cancelled.')
      useJobs.getState().set(jobKey, { state: 'generating' })
      // Race against abort so a cancelled page never blocks the queue, even if the request lingers.
      // A lingering request still finishes and is stored against its own page, so nothing is wasted.
      const work = run(controller.signal)
      work.catch(() => undefined)
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(new ApiClientError('aborted', 'Generation cancelled.')), { once: true }),
      )
      return Promise.race([work, aborted])
    })
    this.chain = promise.catch(() => undefined)
    const tracked = promise.then(
      (n) => {
        useJobs.getState().set(jobKey)
        return n
      },
      (e) => {
        if (e instanceof ApiClientError && e.code === 'aborted') useJobs.getState().set(jobKey)
        else useJobs.getState().set(jobKey, { state: 'error', error: { code: e?.code ?? 'internal', message: e?.message ?? String(e), retryable: e instanceof ApiClientError ? e.retryable : false } })
        throw e
      },
    )
    const entry = { promise: tracked, controller }
    this.inflight.set(dedupeKey, entry)
    const cleanup = () => this.inflight.delete(dedupeKey)
    tracked.then(cleanup, cleanup)
    return tracked
  }

  cancel(jobKey: string) {
    for (const [k, v] of this.inflight) if (k.startsWith(`${jobKey}|`)) v.controller.abort()
  }
}

export const queue = new GenerationQueue()

export function cancelGeneration(bookId: string, pageNumber: number) {
  queue.cancel(pageId(bookId, pageNumber))
}

/** Build the narration record from audio data. The page/voice are the ones captured at request time. */
export async function storeNarration(args: {
  bookId: string
  pageNumber: number
  voice: VoiceInfo
  settings: VoiceSettings
  textHash: string
  audio: { blob: Blob; format: 'mp3' | 'wav' }
}): Promise<Narration> {
  const id = pageId(args.bookId, args.pageNumber)
  const narration: Narration = {
    id,
    bookId: args.bookId,
    pageId: id,
    pageNumber: args.pageNumber,
    voiceId: args.voice.id,
    voiceName: args.voice.displayName,
    voiceSettings: args.settings,
    audioBlob: args.audio.blob,
    audioFormat: args.audio.format,
    duration: await readDuration(args.audio.blob),
    size: args.audio.blob.size,
    createdAt: Date.now(),
    status: 'ready',
    textHash: args.textHash,
    engine: useVoices.getState().provider?.engineVersion,
  }
  await putNarration(narration)
  return narration
}

export async function ensureConsent(): Promise<void> {
  const provider = useVoices.getState().provider
  if (!provider) throw new ApiClientError('network', 'Voice catalog not loaded yet.')
  if (!provider.configured) throw new ApiClientError('not_configured', provider.setupHint ?? 'No TTS provider is configured on the server.')
  if (!(await useConsent.getState().request(provider))) throw new ConsentDeniedError()
}

/**
 * Hosts like Vercel cap response size, so long chapters are requested in parts (sentence
 * boundaries, two at a time) and the MP3 parts are joined in order. WAV can't be joined, so the
 * mock provider always gets the whole text in one request.
 */
async function generateInParts(text: string, voiceId: string, settings: VoiceSettings, signal: AbortSignal): Promise<GeneratedAudio> {
  const provider = useVoices.getState().provider
  const max = provider?.maxCharsPerGenerate
  const parts = max && provider?.audioFormat === 'mp3' ? splitForTts(text, max) : [text]
  if (parts.length <= 1) return api.generate({ text, voiceId, settings }, signal)
  const results: GeneratedAudio[] = new Array(parts.length)
  let next = 0
  const worker = async () => {
    while (next < parts.length) {
      const i = next++
      results[i] = await api.generate({ text: parts[i], voiceId, settings }, signal)
    }
  }
  await Promise.all([worker(), worker()])
  return { ...results[0], blob: new Blob(results.map((r) => r.blob), { type: 'audio/mpeg' }), cached: results.every((r) => r.cached) }
}

export async function generateForPage(args: GenerateArgs): Promise<Narration> {
  const { bookId, pageNumber, voice, settings } = args
  const jobKey = pageId(bookId, pageNumber)
  const page = await getPage(bookId, pageNumber)
  if (!page) throw new Error(`Page ${pageNumber} not found`)
  const text = markupToPlain(page.extractedText)
  if (!text) throw new NoTextError()
  const textHash = hashText(text)

  if (!args.force) {
    const existing = await getNarration(bookId, pageNumber)
    if (existing && narrationIsCurrent(existing, page, voice.id, settings)) return existing
  }

  // Someone may already have generated this chapter with the same voice and style: reuse it.
  if (!args.force) {
    const shared = await fetchSharedNarration({ bookId, pageNumber, voiceId: voice.id, settings, textHash })
    if (shared) return shared
  }

  await ensureConsent()
  const dedupeKey = `${jobKey}|${voice.id}|${settings.style}|${textHash}`
  return queue.enqueue(dedupeKey, jobKey, async (signal) => {
    // Only this chapter's text is sent — never the whole book.
    const audio = await generateInParts(text, voice.id, settings, signal)
    const narration = await storeNarration({ bookId, pageNumber, voice, settings, textHash, audio })
    void publishNarration(narration) // share it so nobody has to generate this chapter again
    return narration
  })
}
