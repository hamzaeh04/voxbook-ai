import { create } from 'zustand'
import type { SharedBook, SharedChapter, SharedNarration, VoiceSettings } from '@shared/types'
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
/** Chapter bundles: one upload per ~3 MB of text (most books are a single bundle). */
const BUNDLE_CHARS = 2_500_000

/** Group chapters into as few uploads as possible (Blob writes are metered). */
export function bundleChapters(chapters: SharedChapter[], max = BUNDLE_CHARS): SharedChapter[][] {
  const bundles: SharedChapter[][] = []
  let cur: SharedChapter[] = []
  let size = 0
  for (const c of chapters) {
    const len = c.text.length + (c.title?.length ?? 0) + 40
    if (cur.length && size + len > max) bundles.push(cur), (cur = []), (size = 0)
    cur.push(c)
    size += len
  }
  if (cur.length) bundles.push(cur)
  return bundles
}
const CONCURRENCY = 4

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++])
    }),
  )
}

/** Uploads running in this tab. A book marked 'uploading' but not in here was interrupted (tab closed) and is retried. */
const uploadingNow = new Set<string>()
const shareable = (b: Book) => !b.pagesMissing && b.cloud !== 'synced' && !uploadingNow.has(b.id)

function metaOf(book: Book, chapterBundles: number): Omit<SharedBook, 'updatedAt'> {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    unit: book.unit ?? 'page',
    totalPages: book.totalPages,
    createdAt: book.createdAt,
    hasCover: Boolean(book.cover),
    chapterBundles,
    scannedPages: book.scannedPages,
  }
}

/** Publish a whole book: cover, chapter bundles, then metadata last so it is never listed half-uploaded. */
export async function publishBook(bookId: string): Promise<void> {
  if (!useCloud.getState().enabled) return
  const book = await getBook(bookId)
  if (!book || book.pagesMissing || uploadingNow.has(bookId)) return
  uploadingNow.add(bookId)
  await updateBook(bookId, { cloud: 'uploading' })
  try {
    if (book.cover) await api.putSharedCover(bookId, book.cover)
    const pages = await getPages(bookId)
    const bundles = bundleChapters(pages.map((p) => ({ n: p.pageNumber, title: p.title, text: p.extractedText })))
    for (const [k, chapters] of bundles.entries()) await api.putSharedBundle(bookId, k, chapters)
    await api.putSharedBook(metaOf(book, bundles.length))
    await updateBook(bookId, { cloud: 'synced', sharedBundles: bundles.length })
  } catch (e) {
    await updateBook(bookId, { cloud: 'error' })
    useCloud.setState({ error: `Could not share “${book.title}”: ${errorMessage(e)}` })
  } finally {
    uploadingNow.delete(bookId)
  }
}

/** Push a title/author change for everyone. */
export async function publishMeta(bookId: string) {
  const book = await getBook(bookId)
  if (!useCloud.getState().enabled || !book || book.cloud !== 'synced' || !book.sharedBundles) return
  await api.putSharedBook(metaOf(book, book.sharedBundles)).catch(() => updateBook(bookId, { cloud: 'pending' }))
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
          sharedBundles: shared.chapterBundles,
        }
        await putBook(book)
      } else if (mine.cloud === 'synced' && (mine.title !== shared.title || mine.author !== shared.author)) {
        await updateBook(shared.id, { title: shared.title, author: shared.author }) // renamed by someone
      }
    }
    const deleted = new Set(remote.deleted ?? [])
    for (const book of local.values()) {
      if (remoteIds.has(book.id)) continue
      if (deleted.has(book.id) || book.pagesMissing) {
        // Deleted for everyone on purpose (or a listing we never downloaded): remove this copy.
        await deleteBook(book.id)
        local.delete(book.id)
      } else if (book.cloud === 'synced') {
        // Missing without a deletion record (e.g. storage was reset): share it again from here.
        await updateBook(book.id, { cloud: 'pending' })
        local.set(book.id, { ...book, cloud: 'pending' })
      }
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
    const bundles = Array.from({ length: book.sharedBundles ?? 1 }, (_, k) => k)
    await mapLimit(bundles, CONCURRENCY, async (k) => {
      for (const c of await api.sharedBundle(bookId, k)) {
        pages.push({ id: pageId(bookId, c.n), bookId, pageNumber: c.n, extractedText: c.text, title: c.title, bookmarked: false, narrationStatus: 'none' })
      }
      set(pages.length)
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

const manifestCache = new Map<string, { at: number; manifest: SharedNarration | null }>()

/** The shared manifest for one chapter (a single cheap read; cached briefly). */
async function sharedManifest(bookId: string, n: number): Promise<SharedNarration | null> {
  const key = `${bookId}:${n}`
  const hit = manifestCache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return hit.manifest
  const manifest = await api.sharedNarration(bookId, n)
  manifestCache.set(key, { at: Date.now(), manifest })
  return manifest
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
    const m = await sharedManifest(args.bookId, args.pageNumber)
    if (!m || m.voiceId !== args.voiceId || m.style !== args.settings.style || m.textHash !== args.textHash || (engine && m.engine !== engine)) return null
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
    manifestCache.delete(`${n.bookId}:${n.pageNumber}`)
  } catch {
    /* sharing audio is best-effort; the local copy still plays */
  }
}
