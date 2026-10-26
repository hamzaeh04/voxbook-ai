import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../server/app.js'
import { loadConfig } from '../../server/config.js'
import { createEdgeProvider } from '../../server/providers/edge.js'

const env = (extra: Record<string, string>) =>
  loadConfig({ CACHE_DIR: mkdtempSync(path.join(tmpdir(), 'vox-')), ...extra } as NodeJS.ProcessEnv)

const mp3 = (tag: string) => new Response(Buffer.from(`ID3-${tag}`), { status: 200, headers: { 'content-type': 'audio/mpeg' } })
const err = (status: number, body: unknown = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers })

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI provider', () => {
  const cfg = () => env({ TTS_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-secret-key', OPENAI_TTS_MODEL: 'gpt-4o-mini-tts' })

  it('exposes the three personas mapped to real voices, flags external processing, never exposes the key', async () => {
    const { app } = createApp(cfg())
    const res = await request(app).get('/api/voices').expect(200)
    expect(res.body.provider).toMatchObject({ id: 'openai', external: true, configured: true, isMock: false, audioFormat: 'mp3' })
    const personas = Object.fromEntries(res.body.voices.map((v: any) => [v.persona, v.providerVoiceId]).reverse())
    expect(personas).toMatchObject({ 'heavy-male': 'onyx', 'warm-female': 'nova', neutral: 'alloy' })
    expect(res.body.voices.every((v: any) => v.supportedSettings.pitch === false)).toBe(true) // never pretend pitch works
    expect(JSON.stringify(res.body)).not.toContain('sk-secret-key')
  })

  it('sends only the page text with the key in the Authorization header, and applies style instructions', async () => {
    const fetchMock = vi.fn(async () => mp3('a'))
    vi.stubGlobal('fetch', fetchMock)
    const { app } = createApp(cfg())
    const res = await request(app).post('/api/narration/generate').send({ text: 'Only this page.', voiceId: 'openai:onyx', settings: { style: 'dramatic' } }).expect(200)
    expect(res.headers['content-type']).toContain('audio/mpeg')
    expect(res.headers['x-audio-format']).toBe('mp3')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/audio/speech')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret-key')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: 'gpt-4o-mini-tts', voice: 'onyx', input: 'Only this page.', response_format: 'mp3' })
    expect(body.instructions).toMatch(/dramatic/i)
    expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toContain('sk-secret-key')
  })

  it('splits long pages into chunks within the provider limit and concatenates the audio in order', async () => {
    let n = 0
    const fetchMock = vi.fn(async () => mp3(String(++n)))
    vi.stubGlobal('fetch', fetchMock)
    const { app } = createApp(cfg())
    const text = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} goes here.`).join(' ') // ~6000 chars
    const res = await request(app).post('/api/narration/generate').send({ text, voiceId: 'openai:nova', settings: { style: 'neutral' } }).expect(200)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    for (const [, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) expect(JSON.parse(init.body as string).input.length).toBeLessThanOrEqual(3800)
    expect(Buffer.from(res.body).toString()).toBe(Array.from({ length: fetchMock.mock.calls.length }, (_, i) => `ID3-${i + 1}`).join(''))
  })

  it.each([
    [429, { error: { message: 'You exceeded your current quota, check billing' } }, 402, 'quota_exceeded'],
    [429, { error: { message: 'Rate limit reached' } }, 429, 'rate_limited'],
    [401, { error: { message: 'bad key sk-secret-key' } }, 503, 'not_configured'],
    [500, {}, 502, 'provider_error'],
  ])('maps provider HTTP %i to a typed, key-free error', async (upstream, body, status, code) => {
    vi.stubGlobal('fetch', vi.fn(async () => err(upstream, body, { 'retry-after': '7' })))
    const { app } = createApp(cfg())
    const res = await request(app).post('/api/narration/generate').send({ text: `t${upstream}${code}`, voiceId: 'openai:onyx', settings: { style: 'neutral' } }).expect(status)
    expect(res.body.error.code).toBe(code)
    expect(JSON.stringify(res.body)).not.toContain('sk-secret-key')
  })

  it('reports network failure and timeouts as typed errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const { app } = createApp(cfg())
    const res = await request(app).post('/api/narration/generate').send({ text: 'net', voiceId: 'openai:onyx', settings: { style: 'neutral' } }).expect(502)
    expect(res.body.error.code).toBe('provider_error')
    vi.stubGlobal('fetch', vi.fn(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) }))
    await request(app).post('/api/narration/generate').send({ text: 'slow', voiceId: 'openai:onyx', settings: { style: 'neutral' } }).expect(504)
  })

  it('does not call the provider when the key is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { app } = createApp(env({ TTS_PROVIDER: 'openai' }))
    const v = await request(app).get('/api/voices').expect(200)
    expect(v.body.provider).toMatchObject({ configured: false, setupHint: expect.stringContaining('OPENAI_API_KEY') })
    await request(app).post('/api/narration/generate').send({ text: 'x', voiceId: 'openai:onyx', settings: { style: 'neutral' } }).expect(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ElevenLabs provider', () => {
  const cfg = () => env({ TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'el-secret', ELEVENLABS_VOICE_MALE_ID: 'M1', ELEVENLABS_VOICE_FEMALE_ID: 'F1', ELEVENLABS_VOICE_NEUTRAL_ID: 'N1' })

  it('lists account voices, labelling only the configured ids as personas', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ voices: [
      { voice_id: 'X9', name: 'Random', labels: { gender: 'male' } },
      { voice_id: 'F1', name: 'Sarah', description: 'Mature and warm', labels: { language: 'en' } },
      { voice_id: 'M1', name: 'Adam' },
    ] }), { status: 200 })))
    const { app } = createApp(cfg())
    const res = await request(app).get('/api/voices').expect(200)
    expect(res.body.voices.map((v: any) => [v.providerVoiceId, v.persona, v.displayName])).toEqual([
      ['M1', 'heavy-male', 'Confident Heavy Male'],
      ['F1', 'warm-female', 'Warm Professional Female'],
      ['X9', 'other', 'Random'], // a "male" label alone never earns the heavy-male persona
    ])
  })

  it('synthesizes with the xi-api-key header and mapped voice settings', async () => {
    const calls: [string, RequestInit][] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return url.endsWith('/voices') ? new Response(JSON.stringify({ voices: [{ voice_id: 'M1', name: 'Adam' }] })) : mp3('el')
    }))
    const { app } = createApp(cfg())
    await request(app).post('/api/narration/generate').send({ text: 'Hello page.', voiceId: 'elevenlabs:M1', settings: { style: 'calm' } }).expect(200)
    const [url, init] = calls.find(([u]) => u.includes('text-to-speech'))!
    expect(url).toContain('/v1/text-to-speech/M1?output_format=mp3_44100_128')
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('el-secret')
    expect(JSON.parse(init.body as string)).toMatchObject({ text: 'Hello page.', model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.8 } })
  })
})

describe('Edge (free) provider', () => {
  const live = [
    { ShortName: 'fr-FR-DeniseNeural', Gender: 'Female', Locale: 'fr-FR', LocaleName: 'French (France)' },
    { ShortName: 'en-GB-RyanNeural', Gender: 'Male', Locale: 'en-GB', LocaleName: 'English (United Kingdom)', VoiceTag: { VoicePersonalities: ['Bright'] } },
    { ShortName: 'en-US-GuyNeural', Gender: 'Male', Locale: 'en-US', LocaleName: 'English (United States)' },
    { ShortName: 'en-US-AndrewMultilingualNeural', Gender: 'Male', Locale: 'en-US', LocaleName: 'English (United States)' },
    { ShortName: 'en-US-JennyNeural', Gender: 'Female', Locale: 'en-US', LocaleName: 'English (United States)' },
    { ShortName: 'en-US-AriaNeural', Gender: 'Female', Locale: 'en-US', LocaleName: 'English (United States)' },
    { ShortName: 'ja-JP-NanamiNeural', Gender: 'Female', Locale: 'ja-JP', LocaleName: 'Japanese (Japan)' },
  ]

  it('serves only the English voices from the live catalogue, personas first, flagged external + unofficial', async () => {
    const { app } = createApp(env({ TTS_PROVIDER: 'edge' }), createEdgeProvider(async () => live))
    const res = await request(app).get('/api/voices').expect(200)
    expect(res.body.provider).toMatchObject({ id: 'edge', external: true, configured: true, isMock: false, audioFormat: 'mp3' })
    expect(res.body.provider.retentionNote).toMatch(/unofficial/i)
    expect(res.body.voices.map((v: any) => [v.providerVoiceId, v.persona])).toEqual([
      ['en-US-GuyNeural', 'heavy-male'],
      ['en-US-JennyNeural', 'warm-female'],
      ['en-US-AriaNeural', 'neutral'],
      ['en-US-AndrewMultilingualNeural', 'other'],
      ['en-GB-RyanNeural', 'other'],
    ])
    const andrew = res.body.voices.find((v: any) => v.providerVoiceId === 'en-US-AndrewMultilingualNeural')
    expect(andrew).toMatchObject({ displayName: 'Andrew Multilingual (US)', locale: 'en-US', gender: 'Male', multilingual: true })
    expect(res.body.voices.find((v: any) => v.providerVoiceId === 'en-GB-RyanNeural').displayName).toBe('Ryan (UK)')
  })

  it('falls back to built-in English voices when the catalogue cannot be fetched', async () => {
    const { app } = createApp(env({ TTS_PROVIDER: 'edge' }), createEdgeProvider(async () => { throw new Error('offline') }))
    const res = await request(app).get('/api/voices').expect(200)
    expect(res.body.voices.length).toBe(6)
    expect(res.body.voices[0].providerVoiceId).toBe('en-US-GuyNeural')
  })
})
