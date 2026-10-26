import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (orig) => {
  const actual = await orig<typeof import('@/lib/api')>()
  return { ...actual, api: { generate: vi.fn(), fetchAudio: vi.fn() } }
})
vi.mock('@/lib/audioMeta', () => ({ readDuration: vi.fn(async () => 4.2) }))

import { api, ApiClientError } from '@/lib/api'
import { getNarration, getPage, listNarrations, updatePage } from '@/lib/db'
import { generateForPage, narrationIsCurrent, NoTextError, useJobs } from '@/lib/narration'
import { hashText, markupToPlain } from '@/lib/utils'
import { audio, freshLibrary, voiceA, voiceB } from './helpers'

const gen = vi.mocked(api.generate)
const settings = { style: 'neutral' as const }

beforeEach(async () => {
  gen.mockReset()
  await freshLibrary()
})

describe('narration association', () => {
  it('stores audio against the page and voice it was requested for, even when responses resolve out of order', async () => {
    let releaseSlow!: () => void
    gen.mockImplementation(async (req) => {
      if (req.text.includes('one')) await new Promise<void>((r) => (releaseSlow = r))
      return audio(`audio-for:${req.text}:${req.voiceId}`)
    })
    // page 1 is queued first but its response only arrives after page 2's request has been issued
    const p1 = generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })
    const p2 = generateForPage({ bookId: 'book1', pageNumber: 2, voice: voiceB, settings })
    await vi.waitFor(() => expect(gen).toHaveBeenCalledTimes(1))
    releaseSlow()
    await Promise.all([p1, p2])

    const n1 = await getNarration('book1', 1)
    const n2 = await getNarration('book1', 2)
    expect(await n1!.audioBlob.text()).toBe('audio-for:Page one text.:mock:deep')
    expect(n1).toMatchObject({ pageNumber: 1, pageId: 'book1:1', voiceId: 'mock:deep', audioFormat: 'wav', duration: 4.2, status: 'ready' })
    expect(await n2!.audioBlob.text()).toBe('audio-for:Page two text.:mock:warm')
    expect(n2).toMatchObject({ pageNumber: 2, voiceId: 'mock:warm', voiceName: 'Warm' })
    expect(await getNarration('book1', 3)).toBeUndefined()
    expect((await getPage('book1', 1))!.narrationStatus).toBe('ready')
    expect((await getPage('book1', 3))!.narrationStatus).toBe('none')
  })

  it('sends only the requested page text (never the whole book)', async () => {
    gen.mockResolvedValue(audio('x'))
    await generateForPage({ bookId: 'book1', pageNumber: 2, voice: voiceA, settings })
    expect(gen.mock.calls[0][0]).toEqual({ text: 'Page two text.', voiceId: 'mock:deep', settings })
  })

  it('de-duplicates concurrent identical requests into one provider call', async () => {
    gen.mockImplementation(async () => (await new Promise((r) => setTimeout(r, 20)), audio('once')))
    const [a, b] = await Promise.all([
      generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings }),
      generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings }),
    ])
    expect(gen).toHaveBeenCalledTimes(1)
    expect(a.id).toBe(b.id)
  })

  it('reuses existing audio when text, voice and settings are unchanged, and regenerates on change or force', async () => {
    gen.mockImplementation(async (r) => audio(r.voiceId))
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })
    expect(gen).toHaveBeenCalledTimes(1)

    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceB, settings }) // different voice
    expect(gen).toHaveBeenCalledTimes(2)
    expect(await (await getNarration('book1', 1))!.audioBlob.text()).toBe('mock:warm')
    expect(await listNarrations('book1')).toHaveLength(1) // still one asset per page

    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceB, settings: { style: 'dramatic' } }) // different style
    expect(gen).toHaveBeenCalledTimes(3)
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceB, settings: { style: 'dramatic' }, force: true })
    expect(gen).toHaveBeenCalledTimes(4)
  })

  it('regenerates audio made by an older voice-engine version', async () => {
    const { useVoices } = await import('@/stores/voices')
    const provider = useVoices.getState().provider!
    gen.mockImplementation(async () => audio('v1'))
    useVoices.setState({ provider: { ...provider, engineVersion: 'emotion-v1' } })
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })
    expect(gen).toHaveBeenCalledTimes(1) // same engine: reused
    useVoices.setState({ provider: { ...provider, engineVersion: 'emotion-v2' } })
    gen.mockImplementation(async () => audio('v2'))
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })
    expect(gen).toHaveBeenCalledTimes(2) // engine changed: regenerated
    expect((await getNarration('book1', 1))!.engine).toBe('emotion-v2')
    useVoices.setState({ provider })
  })

  it('detects stale audio when the page text changes', async () => {
    gen.mockResolvedValue(audio('x'))
    const n = await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })
    const page = (await getPage('book1', 1))!
    expect(narrationIsCurrent(n, page, voiceA.id, settings)).toBe(true)
    expect(narrationIsCurrent(n, { extractedText: 'Different words.' }, voiceA.id, settings)).toBe(false)
    expect(narrationIsCurrent(n, page, voiceB.id, settings)).toBe(false)
    expect(n.textHash).toBe(hashText(markupToPlain(page.extractedText)))
  })

  it('records typed errors per page and clears them on success', async () => {
    gen.mockRejectedValueOnce(new ApiClientError('quota_exceeded', 'Quota reached'))
    await expect(generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })).rejects.toThrow('Quota reached')
    expect(useJobs.getState().jobs['book1:1']).toMatchObject({ state: 'error', error: { code: 'quota_exceeded', retryable: false } })
    expect(await getNarration('book1', 1)).toBeUndefined()

    gen.mockResolvedValueOnce(audio('ok'))
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })
    expect(useJobs.getState().jobs['book1:1']).toBeUndefined()
  })

  it('refuses blank pages without calling the provider', async () => {
    await updatePage('book1:3', { extractedText: '   ' })
    await expect(generateForPage({ bookId: 'book1', pageNumber: 3, voice: voiceA, settings })).rejects.toBeInstanceOf(NoTextError)
    expect(gen).not.toHaveBeenCalled()
  })
})

