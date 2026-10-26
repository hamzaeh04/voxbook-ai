import express, { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { ApiError } from './errors.js'
import type { ObjectStore } from './store.js'

/**
 * Shared public library: books, chapter text, covers and generated chapter audio, visible to everyone
 * who opens the app. Personal state (reading position, bookmarks, history, settings) stays in each
 * browser. Storage layout:
 *   library/<id>.json                     book metadata (listing the library reads only these)
 *   books/<id>/cover                      cover image
 *   books/<id>/chapters/<n>.json          chapter title + text
 *   narr/<id>/<n>.json                    narration manifest for chapter n
 *   books/<id>/audio/<n>/<version>/<k>    audio bytes, split into parts below the host's request limit
 */

const id = z.string().regex(/^[a-f0-9-]{36}$/i)
const chapterNo = z.coerce.number().int().min(1).max(5000)

const metaSchema = z.object({
  id,
  title: z.string().min(1).max(200),
  author: z.string().max(200),
  format: z.enum(['pdf', 'epub', 'txt', 'docx']),
  unit: z.enum(['chapter', 'page']),
  totalPages: z.number().int().min(1).max(5000),
  createdAt: z.number(),
  hasCover: z.boolean(),
  scannedPages: z.array(z.number().int()).max(5000).optional(),
})
type SharedBook = z.infer<typeof metaSchema> & { updatedAt: number }

const chapterSchema = z.object({ title: z.string().max(300).optional(), text: z.string().max(70_000) })

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
  version: z.string().regex(/^[a-z0-9]{6,40}$/),
})
type SharedNarration = z.infer<typeof narrationSchema>

/** Bounded-concurrency map (listing a large library means many small reads). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

const parseJson = <T>(buf: Buffer | null): T | null => {
  if (!buf) return null
  try {
    return JSON.parse(buf.toString('utf8')) as T
  } catch {
    return null
  }
}

export function createLibraryRouter(store: ObjectStore | null, disabledReason: string): Router {
  const router = Router()
  const raw = express.raw({ type: () => true, limit: '5mb' })
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)
  const need = () => {
    if (!store) throw new ApiError('not_configured', disabledReason)
    return store
  }

  // Listing is cached briefly per server instance (storage list calls are metered) and dropped on any write.
  let listing: { at: number; books: SharedBook[] } | null = null
  router.use((req, _res, next) => {
    if (req.method !== 'GET') listing = null
    next()
  })

  router.get(
    '/',
    wrap(async (_req, res) => {
      if (!store) return res.json({ enabled: false, reason: disabledReason, books: [] })
      if (!listing || Date.now() - listing.at > 20_000) {
        const keys = (await store.list('library/')).filter((k) => k.endsWith('.json'))
        const books = (await mapLimit(keys, 16, async (k) => parseJson<SharedBook>(await store.get(k)))).filter((b): b is SharedBook => Boolean(b))
        listing = { at: Date.now(), books: books.sort((a, b) => b.createdAt - a.createdAt) }
      }
      res.set('Cache-Control', 'no-store').json({ enabled: true, store: store.kind, books: listing.books })
    }),
  )

  router.put(
    '/books/:id',
    wrap(async (req, res) => {
      const meta = metaSchema.parse({ ...req.body, id: req.params.id })
      const book: SharedBook = { ...meta, updatedAt: Date.now() }
      await need().put(`library/${meta.id}.json`, JSON.stringify(book), 'application/json')
      res.json(book)
    }),
  )

  router.delete(
    '/books/:id',
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const s = need()
      const keys = [...(await s.list(`books/${bookId}/`)), ...(await s.list(`narr/${bookId}/`))]
      await s.delete(keys)
      await s.delete([`library/${bookId}.json`]) // last, so a half-deleted book is never listed as complete
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

  router.put(
    '/books/:id/chapters/:n',
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const n = chapterNo.parse(req.params.n)
      const chapter = chapterSchema.parse(req.body)
      await need().put(`books/${bookId}/chapters/${n}.json`, JSON.stringify({ n, ...chapter }), 'application/json')
      res.json({ ok: true })
    }),
  )

  router.get(
    '/books/:id/chapters/:n',
    wrap(async (req, res) => {
      const chapter = parseJson(await need().get(`books/${id.parse(req.params.id)}/chapters/${chapterNo.parse(req.params.n)}.json`))
      if (!chapter) throw new ApiError('not_found', 'Chapter not found in the shared library.')
      res.set('Cache-Control', 'no-store').json(chapter)
    }),
  )

  router.get(
    '/books/:id/narrations',
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const s = need()
      const keys = (await s.list(`narr/${bookId}/`)).filter((k) => k.endsWith('.json'))
      const manifests = (await mapLimit(keys, 16, async (k) => parseJson<SharedNarration>(await s.get(k)))).filter(Boolean)
      res.set('Cache-Control', 'no-store').json(manifests)
    }),
  )

  router.put(
    '/books/:id/narrations/:n/parts/:k',
    raw,
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const n = chapterNo.parse(req.params.n)
      const k = z.coerce.number().int().min(0).max(49).parse(req.params.k)
      const version = narrationSchema.shape.version.parse(req.query.version)
      if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ApiError('validation', 'Audio part is empty.')
      await need().put(`books/${bookId}/audio/${n}/${version}/${k}`, req.body, 'application/octet-stream')
      res.json({ ok: true })
    }),
  )

  /** Publishing the manifest makes the audio visible to everyone; older versions are then removed. */
  router.put(
    '/books/:id/narrations/:n',
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const n = chapterNo.parse(req.params.n)
      const manifest = narrationSchema.parse({ ...req.body, pageNumber: n })
      const s = need()
      const parts = await s.list(`books/${bookId}/audio/${n}/${manifest.version}/`)
      if (parts.length < manifest.parts) throw new ApiError('validation', `Only ${parts.length} of ${manifest.parts} audio parts were uploaded.`)
      await s.put(`narr/${bookId}/${n}.json`, JSON.stringify(manifest), 'application/json')
      const stale = (await s.list(`books/${bookId}/audio/${n}/`)).filter((k) => !k.startsWith(`books/${bookId}/audio/${n}/${manifest.version}/`))
      await s.delete(stale)
      res.json(manifest)
    }),
  )

  router.get(
    '/books/:id/narrations/:n/parts/:k',
    wrap(async (req, res) => {
      const bookId = id.parse(req.params.id)
      const n = chapterNo.parse(req.params.n)
      const k = z.coerce.number().int().min(0).max(49).parse(req.params.k)
      const version = narrationSchema.shape.version.parse(req.query.version)
      const buf = await need().get(`books/${bookId}/audio/${n}/${version}/${k}`)
      if (!buf) throw new ApiError('not_found', 'Audio part not found.')
      res.set({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(buf)
    }),
  )

  return router
}

