import { create } from 'zustand'
import type { SharedBook, SharedNarration, VoiceSettings } from '@shared/types'
import { api, errorMessage } from './api'
import { deleteBook, getBook, getPages, listBooks, putBook, putNarration, saveImportedBook, updateBook } from './db'
import type { Book, Narration, Page } from './types'
import { pageId } from './utils'
import { useVoices } from '@/stores/voices'

/**
 * Shared library sync. The app still reads from this browser's IndexedDB; this module mirrors it:
 *  - books uploaded here are published to the server for everyone,
 *  - books published by anyone appear here (chapter text downloads when first opened),
 *  - generated chapter audio is published, and reused instead of regenerating it,
 *  - renames and deletions apply for everyone.
 * Reading position, bookmarks, history and settings stay per browser.
 */

interface CloudState {
  /** undefined until the first check */
  enabled?: boolean
  reason?: string
  syncing: boolean
  lastSync?: number
  error?: string
  /** bookId → chapter-download progress while opening a shared book */
  downloads: Record<string, { done: number; total: number }>
}

export const useCloud = create<CloudState>(() => ({ syncing: false, downloads: {} }))

/** Stay well under Vercel's 4.5 MB request-body limit. */
const PART_BYTES = 3_500_000
const CONCURRENCY = 4

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

const shareable = (b: Book) => !b.pagesMissing && b.cloud !== 'synced' && b.cloud !== 'uploading'

function metaOf(book: Book): Omit<SharedBook, 'updatedAt'> {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    unit: book.unit ?? 'page',
    totalPages: book.totalPages,
    createdAt: book.createdAt,
    hasCover: Boolean(book.cover),
    scannedPages: book.scannedPages,
  }
}

/** Publish a whole book (metadata, cover, every chapter). Metadata goes last so it is never listed half-uploaded. */
export async function publishBook(bookId: string): Promise<void> {
  if (!useCloud.getState().enabled) return
  const book = await getBook(bookId)
  if (!book || book.pagesMissing) return
  await updateBook(bookId, { cloud: 'uploading' })
  try {
    if (book.cover) await api.putSharedCover(bookId, book.cover)
    const pages = await getPages(bookId)
    await mapLimit(pages, CONCURRENCY, (p) => api.putSharedChapter(bookId, p.pageNumber, { title: p.title, text: p.extractedText }))
    await api.putSharedBook(metaOf(book))
    await updateBook(bookId, { cloud: 'synced' })
  } catch (e) {
    await updateBook(bookId, { cloud: 'error' })
    useCloud.setState({ error: `Could not share “${book.title}”: ${errorMessage(e)}` })
  }
}

/** Push a title/author change for everyone. */
export async function publishMeta(bookId: string) {
  const book = await getBook(bookId)
  if (!useCloud.getState().enabled || !book || book.cloud !== 'synced') return
  await api.putSharedBook(metaOf(book)).catch(() => updateBook(bookId, { cloud: 'pending' }))
}

/** Delete for everyone (shared copy first, then this browser's copy). */
export async function deleteEverywhere(bookId: string) {
  const book = await getBook(bookId)
  if (useCloud.getState().enabled && book && (book.cloud === 'synced' || book.pagesMissing)) await api.deleteSharedBook(bookId)
  await deleteBook(bookId)
}

let syncing: Promise<void> | null = null

/** Pull everyone's books and push this browser's unshared ones. Safe to call often. */
export function syncLibrary(): Promise<void> {
  syncing ??= runSync().finally(() => (syncing = null))
  return syncing
}

async function runSync() {
  useCloud.setState({ syncing: true })
  try {
    const remote = await api.library()
    if (!remote.enabled) {
      useCloud.setState({ enabled: false, reason: remote.reason, syncing: false })
      return
    }
    useCloud.setState({ enabled: true, reason: undefined, error: undefined })
    const local = new Map((await listBooks()).map((b) => [b.id, b]))
    const remoteIds = new Set(remote.books.map((b) => b.id))

    for (const shared of remote.books) {
      const mine = local.get(shared.id)
      if (!mine) {
        // Someone else's book: list it now, download its chapters when it is opened.
        let cover: Blob | undefined
        if (shared.hasCover) cover = await api.sharedCover(shared.id).catch(() => undefined)
        const book: Book = {
          id: shared.id,
          title: shared.title,
          author: shared.author,
          format: shared.format,
          unit: shared.unit,
          totalPages: shared.totalPages,
          createdAt: shared.createdAt,
          cover,
          lastOpenedAt: 0,
          lastReadPage: 1,
          readingProgress: 0,
          completedPages: [],
          fileSize: 0,
          scannedPages: shared.scannedPages,
          cloud: 'synced',
          pagesMissing: true,
        }
        await putBook(book)
      } else if (mine.cloud === 'synced' && (mine.title !== shared.title || mine.author !== shared.author)) {
        await updateBook(shared.id, { title: shared.title, author: shared.author }) // renamed by someone
      }
    }
    for (const book of local.values()) {
      // Shared before but gone from the server: someone deleted it for everyone.
      if ((book.cloud === 'synced' || book.pagesMissing) && !remoteIds.has(book.id)) await deleteBook(book.id)
    }
    for (const book of local.values()) if (shareable(book)) await publishBook(book.id)
    useCloud.setState({ lastSync: Date.now() })
  } catch (e) {
    useCloud.setState({ error: `Shared library unavailable: ${errorMessage(e)}` })
  } finally {
    useCloud.setState({ syncing: false })
  }
}

