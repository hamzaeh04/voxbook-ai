import { getEngine } from './audioEngine'
import { addHistory, addListenSeconds, getBook, getNarration, getPage, updateBook } from './db'
import { cancelGeneration, ConsentDeniedError, generateForPage } from './narration'
import { clamp } from './utils'
import { usePlayback } from '@/stores/playback'
import { useReader } from '@/stores/reader'
import { useSettings } from '@/stores/settings'
import { pickVoice, useVoices } from '@/stores/voices'
import { ApiClientError, errorMessage } from './api'
import { toast } from '@/stores/toasts'

const set = usePlayback.setState
let token = 0
let listenAccum = 0
let lastTick = 0
let initialised = false
let lastHistoryKey = ''
/** createdAt of the narration currently loaded in the engine (detects regenerated audio). */
let loadedNarrationStamp = 0

/** Effective preferences for a book: per-book overrides, then global settings. */
export async function resolvePrefs(bookId: string) {
  const book = await getBook(bookId)
  const s = useSettings.getState()
  const voices = useVoices.getState().voices
  return {
    book,
    voice: pickVoice(voices, book?.preferredVoiceId ?? s.preferredVoiceId),
    settings: { style: s.style },
    rate: book?.playbackSpeed ?? s.playbackSpeed,
    continuous: book?.continuous ?? s.continuous,
  }
}

async function flushListening() {
  const secs = Math.floor(listenAccum)
  if (secs > 0) {
    listenAccum -= secs
    await addListenSeconds(secs)
  }
}

async function markPageComplete(bookId: string, pageNumber: number) {
  const book = await getBook(bookId)
  if (!book || book.completedPages.includes(pageNumber)) return
  const completed = [...book.completedPages, pageNumber].sort((a, b) => a - b)
  await updateBook(bookId, { completedPages: completed, readingProgress: completed.length / book.totalPages })
}

export function initPlayback() {
  if (initialised) return
  initialised = true
  const engine = getEngine()
  const el = engine.el
  const mine = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => !engine.previewing && fn(...a)
  el.addEventListener('timeupdate', mine(() => {
    const now = performance.now()
    if (!el.paused && lastTick && now - lastTick < 2000) listenAccum += (now - lastTick) / 1000
    lastTick = now
    set({ currentTime: el.currentTime, duration: Number.isFinite(el.duration) ? el.duration : usePlayback.getState().duration })
    if (listenAccum >= 15) void flushListening()
  }))
  el.addEventListener('loadedmetadata', mine(() => Number.isFinite(el.duration) && set({ duration: el.duration })))
  el.addEventListener('play', mine(() => ((lastTick = performance.now()), set({ status: 'playing', error: undefined }))))
  el.addEventListener('pause', mine(() => {
    void flushListening()
    const st = usePlayback.getState().status
    if (st === 'playing') set({ status: 'paused' })
  }))
  el.addEventListener('waiting', mine(() => usePlayback.getState().status === 'playing' && set({ status: 'loading' })))
  el.addEventListener('playing', mine(() => set({ status: 'playing' })))
  el.addEventListener('error', mine(() => {
    if (el.getAttribute('src')) set({ status: 'error', error: 'This audio file could not be played. Try regenerating it.' })
  }))
  el.addEventListener('ended', mine(() => void onEnded()))
}

async function onEnded() {
  const st = usePlayback.getState()
  set({ status: 'ended', currentTime: 0 })
  await flushListening()
  if (!st.bookId || !st.pageNumber) return
  await markPageComplete(st.bookId, st.pageNumber)
  const { continuous } = await resolvePrefs(st.bookId)
  if (!continuous || !st.totalPages || st.pageNumber >= st.totalPages) return
  await advanceTo(st.bookId, st.pageNumber + 1, st.bookTitle, st.totalPages)
}

/** Continuous-reading advance: move the reader first so UI and audio never disagree. */
async function advanceTo(bookId: string, next: number, bookTitle?: string, totalPages?: number) {
  // Update the playback page first so the reader's wrong-page guard sees them agree.
  set({ pageNumber: next })
  const reader = useReader.getState()
  if (reader.bookId === bookId) reader.setPage(next)
  const existing = await getNarration(bookId, next)
  const page = await getPage(bookId, next)
  const hasText = Boolean(page?.extractedText.trim())
  if (!existing && hasText && !useSettings.getState().autoGenerateNext) {
    set({ pageNumber: next, offerGenerate: { bookId, pageNumber: next }, status: 'paused', currentTime: 0, duration: 0, bookTitle, totalPages })
    return
  }
  if (!hasText) {
    // Nothing to narrate (blank/scanned page): skip ahead rather than stalling.
    if (totalPages && next < totalPages) return advanceTo(bookId, next + 1, bookTitle, totalPages)
    return
  }
  await playPage(bookId, next)
}

