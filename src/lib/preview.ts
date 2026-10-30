import { create } from 'zustand'
import type { VoiceInfo, VoiceSettings } from '@shared/types'
import { EMOTION_SAMPLE, SAMPLE_SENTENCE, STYLE_LABELS } from '@shared/voices'
import { downloadBlob, safeFileStem } from './utils'
import { toast } from '@/stores/toasts'
import { api, ApiClientError, errorMessage } from './api'
import { getEngine } from './audioEngine'
import { ensureConsent, ConsentDeniedError } from './narration'
import { generateKokoro } from './kokoro'
import { isKokoro } from './kokoro/voices'
import { unloadPlayback } from './playback'
import { useSettings } from '@/stores/settings'

interface PreviewState {
  voiceId?: string
  status: 'idle' | 'generating' | 'playing' | 'error'
  error?: string
}
export const usePreview = create<PreviewState>(() => ({ status: 'idle' }))

const cache = new Map<string, Blob>()
let token = 0
let wired = false

function wire() {
  if (wired) return
  wired = true
  const el = getEngine().el
  const done = () => usePreview.getState().status === 'playing' && usePreview.setState({ status: 'idle' })
  el.addEventListener('ended', done)
  el.addEventListener('pause', done)
}

export function stopPreview() {
  token++
  const engine = getEngine()
  if (engine.previewing) engine.stop()
  usePreview.setState({ status: 'idle', voiceId: undefined })
}

/** The voice's sample sentence as audio, generated once per voice and style for this session. */
async function sampleBlob(voice: VoiceInfo, settings: VoiceSettings): Promise<Blob> {
  const key = `${voice.id}|${settings.style}`
  const hit = cache.get(key)
  if (hit) return hit
  let blob: Blob
  if (isKokoro(voice.id)) {
    blob = (await generateKokoro(EMOTION_SAMPLE, voice.id, settings.style, { key: `preview:${voice.id}` })).blob
  } else {
    await ensureConsent()
    blob = (await api.generate({ text: voice.sampleText ?? SAMPLE_SENTENCE, voiceId: voice.id, settings })).blob
  }
  cache.set(key, blob)
  return blob
}

/** Voice ids whose sample is being prepared for download (drives the card's button state). */
export const useSampleDownloads = create<{ busy: Record<string, boolean> }>(() => ({ busy: {} }))

/** Download a voice's sample sentence as an audio file, e.g. `Bella_US_Emotional_sample.mp3`. */
export async function downloadVoiceSample(voice: VoiceInfo, settings: VoiceSettings) {
  const setBusy = (on: boolean) => useSampleDownloads.setState((s) => ({ busy: { ...s.busy, [voice.id]: on } }))
  setBusy(true)
  try {
    const blob = await sampleBlob(voice, settings)
    const ext = blob.type.includes('wav') ? 'wav' : 'mp3'
    downloadBlob(blob, `${safeFileStem(voice.displayName)}_${STYLE_LABELS[settings.style].split(' ')[0]}_sample.${ext}`)
  } catch (e) {
    if (!(e instanceof ConsentDeniedError)) toast.error(`Could not prepare the ${voice.displayName} sample: ${errorMessage(e)}`)
  } finally {
    setBusy(false)
  }
}

/** Plays a short sample sentence in the chosen voice. Samples are cached for the session to avoid repeat billing. */
export async function previewVoice(voice: VoiceInfo, settings: VoiceSettings) {
  wire()
  const mine = ++token
  const engine = getEngine()
  unloadPlayback()
  engine.pause()
  engine.previewing = true
  usePreview.setState({ voiceId: voice.id, status: 'generating', error: undefined })
  try {
    const blob = await sampleBlob(voice, settings)
    if (mine !== token) return
    engine.load(blob)
    engine.el.volume = useSettings.getState().volume
    engine.el.playbackRate = 1
    usePreview.setState({ status: 'playing' })
    await engine.play()
  } catch (e) {
    if (mine !== token) return
    engine.previewing = false
    if (e instanceof ConsentDeniedError) return usePreview.setState({ status: 'idle', voiceId: undefined })
    usePreview.setState({ status: 'error', error: e instanceof ApiClientError || e instanceof Error ? errorMessage(e) : 'Preview failed' })
  }
}