/** Download a shared book's chapter text the first time it is opened in this browser. */
export async function ensureBookContent(bookId: string): Promise<void> {
  const book = await getBook(bookId)
  if (!book?.pagesMissing) return
  const set = (done: number) => useCloud.setState((s) => ({ downloads: { ...s.downloads, [bookId]: { done, total: book.totalPages } } }))
  set(0)
  try {
    const pages: Page[] = []
    let done = 0
    const numbers = Array.from({ length: book.totalPages }, (_, i) => i + 1)
    await mapLimit(numbers, 6, async (n) => {
      const c = await api.sharedChapter(bookId, n)
      pages.push({ id: pageId(bookId, n), bookId, pageNumber: n, extractedText: c.text, title: c.title, bookmarked: false, narrationStatus: 'none' })
      set(++done)
    })
    await saveImportedBook({ ...book, pagesMissing: false }, pages)
  } finally {
    useCloud.setState((s) => {
      const downloads = { ...s.downloads }
      delete downloads[bookId]
      return { downloads }
    })
  }
}

// ---- shared narration ----

const manifestCache = new Map<string, { at: number; list: SharedNarration[] }>()

async function sharedManifests(bookId: string): Promise<SharedNarration[]> {
  const hit = manifestCache.get(bookId)
  if (hit && Date.now() - hit.at < 30_000) return hit.list
  const list = await api.sharedNarrations(bookId)
  manifestCache.set(bookId, { at: Date.now(), list })
  return list
}

/**
 * If someone already published audio for this chapter with the same voice, style, text and engine,
 * download it instead of generating it again (no text is sent to the voice service).
 */
export async function fetchSharedNarration(args: { bookId: string; pageNumber: number; voiceId: string; settings: VoiceSettings; textHash: string }): Promise<Narration | null> {
  if (!useCloud.getState().enabled) return null
  const book = await getBook(args.bookId)
  if (book?.cloud !== 'synced') return null
  const engine = useVoices.getState().provider?.engineVersion
  try {
    const m = (await sharedManifests(args.bookId)).find(
      (x) => x.pageNumber === args.pageNumber && x.voiceId === args.voiceId && x.style === args.settings.style && x.textHash === args.textHash && (!engine || x.engine === engine),
    )
    if (!m) return null
    const parts: Blob[] = []
    for (let k = 0; k < m.parts; k++) parts.push(await api.sharedNarrationPart(args.bookId, args.pageNumber, k, m.version))
    const id = pageId(args.bookId, args.pageNumber)
    const narration: Narration = {
      id,
      bookId: args.bookId,
      pageId: id,
      pageNumber: args.pageNumber,
      voiceId: m.voiceId,
      voiceName: m.voiceName,
      voiceSettings: { style: m.style },
      audioBlob: new Blob(parts, { type: m.format === 'wav' ? 'audio/wav' : 'audio/mpeg' }),
      audioFormat: m.format,
      duration: m.duration,
      size: m.size,
      createdAt: m.createdAt,
      status: 'ready',
      textHash: m.textHash,
      engine: m.engine,
      shared: true,
    }
    await putNarration(narration)
    return narration
  } catch {
    return null // fall back to generating it
  }
}

/** Publish freshly generated chapter audio so nobody has to generate it again. Runs in the background. */
export async function publishNarration(n: Narration): Promise<void> {
  if (!useCloud.getState().enabled || n.shared) return
  const book = await getBook(n.bookId)
  if (book?.cloud !== 'synced') return
  try {
    const version = Math.random().toString(36).slice(2, 12).padEnd(10, '0')
    const parts = Math.max(1, Math.ceil(n.audioBlob.size / PART_BYTES))
    for (let k = 0; k < parts; k++) await api.putSharedNarrationPart(n.bookId, n.pageNumber, k, version, n.audioBlob.slice(k * PART_BYTES, (k + 1) * PART_BYTES))
    await api.publishSharedNarration(n.bookId, n.pageNumber, {
      pageNumber: n.pageNumber,
      voiceId: n.voiceId,
      voiceName: n.voiceName,
      style: n.voiceSettings.style,
      engine: n.engine,
      format: n.audioFormat,
      duration: n.duration,
      size: n.size,
      createdAt: n.createdAt,
      textHash: n.textHash,
      parts,
      version,
    })
    manifestCache.delete(n.bookId)
  } catch {
    /* sharing audio is best-effort; the local copy still plays */
  }
}
