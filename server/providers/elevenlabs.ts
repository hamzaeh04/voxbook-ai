import type { VoiceInfo, VoicePersona, VoiceSettings } from '../../shared/types'
import { SAMPLE_SENTENCE } from '../../shared/voices'
import type { Config } from '../config'
import { ApiError, fromProviderStatus } from '../errors'
import type { SynthesisResult, TtsProvider } from './types'

const BASE = 'https://api.elevenlabs.io/v1'

/** Maps narration style to ElevenLabs voice_settings. */
const STYLE_SETTINGS: Record<VoiceSettings['style'], { stability: number; style: number }> = {
  neutral: { stability: 0.6, style: 0.0 },
  expressive: { stability: 0.35, style: 0.45 },
  calm: { stability: 0.8, style: 0.05 },
  dramatic: { stability: 0.3, style: 0.7 },
}

interface ElVoice {
  voice_id: string
  name: string
  description?: string | null
  labels?: Record<string, string>
}

export function createElevenLabsProvider(cfg: Config): TtsProvider {
  const { apiKey, model, maleId, femaleId, neutralId } = cfg.elevenlabs
  const personaById = new Map<string, VoicePersona>()
  if (maleId) personaById.set(maleId, 'heavy-male')
  if (femaleId) personaById.set(femaleId, 'warm-female')
  if (neutralId) personaById.set(neutralId, 'neutral')

  function toVoice(v: ElVoice): VoiceInfo {
    const persona = personaById.get(v.voice_id) ?? 'other'
    const labels = Object.values(v.labels ?? {}).filter(Boolean)
    const label =
      persona === 'heavy-male' ? 'Confident Heavy Male' : persona === 'warm-female' ? 'Warm Professional Female' : persona === 'neutral' ? 'Neutral Narrator' : v.name
    return {
      id: `elevenlabs:${v.voice_id}`,
      provider: 'elevenlabs',
      providerVoiceId: v.voice_id,
      displayName: label,
      description: v.description || `ElevenLabs voice “${v.name}”.`,
      language: v.labels?.language ?? 'Multilingual',
      characteristics: labels.length ? labels : ['ElevenLabs voice'],
      persona,
      supportedSettings: { style: true, pitch: false, speed: false },
      sampleText: SAMPLE_SENTENCE,
    }
  }

  return {
    info: {
      id: 'elevenlabs',
      label: `ElevenLabs (${model})`,
      external: true,
      configured: Boolean(apiKey),
      isMock: false,
      audioFormat: 'mp3',
      maxCharsPerRequest: 4500,
      retentionNote: 'Each page’s text is sent to ElevenLabs to generate audio. Review ElevenLabs’ data retention policy and your account’s privacy settings.',
      authRequired: Boolean(cfg.accessToken),
      setupHint: apiKey
        ? !(maleId && femaleId)
          ? 'Set ELEVENLABS_VOICE_MALE_ID / ELEVENLABS_VOICE_FEMALE_ID / ELEVENLABS_VOICE_NEUTRAL_ID to assign the three narrator personas.'
          : undefined
        : 'Set ELEVENLABS_API_KEY in your server .env file.',
    },
    fingerprint: `elevenlabs:${model}`,
    async listVoices(signal) {
      if (!apiKey) return []
      const res = await fetch(`${BASE}/voices`, { headers: { 'xi-api-key': apiKey }, signal })
      if (!res.ok) throw fromProviderStatus(res.status, await res.text().catch(() => ''))
      const data = (await res.json()) as { voices: ElVoice[] }
      const voices = data.voices.map(toVoice)
      // Surface the three personas first.
      const order: VoicePersona[] = ['heavy-male', 'warm-female', 'neutral', 'other']
      return voices.sort((a, b) => order.indexOf(a.persona) - order.indexOf(b.persona))
    },
    async synthesize(text, voice, settings, signal): Promise<SynthesisResult> {
      if (!apiKey) throw new ApiError('not_configured', 'ELEVENLABS_API_KEY is not set on the server.')
      const res = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(voice.providerVoiceId)}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({
          text,
          model_id: model,
          voice_settings: { similarity_boost: 0.75, use_speaker_boost: true, ...STYLE_SETTINGS[settings.style] },
        }),
        signal,
      })
      if (!res.ok) throw fromProviderStatus(res.status, await res.text().catch(() => ''), Number(res.headers.get('retry-after')) || undefined)
      return { audio: Buffer.from(await res.arrayBuffer()), format: 'mp3' }
    },
  }
}
