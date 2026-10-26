import { timingSafeEqual } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import type { ApiErrorBody, VoicesResponse } from '../shared/types.js'
import { MAX_BATCH_CHARS, MAX_BATCH_ITEMS, MAX_CHARS_PER_PAGE } from '../shared/types.js'
import { AudioCache } from './cache.js'
import type { Config } from './config.js'
import { ApiError } from './errors.js'
import { JobManager } from './jobs.js'
import { createLibraryRouter } from './library.js'
import { FsStore, VercelBlobStore, type ObjectStore } from './store.js'
import { NarrationService } from './narration.js'
import { createProvider } from './providers/index.js'
import type { TtsProvider } from './providers/types.js'

const settingsSchema = z.object({ style: z.enum(['neutral', 'expressive', 'calm', 'dramatic']).default('neutral') })
const generateSchema = z.object({
  text: z.string().min(1).max(MAX_CHARS_PER_PAGE),
  voiceId: z.string().min(1).max(200),
  settings: settingsSchema.default({ style: 'neutral' }),
})
const batchSchema = z.object({
  voiceId: z.string().min(1).max(200),
  settings: settingsSchema.default({ style: 'neutral' }),
  items: z
    .array(z.object({ key: z.string().min(1).max(64), text: z.string().min(1).max(MAX_CHARS_PER_PAGE) }))
    .min(1)
    .max(MAX_BATCH_ITEMS)
    .refine((items) => items.reduce((n, i) => n + i.text.length, 0) <= MAX_BATCH_CHARS, `A batch may contain at most ${MAX_BATCH_CHARS} characters.`),
})

const MIME = { mp3: 'audio/mpeg', wav: 'audio/wav' } as const

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\- ]+/g, '_').slice(0, 120) || 'narration'
}

export function createApp(cfg: Config, providerOverride?: TtsProvider) {
  const provider = providerOverride ?? createProvider(cfg)
  const cache = new AudioCache(cfg.cacheDir)
  const narration = new NarrationService(provider, cfg, cache)
  const jobs = new JobManager(narration)
  const app = express()
  app.disable('x-powered-by')
  app.use('/api/narration/batch', express.json({ limit: '16mb' })) // whole books (chapter texts)
  app.use(express.json({ limit: '1mb' }))

  const generateLimiter = rateLimit({
    windowMs: 60_000,
    limit: cfg.generateLimitPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      const body: ApiErrorBody = { error: { code: 'rate_limited', message: 'Too many narration requests. Please slow down.', retryAfter: 30 } }
      res.status(429).json(body)
    },
  })

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: provider.info.id, configured: provider.info.configured })
  })

  // Optional shared-secret auth for every other /api route.
  app.use('/api', (req, _res, next) => {
    if (!cfg.accessToken) return next()
    const header = req.get('authorization') ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined) ?? ''
    if (!safeEqual(token, cfg.accessToken)) return next(new ApiError('unauthorized', 'A valid access token is required.'))
    next()
  })

  app.get('/api/voices', async (_req, res, next) => {
    try {
      const body: VoicesResponse = {
        provider: {
          ...provider.info,
          engineVersion: provider.fingerprint,
          serverJobs: !cfg.serverless,
          // ~8k characters ≈ 8 min of 48 kbps MP3 ≈ 3 MB, under Vercel's 4.5 MB response limit.
          maxCharsPerGenerate: cfg.serverless && provider.info.audioFormat === 'mp3' ? 8000 : undefined,
        },
        voices: provider.info.configured ? await narration.voices() : [] }
      res.json(body)
    } catch (e) {
      next(e)
    }
  })

  app.post('/api/narration/generate', generateLimiter, async (req, res, next) => {
    try {
      const body = generateSchema.parse(req.body)
      const result = await narration.generate(body.text, body.voiceId, body.settings)
      const audio = await cache.get(result.id)
      if (!audio) throw new ApiError('internal', 'Generated audio was not stored.')
      res
        .set({
          'Content-Type': MIME[audio.format],
          'X-Narration-Id': result.id,
          'X-Audio-Format': audio.format,
          'X-Cache': result.cached ? 'HIT' : 'MISS',
          'Access-Control-Expose-Headers': 'X-Narration-Id, X-Audio-Format, X-Cache',
        })
        .send(audio.audio)
    } catch (e) {
      next(e)
    }
  })

  app.post('/api/narration/batch', generateLimiter, (req, res, next) => {
    try {
      if (!provider.info.configured) throw new ApiError('not_configured', 'No TTS provider is configured on the server.')
      const body = batchSchema.parse(req.body)
      res.status(202).json({ jobId: jobs.create(body) })
    } catch (e) {
      next(e)
    }
  })

  const withJob = (fn: (id: string) => ReturnType<JobManager['get']>) => (req: Request, res: Response, next: NextFunction) => {
    const state = fn(req.params.id)
    if (!state) return next(new ApiError('not_found', 'Batch job not found (it may have expired or the server restarted).'))
    res.json(state)
  }
  app.get('/api/narration/batch/:id', withJob((id) => jobs.get(id)))
  app.post('/api/narration/batch/:id/cancel', withJob((id) => jobs.cancel(id)))
  app.post('/api/narration/batch/:id/retry', withJob((id) => jobs.retry(id)))

  const sendAudio = (download: boolean) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const audio = await cache.get(req.params.id)
      if (!audio) throw new ApiError('not_found', 'Narration not found or expired from the server cache.')
      res.set('Content-Type', MIME[audio.format])
      if (download) {
        const name = safeFilename((req.query.filename as string) || `narration-${req.params.id.slice(0, 8)}`)
        res.set('Content-Disposition', `attachment; filename="${name}.${audio.format}"`)
      }
      res.send(audio.audio)
    } catch (e) {
      next(e)
    }
  }
  app.get('/api/narration/:id/download', sendAudio(true))
  app.get('/api/narration/:id', sendAudio(false))

  // Shared library: Vercel Blob in production, a local folder in development.
  const libraryStore: ObjectStore | null = cfg.library.blobToken
    ? new VercelBlobStore(cfg.library.blobToken, cfg.library.blobAccess)
    : cfg.serverless
      ? null
      : new FsStore(cfg.library.dir)
  app.use(
    '/api/library',
    createLibraryRouter(
      libraryStore,
      'Shared library storage is not set up. In Vercel open Storage → Create Database → Blob, connect it to this project, then redeploy.',
    ),
  )

  app.use('/api', (_req, _res, next) => next(new ApiError('not_found', 'Unknown API route.')))

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let apiErr: ApiError
    if (err instanceof ApiError) apiErr = err
    else if (err instanceof z.ZodError) apiErr = new ApiError('validation', err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
    else if ((err as { type?: string }).type === 'entity.too.large') apiErr = new ApiError('validation', 'Request body too large.')
    else {
      console.error('[api] unexpected error:', err instanceof Error ? err.message : err)
      apiErr = new ApiError('internal', 'Unexpected server error.')
    }
    if (apiErr.retryAfter) res.set('Retry-After', String(apiErr.retryAfter))
    const body: ApiErrorBody = { error: { code: apiErr.code, message: apiErr.message, retryAfter: apiErr.retryAfter } }
    res.status(apiErr.status).json(body)
  })

  return { app, narration, jobs, cache, provider, libraryStore }
}