/** Load (generating if needed) and play the narration for one page. */
export async function playPage(bookId: string, pageNumber: number, opts: { generateIfMissing?: boolean } = {}) {
  const mine = ++token
  const engine = getEngine()
  const prev = usePlayback.getState()
  if (prev.status === 'generating' && prev.bookId && prev.pageNumber && (prev.bookId !== bookId || prev.pageNumber !== pageNumber)) {
    cancelGeneration(prev.bookId, prev.pageNumber) // the user moved on: stop waiting for the old page
  }
  engine.pause()
  engine.previewing = false
  const prefs = await resolvePrefs(bookId)
  if (!prefs.book) return
  set({
    bookId,
    bookTitle: prefs.book.title,
    pageNumber,
    totalPages: prefs.book.totalPages,
    status: 'loading',
    currentTime: 0,
    duration: 0,
    error: undefined,
    offerGenerate: undefined,
  })
  try {
    let narration = await getNarration(bookId, pageNumber)
    if (!narration) {
      if (opts.generateIfMissing === false) {
        set({ status: 'idle' })
        return
      }
      if (!prefs.voice) throw new ApiClientError('not_configured', 'No narration voice is available. Check the TTS setup in Voice Studio.')
      set({ status: 'generating', voiceName: prefs.voice.displayName })
      narration = await generateForPage({ bookId, pageNumber, voice: prefs.voice, settings: prefs.settings })
    }
    // A newer request (page change, stop) supersedes this one: never play stale audio.
    if (mine !== token) return
    engine.load(narration.audioBlob)
    loadedNarrationStamp = narration.createdAt
    engine.el.playbackRate = prefs.rate
    engine.el.volume = useSettings.getState().volume
    set({ voiceName: narration.voiceName, duration: narration.duration })
    await engine.play()
    const key = `${bookId}:${pageNumber}`
    if (key !== lastHistoryKey) {
      lastHistoryKey = key
      void addHistory({ bookId, bookTitle: prefs.book.title, pageNumber, at: Date.now(), kind: 'listen' })
    }
  } catch (e) {
    if (mine !== token) return
    if (e instanceof ApiClientError && e.code === 'aborted') return set({ status: 'idle' })
    if (e instanceof ConsentDeniedError) return set({ status: 'idle' })
    if ((e as Error).name === 'NotAllowedError') return set({ status: 'paused' }) // autoplay blocked: user can press play
    set({ status: 'error', error: errorMessage(e) })
    toast.error(errorMessage(e))
  }
}

export async function togglePlay(bookId: string, pageNumber: number) {
  const st = usePlayback.getState()
  const engine = getEngine()
  let loaded = st.bookId === bookId && st.pageNumber === pageNumber && engine.hasSource && st.status !== 'error'
  if (loaded) {
    // The page may have been regenerated since this track was loaded: never resume stale audio.
    const current = await getNarration(bookId, pageNumber)
    if (!current || current.createdAt !== loadedNarrationStamp) loaded = false
  }
  if (loaded) {
    if (st.status === 'playing' || st.status === 'loading') return engine.pause()
    if (st.status === 'ended') engine.seek(0)
    return void engine.play().catch(() => undefined)
  }
  await playPage(bookId, pageNumber)
}

export function stopPlayback() {
  token++
  const st = usePlayback.getState()
  if (st.status === 'generating' && st.bookId && st.pageNumber) cancelGeneration(st.bookId, st.pageNumber)
  const engine = getEngine()
  engine.stop()
  void flushListening()
  set({ status: 'idle', currentTime: 0, offerGenerate: undefined })
}

/** Fully release the current track (used when its page/book no longer applies). */
export function unloadPlayback() {
  token++
  getEngine().unload()
  set({ bookId: undefined, pageNumber: undefined, status: 'idle', currentTime: 0, duration: 0, offerGenerate: undefined })
}

export function restart() {
  const engine = getEngine()
  engine.seek(0)
  if (engine.hasSource) void engine.play().catch(() => undefined)
}

export const seek = (t: number) => getEngine().seek(clamp(t, 0, usePlayback.getState().duration || t))

export function setRate(rate: number) {
  getEngine().el.playbackRate = rate
}
export function setVolume(v: number) {
  getEngine().el.volume = clamp(v, 0, 1)
}

/** Step the playing track to the previous/next page (keeps playing if currently playing). */
export async function stepPage(delta: 1 | -1) {
  const st = usePlayback.getState()
  if (!st.bookId || !st.pageNumber || !st.totalPages) return
  const n = st.pageNumber + delta
  if (n < 1 || n > st.totalPages) return
  set({ pageNumber: n })
  const reader = useReader.getState()
  if (reader.bookId === st.bookId) reader.setPage(n)
  await playPage(st.bookId, n)
}

export const isPagePlaying = (bookId: string, pageNumber: number) => {
  const s = usePlayback.getState()
  return s.bookId === bookId && s.pageNumber === pageNumber && s.status === 'playing'
}

/** Player-bar page step: keeps playing if audio is active, otherwise only moves the reader. */
export async function navigatePage(delta: 1 | -1) {
  const st = usePlayback.getState()
  const reader = useReader.getState()
  const active = st.status === 'playing' || st.status === 'loading' || st.status === 'generating'
  if (active && st.bookId) return stepPage(delta)
  if (reader.bookId) reader.setPage(reader.page + delta)
  else await stepPage(delta)
}

/**
 * Call after a page's audio was regenerated. If that page is the loaded track, swap in the new
 * audio: restart it if it was playing, otherwise just drop the stale track so Play loads the new one.
 */
export async function refreshLoadedNarration(bookId: string, pageNumber: number) {
  const st = usePlayback.getState()
  if (st.bookId !== bookId || st.pageNumber !== pageNumber || !getEngine().hasSource) return
  const current = await getNarration(bookId, pageNumber)
  if (!current || current.createdAt === loadedNarrationStamp) return
  if (st.status === 'playing' || st.status === 'loading') return playPage(bookId, pageNumber)
  token++
  getEngine().unload()
  loadedNarrationStamp = 0
  set({ status: 'idle', currentTime: 0, duration: current.duration, voiceName: current.voiceName })
}
