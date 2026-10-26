import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeEngine {
  el = new EventTarget() as unknown as HTMLAudioElement & { playbackRate: number; volume: number }
  previewing = false
  blobs: Blob[] = []
  playing = false
  hasSource = false
  load = vi.fn((b: Blob) => { this.blobs.push(b); this.hasSource = true })
  texts = () => Promise.all(this.blobs.map((b) => b.text()))
  play = vi.fn(async () => { this.playing = true })
  pause = vi.fn(() => { this.playing = false })
  stop = vi.fn(() => { this.playing = false })
  seek = vi.fn()
  unload = vi.fn(() => { this.hasSource = false })
}
const engine = new FakeEngine()
vi.mock('@/lib/audioEngine', () => ({ getEngine: () => engine }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: { generate: vi.fn(), fetchAudio: vi.fn() } }))
vi.mock('@/lib/audioMeta', () => ({ readDuration: vi.fn(async () => 2) }))

import { api } from '@/lib/api'
import { getBook, updateBook } from '@/lib/db'
import { playPage, refreshLoadedNarration, stopPlayback, stepPage, navigatePage, togglePlay } from '@/lib/playback'
import { generateForPage } from '@/lib/narration'
import { voiceB } from './helpers'
import { usePlayback } from '@/stores/playback'
import { useReader } from '@/stores/reader'
import { useSettings } from '@/stores/settings'
import { audio, freshLibrary } from './helpers'

const gen = vi.mocked(api.generate)

beforeEach(async () => {
  gen.mockReset()
  engine.blobs = []
  engine.playing = false
  engine.hasSource = false
  engine.play.mockClear()
  usePlayback.setState({ bookId: undefined, pageNumber: undefined, status: 'idle', currentTime: 0, duration: 0 })
  useSettings.setState({ preferredVoiceId: 'mock:deep' })
  const book = await freshLibrary(['Alpha page.', 'Beta page.', 'Gamma page.'])
  useReader.getState().open(book.id, 1, 3, book.title)
})

describe('reader page navigation', () => {
  it('clamps to valid pages', () => {
    const r = useReader.getState()
    r.setPage(2)
    expect(useReader.getState().page).toBe(2)
    r.setPage(0)
    r.setPage(99)
    expect(useReader.getState().page).toBe(2)
  })
})

describe('playback never reads the wrong page', () => {
  it('drops a slow narration response if the user moved on to another page', async () => {
    let release!: () => void
    gen.mockImplementation(async (req) => {
      if (req.text.startsWith('Alpha')) await new Promise<void>((r) => (release = r))
      return audio(`audio:${req.text}`)
    })
    const first = playPage('book1', 1)
    await vi.waitFor(() => expect(gen).toHaveBeenCalledTimes(1))
    const second = playPage('book1', 2)
    await second
    release()
    await first
    expect(await engine.texts()).toEqual(['audio:Beta page.'])
    expect(usePlayback.getState().pageNumber).toBe(2) // the fake engine emits no 'playing' event, so status stays put
    expect(engine.play).toHaveBeenCalledTimes(1)
  })

  it('stop invalidates any in-flight request', async () => {
    let release!: () => void
    gen.mockImplementation(async () => (await new Promise<void>((r) => (release = r)), audio('late')))
    const p = playPage('book1', 1)
    await vi.waitFor(() => expect(gen).toHaveBeenCalled())
    stopPlayback()
    release()
    await p
    expect(await engine.texts()).toEqual([])
    expect(usePlayback.getState().status).toBe('idle')
  })

  it('uses stored narration without calling the provider', async () => {
    gen.mockResolvedValue(audio('stored'))
    await playPage('book1', 1)
    await playPage('book1', 1)
    expect(gen).toHaveBeenCalledTimes(1)
    expect(await engine.texts()).toEqual(['stored', 'stored'])
  })

  it('does not generate when asked only to play saved audio', async () => {
    await playPage('book1', 3, { generateIfMissing: false })
    expect(gen).not.toHaveBeenCalled()
    expect(usePlayback.getState().status).toBe('idle')
  })

  it('player-bar stepping moves reader and audio together while playing', async () => {
    gen.mockImplementation(async (r) => audio(r.text))
    await playPage('book1', 1)
    await stepPage(1)
    expect(useReader.getState().page).toBe(2)
    expect(usePlayback.getState().pageNumber).toBe(2)
    expect((await engine.texts()).at(-1)).toBe('Beta page.')
  })

  it('player-bar stepping only moves the reader when nothing is playing', async () => {
    await navigatePage(1)
    expect(useReader.getState().page).toBe(2)
    expect(gen).not.toHaveBeenCalled()
  })
})

describe('regenerating with a different voice', () => {
  it('Play never resumes the stale track after the page was regenerated', async () => {
    gen.mockImplementation(async (r) => audio(`${r.voiceId}:${r.text}`))
    await playPage('book1', 1) // loads voice A
    usePlayback.setState({ status: 'paused' })
    await new Promise((r) => setTimeout(r, 5)) // distinct createdAt
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceB, settings: { style: 'neutral' }, force: true })
    await togglePlay('book1', 1)
    expect((await engine.texts()).at(-1)).toBe('mock:warm:Alpha page.')
  })

  it('swaps in the new audio immediately if the page was playing', async () => {
    gen.mockImplementation(async (r) => audio(`${r.voiceId}:${r.text}`))
    await playPage('book1', 1)
    usePlayback.setState({ status: 'playing' })
    await new Promise((r) => setTimeout(r, 5))
    await generateForPage({ bookId: 'book1', pageNumber: 1, voice: voiceB, settings: { style: 'neutral' }, force: true })
    await refreshLoadedNarration('book1', 1)
    expect((await engine.texts()).at(-1)).toBe('mock:warm:Alpha page.')
    expect(usePlayback.getState().voiceName).toBe('Warm')
  })
})

describe('continuous reading', () => {
  async function finishCurrentPage() {
    engine.el.dispatchEvent(new Event('ended'))
    await new Promise((r) => setTimeout(r, 60))
  }
  it('advances to the next page and plays it; single-page mode stops', async () => {
    const { initPlayback } = await import('@/lib/playback')
    initPlayback()
    gen.mockImplementation(async (r) => audio(r.text))
    useSettings.setState({ autoGenerateNext: true })

    await updateBook('book1', { continuous: false })
    await playPage('book1', 1)
    await finishCurrentPage()
    expect(useReader.getState().page).toBe(1)
    expect(usePlayback.getState().status).toBe('ended')

    await updateBook('book1', { continuous: true })
    await playPage('book1', 1)
    await finishCurrentPage()
    expect(useReader.getState().page).toBe(2)
    expect((await engine.texts()).at(-1)).toBe('Beta page.')
    expect((await getBook('book1'))!.completedPages).toContain(1)
  })

  it('offers to generate instead of silently spending when auto-generate is off', async () => {
    const { initPlayback } = await import('@/lib/playback')
    initPlayback()
    gen.mockImplementation(async (r) => audio(r.text))
    useSettings.setState({ autoGenerateNext: false })
    await updateBook('book1', { continuous: true })
    await playPage('book1', 1)
    gen.mockClear()
    await finishCurrentPage()
    expect(gen).not.toHaveBeenCalled()
    expect(usePlayback.getState().offerGenerate).toEqual({ bookId: 'book1', pageNumber: 2 })
    expect(useReader.getState().page).toBe(2)
  })
})
