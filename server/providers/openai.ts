import type { VoiceInfo, VoiceSettings } from '../../shared/types'
import { STYLE_INSTRUCTIONS, SAMPLE_SENTENCE } from '../../shared/voices'
import type { Config } from '../config'
import { ApiError, fromProviderStatus } from '../errors'
import type { SynthesisResult, TtsProvider } from './types'

/**
 * OpenAI voices. Persona labels are the closest *available* match and are described
 * honestly: OpenAI does not publish gender/age metadata, so only these three
 * assignments are claimed, and they can be changed in the catalog below.
 */
const CATALOG: Array<Omit<VoiceInfo, 'id' | 'provider' | 'language' | 'supportedSettings' | 'sampleText'>> = [
  {
    providerVoiceId: 'onyx',
    displayName: 'Confident Heavy Male',
    description: 'OpenAI “onyx” — the deepest male voice OpenAI offers. Low, authoritative and steady; best for nonfiction, biography and drama.',
    characteristics: ['Deep', 'Authoritative', 'Male'],
    persona: 'heavy-male',
  },
  {
    providerVoiceId: 'nova',
    displayName: 'Warm Professional Female',
    description: 'OpenAI “nova” — warm, clear and expressive female voice. Good for novels, education and long listening sessions.',
    characteristics: ['Warm', 'Expressive', 'Female'],
    persona: 'warm-female',
  },
  {
    providerVoiceId: 'alloy',
    displayName: 'Neutral Narrator',
    description: 'OpenAI “alloy” — balanced, even delivery for general reading and study.',
    characteristics: ['Balanced', 'Neutral'],
    persona: 'neutral',
  },
  ...['ash', 'ballad', 'coral', 'echo', 'fable', 'sage', 'shimmer', 'verse'].map((v) => ({
    providerVoiceId: v,
    displayName: `OpenAI ${v[0].toUpperCase()}${v.slice(1)}`,
    description: `Additional OpenAI voice “${v}”. Preview it to hear its character.`,
    characteristics: ['Additional voice'],
    persona: 'other' as const,
  })),
]

export function createOpenAIProvider(cfg: Config): TtsProvider {
  const { apiKey, model, baseUrl } = cfg.openai
  const steerable = model.startsWith('gpt-4o')
  const voices: VoiceInfo[] = CATALOG.map((v) => ({
    ...v,
    id: `openai:${v.providerVoiceId}`,
    provider: 'openai',
    language: 'Multilingual (English optimised)',
    supportedSettings: { style: steerable, pitch: false, speed: false },
    sampleText: SAMPLE_SENTENCE,
  }))

  return {
    info: {
      id: 'openai',
      label: `OpenAI (${model})`,
      external: true,
      configured: Boolean(apiKey),
      isMock: false,
      audioFormat: 'mp3',
      maxCharsPerRequest: 3800,
      retentionNote:
        'Each page’s text is sent to OpenAI to generate audio. Review OpenAI’s API data-usage policy; API data is not used for training by default.',
      authRequired: Boolean(cfg.accessToken),
      setupHint: apiKey ? undefined : 'Set OPENAI_API_KEY in your server .env file.',
    },
    fingerprint: `openai:${model}`,
    async listVoices() {
      return voices
    },
    async synthesize(text, voice, settings: VoiceSettings, signal): Promise<SynthesisResult> {
      if (!apiKey) throw new ApiError('not_configured', 'OPENAI_API_KEY is not set on the server.')
      const body: Record<string, unknown> = {
        model,
        voice: voice.providerVoiceId,
        input: text,
        response_format: 'mp3',
      }
      if (steerable) body.instructions = STYLE_INSTRUCTIONS[settings.style]
      const res = await fetch(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok) {
        throw fromProviderStatus(res.status, await res.text().catch(() => ''), Number(res.headers.get('retry-after')) || undefined)
      }
      return { audio: Buffer.from(await res.arrayBuffer()), format: 'mp3' }
    },
  }
}