describe('serverless hosting (Vercel)', () => {
  it('requests long chapters in parts and joins the MP3 parts in order', async () => {
    const { useVoices } = await import('@/stores/voices')
    const provider = useVoices.getState().provider!
    useVoices.setState({ provider: { ...provider, audioFormat: 'mp3', maxCharsPerGenerate: 40 } })
    await updatePage('book1:1', { extractedText: 'First sentence is here. Second sentence is here. Third sentence is here.' })
    gen.mockImplementation(async (r) => audio(`[${r.text}]`, 'audio/mpeg'))
    const n = await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceA, settings })
    expect(gen.mock.calls.length).toBeGreaterThan(1)
    expect(gen.mock.calls.every(([r]) => r.text.length <= 40)).toBe(true)
    expect(await n.audioBlob.text()).toBe(gen.mock.calls.map(([r]) => `[${r.text}]`).join(''))
    expect(n.audioFormat).toBe('mp3')
    useVoices.setState({ provider })
  })

  it('runs "generate all" in the browser when the server cannot keep background jobs', async () => {
    const { useVoices } = await import('@/stores/voices')
    const { startBatch, useBatches } = await import('@/lib/batch')
    const provider = useVoices.getState().provider!
    useVoices.setState({ provider: { ...provider, serverJobs: false } })
    const createBatch = vi.fn()
    ;(api as unknown as { createBatch: typeof createBatch }).createBatch = createBatch
    gen.mockImplementation(async (r) => audio(r.text))
    await startBatch('book1', voiceA, settings)
    expect(createBatch).not.toHaveBeenCalled()
    expect(useBatches.getState().batches.book1).toMatchObject({ status: 'done', done: 3, total: 3, failed: 0 })
    expect(await listNarrations('book1')).toHaveLength(3)
    useVoices.setState({ provider })
  })
})
