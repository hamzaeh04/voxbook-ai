import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: { generate: vi.fn(), fetchAudio: vi.fn(), createBatch: vi.fn() } }))
vi.mock('@/lib/audioMeta', () => ({ readDuration: vi.fn(async () => 1) }))
vi.mock('@/lib/kokoro', async (orig) => ({
  ...(await orig<typeof import('@/lib/kokoro')>()),
  generateKokoro: vi.fn(async (text: string, voiceId: string) => ({ blob: new Blob([`kokoro:${voiceId}:${text.slice(0, 12)}`]), duration: 7.5 })),
}))

import { api } from '@/lib/api'
import { generateKokoro, KOKORO_ENGINE } from '@/lib/kokoro'
import { MAX_PIECE_CHARS, planPerformance } from '@/lib/kokoro/plan'
import { KOKORO_VOICES } from '@/lib/kokoro/voices'
import { getNarration } from '@/lib/db'
import { generateForPage, narrationIsCurrent } from '@/lib/narration'
import { useConsent } from '@/stores/consent'
import { useVoices } from '@/stores/voices'
import { freshLibrary, provider } from './helpers'

const heart = KOKORO_VOICES.find((v) => v.id === 'kokoro:af_heart')!

describe('Kokoro performance plan', () => {
  it('performs moods with pace, loudness and pauses', () => {
    const plan = planPerformance('They wept in sorrow for the dead. Rise up and fight! Who goes there?', 'expressive')
    const [sad, excited, question] = plan
    expect(sad.mood).toBe('somber')
    expect(sad.speed).toBeLessThan(1)
    expect(sad.gain).toBeLessThan(1)
    expect(excited.mood).toBe('excited')
    expect(excited.speed).toBeGreaterThan(1)
    expect(excited.gain).toBeGreaterThan(1)
    expect(question.mood).toBe('questioning')
    expect(sad.pauseMs).toBeGreaterThan(excited.pauseMs) // a sad line lingers
  })

  it('reads flat for Neutral, and stronger with longer pauses for Dramatic', () => {
    const text = 'They wept in sorrow for the dead. Rise up and fight!'
    expect(planPerformance(text, 'neutral').every((p) => p.speed === 1 && p.gain === 1)).toBe(true)
    const [d] = planPerformance(text, 'dramatic')
    const [e] = planPerformance(text, 'expressive')
    expect(d.speed).toBeLessThan(e.speed)
    expect(d.pauseMs).toBeGreaterThan(e.pauseMs)
  })

  it('never sends Kokoro a piece long enough to be silently truncated, and keeps every word', () => {
    const long = 'And the angel spoke, ' + Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ') + ', and it was done.'
    const plan = planPerformance(`CHAPTER ONE\n\n${long}`, 'expressive')
    expect(plan[0]).toMatchObject({ mood: 'heading' })
    expect(plan.every((p) => p.text.length <= MAX_PIECE_CHARS)).toBe(true)
    expect(plan.slice(1).map((p) => p.text).join(' ').replace(/\s+/g, ' ')).toBe(long)
  })
})

describe('Kokoro narration', () => {
  beforeEach(async () => {
    vi.mocked(api.generate).mockReset()
    vi.mocked(generateKokoro).mockClear()
    await freshLibrary()
    useVoices.setState({ provider: { ...provider, external: true, engineVersion: 'edge-v2' }, voices: [...useVoices.getState().voices, ...KOKORO_VOICES] })
  })

  it('generates on the device: no server request and no consent prompt', async () => {
    const request = vi.spyOn(useConsent.getState(), 'request')
    const n = await generateForPage({ bookId: 'book1', pageNumber: 1, voice: heart, settings: { style: 'expressive' } })
    expect(generateKokoro).toHaveBeenCalledWith('Page one text.', 'kokoro:af_heart', 'expressive', expect.objectContaining({ key: 'book1:1' }))
    expect(api.generate).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(n).toMatchObject({ voiceId: 'kokoro:af_heart', audioFormat: 'mp3', duration: 7.5, engine: KOKORO_ENGINE })
  })

  it('versions audio per engine, so Kokoro and Edge audio never mark each other outdated', async () => {
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: heart, settings: { style: 'expressive' } })
    const n = (await getNarration('book1', 1))!
    expect(narrationIsCurrent(n, { extractedText: 'Page one text.' }, 'kokoro:af_heart', { style: 'expressive' })).toBe(true)
    // same Kokoro voice again: reused, not regenerated
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: heart, settings: { style: 'expressive' } })
    expect(generateKokoro).toHaveBeenCalledTimes(1)
  })

  it('runs "generate all" for Kokoro voices in this tab, never as a server job', async () => {
    const { startBatch, useBatches } = await import('@/lib/batch')
    await startBatch('book1', heart, { style: 'expressive' })
    expect(api.createBatch).not.toHaveBeenCalled()
    expect(useBatches.getState().batches.book1).toMatchObject({ status: 'done', done: 3 })
  })
})
