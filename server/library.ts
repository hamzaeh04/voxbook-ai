import express, { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError } from './errors.js'
import type { ObjectStore } from './store.js'

/**
 * Shared public library: books, chapter text, covers and generated chapter audio, visible to everyone
 * who opens the app. Personal state (reading position, bookmarks, history, settings) stays in each
 * browser.
 *
 * Designed around Vercel Blob's free tier, where writes and listings are the scarce "advanced
 * operations" (2,000/month) and plain reads are cheap. A book upload costs ~3 writes and a narrated
 * chapter 2 writes; browsing the library is a single read.
 *
 *   library/index.json                    every book's metadata (the library listing)
 *   books/<id>/cover                      cover image
 *   books/<id>/chapters/b<k>.json         chapter text, bundled (each bundle < 4 MB)
 *   narr/<id>/<n>.json                    narration manifest for chapter n
 *   books/<id>/audio/<n>/<version>/<k>    audio bytes, in parts below the host's request limit
 */

const INDEX_KEY = 'library/index.json'
const id = z.string().regex(/^[a-f0-9-]{36}$/i)
const chapterNo = z.coerce.number().int().min(1).max(5000)
const bundleNo = z.coerce.number().int().min(0).max(200)
const version = z.string().regex(/^[a-z0-9]{6,40}$/)

const metaSchema = z.object({
  id,
  title: z.string().min(1).max(200),
  author: z.string().max(200),
  format: z.enum(['pdf', 'epub', 'txt', 'docx']),
  unit: z.enum(['chapter', 'page']),
  totalPages: z.number().int().min(1).max(5000),
  createdAt: z.number(),
  hasCover: z.boolean(),
  chapterBundles: z.number().int().min(1).max(200),
  scannedPages: z.array(z.number().int()).max(5000).optional(),
})
type SharedBook = z.infer<typeof metaSchema> & { updatedAt: number }

const chapterSchema = z.object({ n: z.number().int().min(1).max(5000), title: z.string().max(300).optional(), text: z.string().max(70_000) })
const bundleSchema = z.object({ chapters: z.array(chapterSchema).min(1).max(5000) })

const narrationSchema = z.object({
  pageNumber: z.number().int().min(1),
  voiceId: z.string().max(200),
  voiceName: z.string().max(200),
  style: z.enum(['neutral', 'expressive', 'calm', 'dramatic']),
  engine: z.string().max(200).optional(),
  format: z.enum(['mp3', 'wav']),
  duration: z.number().min(0),
  size: z.number().int().min(0),
  createdAt: z.number(),
  textHash: z.string().max(64),
  parts: z.number().int().min(1).max(50),
  version,
})
type SharedNarration = z.infer<typeof narrationSchema>

const parseJson = <T>(buf: Buffer | null): T | null => {
  if (!buf) return null
  try {
    return JSON.parse(buf.toString('utf8')) as T
  } catch {
    return null
  }
}

const audioKeys = (bookId: string, n: number, m: Pick<SharedNarration, 'version' | 'parts'>) =>
  Array.from({ length: m.parts }, (_, k) => `books/${bookId}/audio/${n}/${m.version}/${k}`)

