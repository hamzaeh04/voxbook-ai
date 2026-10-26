import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../server/app.js'
import { loadConfig } from '../../server/config.js'
import { splitForTts } from '../../shared/chunk.js'
import { createMockProvider } from '../../server/providers/mock.js'

function setup(env: Record<string, string> = {}) {
  const cfg = loadConfig({ TTS_PROVIDER: 'mock', CACHE_DIR: mkdtempSync(path.join(tmpdir(), 'vox-')), ...env } as NodeJS.ProcessEnv)
  const provider = createMockProvider()
  const spy = vi.spyOn(provider, 'synthesize')
  return { ...createApp(cfg, provider), spy }
}

const body = (text: string, voiceId = 'mock:deep') => ({ text, voiceId, settings: { style: 'neutral' } })

describe('chunking', () => {
  it('keeps short text whole and splits long text on sentences within the limit', () => {
    expect(splitForTts('Hello there.', 100)).toEqual(['Hello there.'])
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ')
    const chunks = splitForTts(long, 200)
    expect(chunks.length).toBeGreaterThan(3)
    expect(chunks.every((c) => c.length <= 200)).toBe(true)
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(long)
  })
})

describe('POST /api/narration/generate', () => {
  it('returns audio with id/format headers and reuses cache for identical requests (no double billing)', async () => {
    const { app, spy } = setup()
    const a = await request(app).post('/api/narration/generate').send(body('Page one text.')).expect(200)
    expect(a.headers['content-type']).toContain('audio/wav')
    expect(a.headers['x-cache']).toBe('MISS')
    const b = await request(app).post('/api/narration/generate').send(body('Page one text.')).expect(200)
    expect(b.headers['x-cache']).toBe('HIT')
    expect(b.headers['x-narration-id']).toBe(a.headers['x-narration-id'])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('dedupes concurrent identical requests', async () => {
    const { app, spy } = setup()
    await Promise.all([1, 2, 3].map(() => request(app).post('/api/narration/generate').send(body('Concurrent page.')).expect(200)))
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('produces different ids for different voices or text', async () => {
    const { app } = setup()
    const ids = await Promise.all(
      [body('Same text.', 'mock:deep'), body('Same text.', 'mock:warm'), body('Other text.', 'mock:deep')].map(async (b) =>
        (await request(app).post('/api/narration/generate').send(b).expect(200)).headers['x-narration-id'],
      ),
    )
    expect(new Set(ids).size).toBe(3)
  })

  it('validates payloads and unknown voices', async () => {
    const { app } = setup()
    const empty = await request(app).post('/api/narration/generate').send(body('')).expect(400)
    expect(empty.body.error.code).toBe('validation')
    await request(app).post('/api/narration/generate').send(body('x'.repeat(60001))).expect(400)
    const bad = await request(app).post('/api/narration/generate').send(body('hi', 'mock:nope')).expect(400)
    expect(bad.body.error.message).toMatch(/Unknown voice/)
  })

  it('serves stored audio by id and as a download', async () => {
    const { app } = setup()
    const gen = await request(app).post('/api/narration/generate').send(body('Download me.')).expect(200)
    const id = gen.headers['x-narration-id']
    await request(app).get(`/api/narration/${id}`).expect(200)
    const dl = await request(app).get(`/api/narration/${id}/download?filename=Book_Page_001`).expect(200)
    expect(dl.headers['content-disposition']).toContain('Book_Page_001.wav')
    await request(app).get(`/api/narration/${'0'.repeat(64)}`).expect(404)
    await request(app).get('/api/narration/../../etc/passwd').expect(404)
  })

  it('maps provider quota failures to a typed error', async () => {
    const { app, spy } = setup()
    const { ApiError } = await import('../../server/errors.js')
    spy.mockRejectedValueOnce(new ApiError('quota_exceeded', 'quota'))
    const res = await request(app).post('/api/narration/generate').send(body('Fails.')).expect(402)
    expect(res.body.error.code).toBe('quota_exceeded')
  })
})

describe('provider configuration + auth', () => {
  it('reports not_configured when no provider is set', async () => {
    const cfg = loadConfig({ TTS_PROVIDER: 'none', CACHE_DIR: mkdtempSync(path.join(tmpdir(), 'vox-')) } as NodeJS.ProcessEnv)
    const { app } = createApp(cfg)
    const v = await request(app).get('/api/voices').expect(200)
    expect(v.body.provider.configured).toBe(false)
    expect(v.body.voices).toEqual([])
    const res = await request(app).post('/api/narration/generate').send(body('x')).expect(503)
    expect(res.body.error.code).toBe('not_configured')
  })

  it('defaults to the free Edge voices when no paid key is set, and prefers a paid key when present', () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).provider).toBe('edge')
    expect(loadConfig({ OPENAI_API_KEY: 'sk-x' } as NodeJS.ProcessEnv).provider).toBe('openai')
    expect(loadConfig({ ELEVENLABS_API_KEY: 'k' } as NodeJS.ProcessEnv).provider).toBe('elevenlabs')
  })

  it('refuses the mock provider in production', () => {
    expect(loadConfig({ TTS_PROVIDER: 'mock', NODE_ENV: 'production' } as NodeJS.ProcessEnv).provider).toBe('none')
  })

  it('requires the access token when configured', async () => {
    const { app } = setup({ APP_ACCESS_TOKEN: 'secret-token' })
    await request(app).get('/api/voices').expect(401)
    await request(app).get('/api/voices').set('Authorization', 'Bearer wrong').expect(401)
    await request(app).get('/api/voices').set('Authorization', 'Bearer secret-token').expect(200)
    await request(app).get('/api/health').expect(200)
  })
})

describe('batch jobs', () => {
  const wait = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 100; i++) {
      if (await fn()) return
      await new Promise((r) => setTimeout(r, 20))
    }
    throw new Error('timeout')
  }

  it('processes all items in the background and exposes per-item narration ids', async () => {
    const { app } = setup()
    const create = await request(app)
      .post('/api/narration/batch')
      .send({ voiceId: 'mock:warm', settings: { style: 'neutral' }, items: [1, 2, 3].map((n) => ({ key: String(n), text: `Page ${n} text.` })) })
      .expect(202)
    let state: any
    await wait(async () => {
      state = (await request(app).get(`/api/narration/batch/${create.body.jobId}`)).body
      return state.status !== 'running'
    })
    expect(state.status).toBe('done')
    expect(state.items.map((i: any) => i.key)).toEqual(['1', '2', '3'])
    expect(state.items.every((i: any) => i.status === 'done' && i.narrationId)).toBe(true)
    await request(app).get(`/api/narration/${state.items[0].narrationId}`).expect(200)
  })

  it('supports cancellation, then retry resumes remaining items', async () => {
    const { app, spy } = setup()
    spy.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 40))
      return { audio: Buffer.from('RIFF'), format: 'wav' as const }
    })
    const items = Array.from({ length: 8 }, (_, i) => ({ key: String(i + 1), text: `Page ${i + 1}` }))
    const { body: created } = await request(app).post('/api/narration/batch').send({ voiceId: 'mock:deep', settings: { style: 'neutral' }, items })
    await request(app).post(`/api/narration/batch/${created.jobId}/cancel`).expect(200)
    let state: any
    await wait(async () => ((state = (await request(app).get(`/api/narration/batch/${created.jobId}`)).body), state.status === 'cancelled'))
    expect(state.items.some((i: any) => i.status === 'cancelled')).toBe(true)
    await request(app).post(`/api/narration/batch/${created.jobId}/retry`).expect(200)
    await wait(async () => ((state = (await request(app).get(`/api/narration/batch/${created.jobId}`)).body), state.status === 'done'))
    expect(state.items.every((i: any) => i.status === 'done')).toBe(true)
  })

  it('stops the job when quota is exhausted instead of burning requests', async () => {
    const { app, spy } = setup()
    const { ApiError } = await import('../../server/errors.js')
    spy.mockRejectedValue(new ApiError('quota_exceeded', 'No credits'))
    const items = Array.from({ length: 6 }, (_, i) => ({ key: String(i), text: `T${i}` }))
    const { body: created } = await request(app).post('/api/narration/batch').send({ voiceId: 'mock:deep', settings: { style: 'neutral' }, items })
    let state: any
    await wait(async () => ((state = (await request(app).get(`/api/narration/batch/${created.jobId}`)).body), state.status !== 'running'))
    expect(state.status).toBe('failed')
    expect(spy.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('404s unknown jobs', async () => {
    const { app } = setup()
    await request(app).get('/api/narration/batch/nope').expect(404)
  })
})
