import { create } from 'zustand'
import { DocumentError } from '@/lib/documents/errors'
import { importFile, runOcrForBook, type ImportPhase } from '@/lib/documents'
import { StorageFullError } from '@/lib/db'
import { detectFormat } from '@/lib/documents/validate'
import { useSettings } from './settings'
import { toast } from './toasts'

export interface UploadItem {
  id: string
  name: string
  type: string
  size: number
  status: 'queued' | ImportPhase | 'error'
  fraction?: number
  detail?: string
  error?: string
  bookId?: string
  scannedPages?: number
  file?: File
}

export interface OcrState {
  status: 'running' | 'done' | 'error' | 'cancelled'
  done: number
  total: number
  page: number
  pageProgress: number
  message?: string
}

interface UploadStore {
  items: UploadItem[]
  ocr: Record<string, OcrState>
  enqueue: (files: File[]) => void
  dismiss: (id: string) => void
  retry: (id: string) => void
  clearFinished: () => void
  startOcr: (bookId: string) => Promise<void>
  cancelOcr: (bookId: string) => void
}

const controllers = new Map<string, AbortController>()
let running = false

export async function checkStorage(extraBytes: number): Promise<string | null> {
  try {
    const est = await navigator.storage?.estimate?.()
    if (est?.quota && est.usage !== undefined && est.usage + extraBytes * 3 > est.quota * 0.95) {
      return 'Browser storage is nearly full. Remove some books or recordings before importing more.'
    }
  } catch {
    /* estimate unavailable */
  }
  return null
}

export const useUploads = create<UploadStore>((set, get) => {
  const patch = (id: string, p: Partial<UploadItem>) => set({ items: get().items.map((i) => (i.id === id ? { ...i, ...p } : i)) })

  async function pump() {
    if (running) return
    running = true
    try {
      for (;;) {
        const next = get().items.find((i) => i.status === 'queued')
        if (!next?.file) break
        try {
          const full = await checkStorage(next.size)
          if (full) throw new StorageFullError()
          void navigator.storage?.persist?.()
          const res = await importFile(next.file, (p) => patch(next.id, { status: p.phase, fraction: p.fraction, detail: p.detail }), { maxBytes: useSettings.getState().maxFileMB * 1048576 })
          patch(next.id, { status: 'done', bookId: res.book.id, scannedPages: res.scannedPages.length, file: undefined, fraction: 1 })
        } catch (e) {
          const msg = e instanceof DocumentError || e instanceof StorageFullError ? e.message : 'Something went wrong while processing this file.'
          if (!(e instanceof DocumentError) && !(e instanceof StorageFullError)) console.error('[import]', e)
          patch(next.id, { status: 'error', error: msg })
        }
      }
    } finally {
      running = false
    }
  }

  return {
    items: [],
    ocr: {},
    enqueue: (files) => {
      const items: UploadItem[] = files.map((file) => ({
        id: crypto.randomUUID(),
        name: file.name,
        type: (detectFormat(file.name) ?? file.name.split('.').pop() ?? 'file').toUpperCase(),
        size: file.size,
        status: 'queued',
        file,
      }))
      set({ items: [...get().items, ...items] })
      void pump()
    },
    dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) }),
    retry: (id) => {
      patch(id, { status: 'queued', error: undefined, fraction: undefined })
      void pump()
    },
    clearFinished: () => set({ items: get().items.filter((i) => i.status !== 'done' && i.status !== 'error') }),
    startOcr: async (bookId) => {
      const setOcr = (o: Partial<OcrState>) => set({ ocr: { ...get().ocr, [bookId]: { ...({ status: 'running', done: 0, total: 0, page: 0, pageProgress: 0 } as OcrState), ...get().ocr[bookId], ...o } } })
      const ctl = new AbortController()
      controllers.set(bookId, ctl)
      setOcr({ status: 'running', done: 0, page: 0, pageProgress: 0, message: undefined })
      try {
        const res = await runOcrForBook(bookId, {
          language: useSettings.getState().ocrLanguage,
          signal: ctl.signal,
          onProgress: (p) => setOcr({ status: 'running', done: p.done, total: p.total, page: p.page, pageProgress: p.pageProgress }),
        })
        setOcr({ status: 'done', message: `${res.recognised} page(s) recognised${res.empty ? `, ${res.empty} had no readable text` : ''}.` })
        toast.success('OCR finished. The recognised text is ready to read and narrate.')
      } catch (e) {
        if (e instanceof DocumentError && e.code === 'cancelled') setOcr({ status: 'cancelled', message: 'OCR cancelled. Pages already processed were not saved.' })
        else setOcr({ status: 'error', message: e instanceof Error ? e.message : 'OCR failed.' })
      } finally {
        controllers.delete(bookId)
      }
    },
    cancelOcr: (bookId) => controllers.get(bookId)?.abort(),
  }
})
