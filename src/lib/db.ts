import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { BatchRecord, Book, HistoryEntry, MicRecording, Narration, Page } from './types'
import { pageId } from './utils'

interface VoxDB extends DBSchema {
  books: { key: string; value: Book; indexes: { lastOpenedAt: number } }
  pages: { key: string; value: Page; indexes: { bookId: string } }
  narrations: { key: string; value: Narration; indexes: { bookId: string } }
  recordings: { key: string; value: MicRecording; indexes: { bookId: string } }
  history: { key: number; value: HistoryEntry; indexes: { bookId: string; at: number } }
  files: { key: string; value: Blob }
  meta: { key: string; value: unknown }
}

let dbPromise: Promise<IDBPDatabase<VoxDB>> | null = null

export function getDb() {
  dbPromise ??= openDB<VoxDB>('voxbook', 1, {
    upgrade(db) {
      db.createObjectStore('books', { keyPath: 'id' }).createIndex('lastOpenedAt', 'lastOpenedAt')
      db.createObjectStore('pages', { keyPath: 'id' }).createIndex('bookId', 'bookId')
      db.createObjectStore('narrations', { keyPath: 'id' }).createIndex('bookId', 'bookId')
      db.createObjectStore('recordings', { keyPath: 'id' }).createIndex('bookId', 'bookId')
      const h = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true })
      h.createIndex('bookId', 'bookId')
      h.createIndex('at', 'at')
      db.createObjectStore('files')
      db.createObjectStore('meta')
    },
  })
  return dbPromise
}

/** Test helper: drop the connection so a fresh database can be created. */
export async function resetDbForTests() {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
  await new Promise<void>((res) => {
    const req = indexedDB.deleteDatabase('voxbook')
    req.onsuccess = req.onerror = req.onblocked = () => res()
  })
}

// ---- change notifications (drives useDb live queries) ----
const listeners = new Set<() => void>()
let version = 0
export const subscribeDb = (cb: () => void) => (listeners.add(cb), () => void listeners.delete(cb))
export const getDbVersion = () => version
function notify() {
  version++
  listeners.forEach((l) => l())
}

export class StorageFullError extends Error {
  constructor() {
    super('Browser storage is full. Remove some books or recordings to free space.')
  }
}

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)) throw new StorageFullError()
    throw e
  }
}

// ---- books ----
export const listBooks = async () => (await getDb()).getAll('books')
export const getBook = async (id: string) => (await getDb()).get('books', id)

export async function putBook(book: Book) {
  await guarded(async () => (await getDb()).put('books', book))
  notify()
}

export async function updateBook(id: string, patch: Partial<Book>) {
  const db = await getDb()
  const tx = db.transaction('books', 'readwrite')
  const cur = await tx.store.get(id)
  if (cur) await tx.store.put({ ...cur, ...patch })
  await tx.done
  notify()
}

export async function saveImportedBook(book: Book, pages: Page[], originalFile?: Blob) {
  await guarded(async () => {
    const db = await getDb()
    const tx = db.transaction(['books', 'pages', 'files'], 'readwrite')
    await tx.objectStore('books').put(book)
    for (const p of pages) await tx.objectStore('pages').put(p)
    if (originalFile) await tx.objectStore('files').put(originalFile, book.id)
    await tx.done
  })
  notify()
}

export async function deleteBook(id: string) {
  const db = await getDb()
  const tx = db.transaction(['books', 'pages', 'narrations', 'recordings', 'history', 'files', 'meta'], 'readwrite')
  await tx.objectStore('books').delete(id)
  for (const store of ['pages', 'narrations', 'recordings', 'history'] as const) {
    const keys = await tx.objectStore(store).index('bookId').getAllKeys(id)
    for (const k of keys) await tx.objectStore(store).delete(k as never)
  }
  await tx.objectStore('files').delete(id)
  await tx.objectStore('meta').delete(`batch:${id}`)
  await tx.done
  notify()
}

// ---- pages ----
export const getPage = async (bookId: string, n: number) => (await getDb()).get('pages', pageId(bookId, n))
export const getPages = async (bookId: string) => {
  const pages = await (await getDb()).getAllFromIndex('pages', 'bookId', bookId)
  return pages.sort((a, b) => a.pageNumber - b.pageNumber)
}
export async function listBookmarkedPages(): Promise<Page[]> {
  const out: Page[] = []
  let cursor = await (await getDb()).transaction('pages').store.openCursor()
  while (cursor) {
    if (cursor.value.bookmarked) out.push(cursor.value)
    cursor = await cursor.continue()
  }
  return out
}

