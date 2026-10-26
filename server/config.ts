import 'dotenv/config'

export type ProviderId = 'openai' | 'elevenlabs' | 'edge' | 'mock' | 'none'

function resolveProvider(env: NodeJS.ProcessEnv): ProviderId {
  const explicit = env.TTS_PROVIDER?.toLowerCase()
  if (explicit === 'openai' || explicit === 'elevenlabs' || explicit === 'edge' || explicit === 'mock' || explicit === 'none') return explicit
  if (env.OPENAI_API_KEY) return 'openai'
  if (env.ELEVENLABS_API_KEY) return 'elevenlabs'
  // No paid key: fall back to the free (unofficial) Microsoft Edge neural voices.
  return 'edge'
}

export interface Config {
  port: number
  provider: ProviderId
  production: boolean
  /** Running as serverless functions (Vercel): no long-lived background jobs, only /tmp is writable. */
  serverless: boolean
  accessToken?: string
  cacheDir: string
  /** Shared library storage: Vercel Blob when a token is present, else a local folder (not on serverless). */
  library: { blobToken?: string; blobAccess: 'public' | 'private'; dir: string }
  retentionHours: number
  requestTimeoutMs: number
  generateLimitPerMinute: number
  openai: { apiKey?: string; model: string; baseUrl: string }
  elevenlabs: { apiKey?: string; model: string; maleId?: string; femaleId?: string; neutralId?: string }
}

/**
 * Vercel names the Blob key `<PREFIX>_READ_WRITE_TOKEN`; the prefix is BLOB by default but can be
 * changed when connecting the store, so accept any variable whose value is a Blob read-write token.
 */
function findBlobToken(env: NodeJS.ProcessEnv): string | undefined {
  if (env.BLOB_READ_WRITE_TOKEN) return env.BLOB_READ_WRITE_TOKEN
  for (const [key, value] of Object.entries(env)) {
    if (key.endsWith('READ_WRITE_TOKEN') && value?.startsWith('vercel_blob_rw_')) return value
  }
  return undefined
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'
  let provider = resolveProvider(env)
  if (provider === 'mock' && production && env.ALLOW_MOCK_IN_PRODUCTION !== 'true') provider = 'none'
  const serverless = Boolean(env.VERCEL)
  return {
    port: Number(env.PORT ?? 8787),
    provider,
    production,
    serverless,
    accessToken: env.APP_ACCESS_TOKEN || undefined,
    cacheDir: env.CACHE_DIR ?? (serverless ? '/tmp/voxbook-cache' : 'server/.cache'),
    library: {
      blobToken: findBlobToken(env),
      blobAccess: env.BLOB_ACCESS === 'private' ? 'private' : 'public',
      dir: env.LIBRARY_DIR ?? 'server/.data/library',
    },
    retentionHours: Number(env.AUDIO_RETENTION_HOURS ?? 24),
    requestTimeoutMs: Number(env.TTS_TIMEOUT_MS ?? 60000),
    generateLimitPerMinute: Number(env.GENERATE_LIMIT_PER_MINUTE ?? 60),
    openai: {
      apiKey: env.OPENAI_API_KEY || undefined,
      model: env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
      baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    },
    elevenlabs: {
      apiKey: env.ELEVENLABS_API_KEY || undefined,
      model: env.ELEVENLABS_MODEL ?? 'eleven_multilingual_v2',
      maleId: env.ELEVENLABS_VOICE_MALE_ID || undefined,
      femaleId: env.ELEVENLABS_VOICE_FEMALE_ID || undefined,
      neutralId: env.ELEVENLABS_VOICE_NEUTRAL_ID || undefined,
    },
  }
}
