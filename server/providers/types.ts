import type { ProviderInfo, VoiceInfo, VoiceSettings } from '../../shared/types'

export interface SynthesisResult {
  audio: Buffer
  format: 'mp3' | 'wav'
}

export interface TtsProvider {
  info: ProviderInfo
  /** Identifies provider + model, folded into the dedupe/cache key. */
  fingerprint: string
  listVoices(signal?: AbortSignal): Promise<VoiceInfo[]>
  /** Synthesize a single chunk of text (already <= info.maxCharsPerRequest). */
  synthesize(text: string, voice: VoiceInfo, settings: VoiceSettings, signal: AbortSignal): Promise<SynthesisResult>
}
