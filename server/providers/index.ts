import type { Config } from '../config'
import { createEdgeProvider } from './edge'
import { createElevenLabsProvider } from './elevenlabs'
import { createMockProvider } from './mock'
import { createOpenAIProvider } from './openai'
import type { TtsProvider } from './types'

export function createProvider(cfg: Config): TtsProvider {
  switch (cfg.provider) {
    case 'openai':
      return createOpenAIProvider(cfg)
    case 'elevenlabs':
      return createElevenLabsProvider(cfg)
    case 'edge':
      return createEdgeProvider()
    case 'mock':
      return createMockProvider()
    default:
      return {
        info: {
          id: 'none',
          label: 'No TTS provider configured',
          external: false,
          configured: false,
          isMock: false,
          audioFormat: 'mp3',
          maxCharsPerRequest: 3800,
          retentionNote: '',
          authRequired: Boolean(cfg.accessToken),
          setupHint: 'Copy .env.example to .env and set TTS_PROVIDER plus the provider’s API key, then restart the server.',
        },
        fingerprint: 'none',
        async listVoices() {
          return []
        },
        async synthesize() {
          throw new (await import('../errors')).ApiError('not_configured', 'No TTS provider is configured on the server.')
        },
      }
  }
}