export function createLibraryRouter(store: ObjectStore | null, disabledReason: string): Router {
  const router = Router()
  const raw = express.raw({ type: () => true, limit: '5mb' })
  const bundleJson = express.json({ limit: '5mb' })
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
  const need = () => {
    if (!store) throw new ApiError('not_configured', disabledReason)
    return store
  }

  // ---- library index (one object listing every book, plus tombstones of deleted ones) ----
  // Tombstones tell browsers "deleted on purpose": a book that is merely missing (e.g. fresh storage)
  // is re-shared by whoever still has it instead of being deleted everywhere.
  type Index = { books: SharedBook[]; deleted: string[] }
  let cached: { at: number; index: Index } | null = null

  async function readIndex(s: ObjectStore): Promise<Index> {
    if (cached && Date.now() - cached.at < 15_000) return cached.index
    const raw = parseJson<Index | SharedBook[]>(await s.get(INDEX_KEY))
    const index: Index = Array.isArray(raw) ? { books: raw, deleted: [] } : { books: raw?.books ?? [], deleted: raw?.deleted ?? [] }
    cached = { at: Date.now(), index }
    return index
  }

  /**
   * Read-modify-write of the index. Two writers at the same moment could overwrite each other, so
   * after writing we re-read and retry if our change is missing (reads are cheap; writes are metered).
   */
  async function updateIndex(s: ObjectStore, change: (index: Index) => Index, applied: (index: Index) => boolean) {
    for (let attempt = 0; attempt < 3; attempt++) {
      cached = null
      const next = change(await readIndex(s))
      await s.put(INDEX_KEY, JSON.stringify(next), 'application/json')
      cached = null
      if (applied(await readIndex(s))) return next
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 300))
    }
    throw new ApiError('internal', 'The library index changed concurrently; please try again.')
  }

  router.get(
    '/',
    wrap(async (_req, res) => {
      if (!store) return res.json({ enabled: false, reason: disabledReason, books: [] })
      const { books, deleted } = await readIndex(store)
      res.set('Cache-Control', 'no-store').json({ enabled: true, store: store.kind, books: [...books].sort((a, b) => b.createdAt - a.createdAt), deleted })
    }),
  )

  router.put(
    '/books/:id',
    wrap(async (req, res) => {
      const meta = metaSchema.parse({ ...req.body, id: req.params.id })
      const book: SharedBook = { ...meta, updatedAt: Date.now() }
      await updateIndex(
        need(),
        ({ books, deleted }) => ({ books: [...books.filter((b) => b.id !== book.id), book], deleted: deleted.filter((d) => d !== book.id) }),
        ({ books }) => books.some((b) => b.id === book.id && b.updatedAt === book.updatedAt),
      )
      res.json(book)
    }),
  )

  router.delete(
    '/books/:id',
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const s = need()
      // Unlist first so nobody opens a half-deleted book, then remove its objects.
      await updateIndex(
        s,
        ({ books, deleted }) => ({ books: books.filter((b) => b.id !== bookId), deleted: [...deleted.filter((d) => d !== bookId), bookId].slice(-2000) }),
        ({ books, deleted }) => !books.some((b) => b.id === bookId) && deleted.includes(bookId),
      )
      const keys = [...(await s.list(`books/${bookId}/`)), ...(await s.list(`narr/${bookId}/`))]
      await s.delete(keys)
      res.json({ ok: true })
    }),
  )

  router.put(
    '/books/:id/cover',
    raw,
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError('validation', 'Cover image body is empty.')
      await need().put(`books/${bookId}/cover`, req.body, req.get('content-type') ?? 'image/jpeg')
      res.json({ ok: true })
    }),
  )

  router.get(
    '/books/:id/cover',
    wrap(async (req, res) => {
      const buf = await need().get(`books/${id.parse(req.params.id)}/cover`)
      if (!buf) throw new ApiError('not_found', 'No cover for this book.')
      res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' }).send(buf)
    }),
  )

  /** A bundle of chapters (the client keeps each bundle under the host's 4.5 MB request limit). */
  router.put(
    '/books/:id/bundles/:k',
    bundleJson,
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const k = bundleNo.parse(req.params.k)
      const bundle = bundleSchema.parse(req.body)
      await need().put(`books/${bookId}/chapters/b${k}.json`, JSON.stringify(bundle), 'application/json')
      res.json({ ok: true, chapters: bundle.chapters.length })
    }),
  )

  router.get(
    '/books/:id/bundles/:k',
    wrap(async (req, res) => {
      const buf = await need().get(`books/${id.parse(req.params.id)}/chapters/b${bundleNo.parse(req.params.k)}.json`)
      if (!buf) throw new ApiError('not_found', 'Chapter bundle not found in the shared library.')
      res.set({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).send(buf)
    }),
  )

  router.get(
    '/books/:id/narrations/:n',
    wrap(async (req, res) => {
      const manifest = parseJson<SharedNarration>(await need().get(`narr/${id.parse(req.params.id)}/${chapterNo.parse(req.params.n)}.json`))
      if (!manifest) throw new ApiError('not_found', 'No shared narration for this chapter yet.')
      res.set('Cache-Control', 'no-store').json(manifest)
    }),
  )

  router.put(
    '/books/:id/narrations/:n/parts/:k',
    raw,
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const n = chapterNo.parse(req.params.n)
      const k = z.coerce.number().int().min(0).max(49).parse(req.params.k)
      const v = version.parse(req.query.version)
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError('validation', 'Audio part is empty.')
      await need().put(`books/${bookId}/audio/${n}/${v}/${k}`, req.body, 'application/octet-stream')
      res.json({ ok: true })
    }),
  )

  /** Publishing the manifest makes the audio visible to everyone; the previous version's parts are then removed. */
  router.put(
    '/books/:id/narrations/:n',
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const n = chapterNo.parse(req.params.n)
      const manifest = narrationSchema.parse({ ...req.body, pageNumber: n })
      const s = need()
      const keys = audioKeys(bookId, n, manifest)
      const present = await Promise.all(keys.map((k) => s.exists(k)))
      const uploaded = present.filter(Boolean).length
      if (uploaded < keys.length) throw new ApiError('validation', `Only ${uploaded} of ${keys.length} audio parts were uploaded.`)
      const previous = parseJson<SharedNarration>(await s.get(`narr/${bookId}/${n}.json`))
      await s.put(`narr/${bookId}/${n}.json`, JSON.stringify(manifest), 'application/json')
      if (previous && previous.version !== manifest.version) await s.delete(audioKeys(bookId, n, previous))
      res.json(manifest)
    }),
  )

  router.get(
    '/books/:id/narrations/:n/parts/:k',
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const n = chapterNo.parse(req.params.n)
      const k = z.coerce.number().int().min(0).max(49).parse(req.params.k)
      const buf = await need().get(`books/${bookId}/audio/${n}/${version.parse(req.query.version)}/${k}`)
      if (!buf) throw new ApiError('not_found', 'Audio part not found.')
      res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(buf)
    }),
  )

  return router
}