export async function updatePage(id: string, patch: Partial<Page>) {
  const db = await getDb()
  const tx = db.transaction('pages', 'readwrite')
  const cur = await tx.store.get(id)
  if (cur) await tx.store.put({ ...cur, ...patch })
  await tx.done
  notify()
}

export async function replacePageTexts(bookId: string, texts: Map<number, string>) {
  const db = await getDb()
  const tx = db.transaction('pages', 'readwrite')
  for (const [n, text] of texts) {
    const cur = await tx.store.get(pageId(bookId, n))
    if (cur) await tx.store.put({ ...cur, extractedText: text })
  }
  await tx.done
  notify()
}

// ---- narrations ----
export const getNarration = async (bookId: string, n: number) => (await getDb()).get('narrations', pageId(bookId, n))
/** bookId -> number of pages with saved audio, using keys only (does not load audio). */
export async function narrationCounts(): Promise<Record<string, number>> {
  const keys = (await (await getDb()).getAllKeys('narrations')) as string[]
  const out: Record<string, number> = {}
  for (const k of keys) {
    const id = k.slice(0, k.lastIndexOf(':'))
    out[id] = (out[id] ?? 0) + 1
  }
  return out
}
export const listNarrations = async (bookId?: string) => {
  const db = await getDb()
  return bookId ? db.getAllFromIndex('narrations', 'bookId', bookId) : db.getAll('narrations')
}

/** Atomically stores audio against exactly one page and flags the page as ready. */
export async function putNarration(n: Narration) {
  await guarded(async () => {
    const db = await getDb()
    const tx = db.transaction(['narrations', 'pages'], 'readwrite')
    await tx.objectStore('narrations').put(n)
    const page = await tx.objectStore('pages').get(n.pageId)
    if (page) await tx.objectStore('pages').put({ ...page, narrationStatus: 'ready' })
    await tx.done
  })
  notify()
}

export async function markDownloaded(ids: string[]) {
  const db = await getDb()
  const tx = db.transaction('narrations', 'readwrite')
  for (const id of ids) {
    const cur = await tx.store.get(id)
    if (cur) await tx.store.put({ ...cur, downloadedAt: Date.now() })
  }
  await tx.done
  notify()
}

export async function deleteNarration(id: string) {
  const db = await getDb()
  const tx = db.transaction(['narrations', 'pages'], 'readwrite')
  await tx.objectStore('narrations').delete(id)
  const page = await tx.objectStore('pages').get(id)
  if (page) await tx.objectStore('pages').put({ ...page, narrationStatus: 'none' })
  await tx.done
  notify()
}

// ---- mic recordings ----
export const getRecording = async (bookId: string, n: number) => (await getDb()).get('recordings', pageId(bookId, n))
export const listRecordings = async (bookId?: string) => {
  const db = await getDb()
  return bookId ? db.getAllFromIndex('recordings', 'bookId', bookId) : db.getAll('recordings')
}
export async function putRecording(r: MicRecording) {
  await guarded(async () => (await getDb()).put('recordings', r))
  notify()
}
export async function deleteRecording(id: string) {
  await (await getDb()).delete('recordings', id)
  notify()
}

// ---- history ----
export async function addHistory(entry: Omit<HistoryEntry, 'id'>) {
  await (await getDb()).add('history', entry)
  notify()
}
export const listHistory = async (limit = 300) => {
  const db = await getDb()
  const out: HistoryEntry[] = []
  let cursor = await db.transaction('history').store.index('at').openCursor(null, 'prev')
  while (cursor && out.length < limit) {
    out.push(cursor.value)
    cursor = await cursor.continue()
  }
  return out
}
export async function clearHistory() {
  await (await getDb()).clear('history')
  notify()
}

// ---- files / meta ----
export const getOriginalFile = async (bookId: string) => (await getDb()).get('files', bookId)
export async function deleteOriginalFile(bookId: string) {
  await (await getDb()).delete('files', bookId)
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await (await getDb()).get('meta', key)) as T | undefined
}
export async function setMeta(key: string, value: unknown) {
  await (await getDb()).put('meta', value, key)
  notify()
}
export async function deleteMeta(key: string) {
  await (await getDb()).delete('meta', key)
  notify()
}
export const getBatchRecord = (bookId: string) => getMeta<BatchRecord>(`batch:${bookId}`)

export async function addListenSeconds(seconds: number) {
  if (seconds <= 0) return
  const cur = (await getMeta<number>('listenSeconds')) ?? 0
  await (await getDb()).put('meta', cur + seconds, 'listenSeconds')
  notify()
}
