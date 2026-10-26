import type { VoiceInfo, VoiceSettings } from '../../shared/types'
import type { SynthesisResult, TtsProvider } from './types'

/**
 * MOCK provider — development and automated tests only.
 * Produces a deterministic WAV of synthetic tones whose length scales with the
 * text. It is NOT speech and is clearly labelled as such throughout the UI.
 * Disabled in production unless ALLOW_MOCK_IN_PRODUCTION=true.
 */
const BASE_FREQ: Record<string, number> = { 'mock:deep': 110, 'mock:warm': 220, 'mock:neutral': 165 }

const voices: VoiceInfo[] = [
  { id: 'mock:deep', name: 'Mock Deep Tone', persona: 'heavy-male' as const },
  { id: 'mock:warm', name: 'Mock Warm Tone', persona: 'warm-female' as const },
  { id: 'mock:neutral', name: 'Mock Neutral Tone', persona: 'neutral' as const },
].map((v) => ({
  id: v.id,
  provider: 'mock',
  providerVoiceId: v.id,
  displayName: `${v.name} (MOCK)`,
  description: 'Synthetic test tones, not speech. For development and tests only.',
  language: 'n/a',
  characteristics: ['Mock', 'Not speech'],
  persona: v.persona,
  supportedSettings: { style: false, pitch: false, speed: false },
}))

export function createWav(seconds: number, freq: number, sampleRate = 16000): Buffer {
  const n = Math.max(1, Math.floor(seconds * sampleRate))
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate
    // syllable-like amplitude envelope, ~4 pulses/second
    const env = 0.5 * (1 + Math.sin(2 * Math.PI * 4 * t - Math.PI / 2))
    const sample = Math.sin(2 * Math.PI * freq * t) * env * 0.35
    buf.writeInt16LE(Math.round(sample * 32767), 44 + i * 2)
  }
  return buf
}

export function createMockProvider(): TtsProvider {
  return {
    info: {
      id: 'mock',
      label: 'MOCK provider (development only — not real speech)',
      external: false,
      configured: true,
      isMock: true,
      audioFormat: 'wav',
      maxCharsPerRequest: 60000, // WAV can't be concatenated, so the mock answers a whole chapter in one piece
      retentionNote: 'Mock provider: nothing leaves this machine, and the audio is synthetic tones.',
      authRequired: false,
    },
    fingerprint: 'mock:v1',
    async listVoices() {
      return voices
    },
    async synthesize(text: string, voice: VoiceInfo, _settings: VoiceSettings): Promise<SynthesisResult> {
      const seconds = Math.min(60, Math.max(0.6, text.length / 15))
      return { audio: createWav(seconds, BASE_FREQ[voice.id] ?? 180), format: 'wav' }
    },
  }
}
