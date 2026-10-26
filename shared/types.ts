/** Types shared by the web client and the Express server. */

export type NarrationStyle = 'neutral' | 'expressive' | 'calm' | 'dramatic'

/** Settings that change the generated audio (and therefore the cache key). */
export interface VoiceSettings {
  style: NarrationStyle
}

export type VoicePersona = 'heavy-male' | 'warm-female' | 'neutral' | 'other'

export interface VoiceInfo {
  id: string
  provider: string
  providerVoiceId: string
  displayName: string
  description: string
  language: string
  /** Honest characteristics reported or configured for this voice. */
  characteristics: string[]
  persona: VoicePersona
  supportedSettings: { style: boolean; pitch: boolean; speed: boolean }
  sampleText?: string
  /** BCP-47 locale, e.g. "en-GB" (used for SSML and language filtering). */
  locale?: string
  gender?: 'Male' | 'Female' | 'Neutral'
  /** Reads many languages, not just its own locale. */
  multilingual?: boolean
}

export interface ProviderInfo {
  id: string
  label: string
  /** True when page text leaves this machine for a third party. */
  external: boolean
  configured: boolean
  isMock: boolean
  audioFormat: 'mp3' | 'wav'
  maxCharsPerRequest: number
  retentionNote: string
  authRequired: boolean
  setupHint?: string
  /** Changes whenever the provider/model/engine would produce different audio for the same input. */
  engineVersion?: string
  /** Server can run whole-book batch jobs in the background (false on serverless hosts). */
  serverJobs?: boolean
  /** Largest text the client should send per request (keeps responses under host size limits). */
  maxCharsPerGenerate?: number
}

export interface VoicesResponse {
  provider: ProviderInfo
  voices: VoiceInfo[]
}

export interface GenerateRequest {
  text: string
  voiceId: string
  settings: VoiceSettings
}

export type ApiErrorCode =
  | 'validation'
  | 'unauthorized'
  | 'not_configured'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'provider_error'
  | 'timeout'
  | 'not_found'
  | 'internal'

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; retryAfter?: number }
}

export interface BatchItemInput {
  /** Client-side identifier, echoed back (e.g. page number). */
  key: string
  text: string
}

export interface BatchRequest {
  voiceId: string
  settings: VoiceSettings
  items: BatchItemInput[]
}

export type BatchItemStatus = 'queued' | 'generating' | 'done' | 'error' | 'cancelled'

export interface BatchItemState {
  key: string
  status: BatchItemStatus
  narrationId?: string
  format?: 'mp3' | 'wav'
  error?: { code: ApiErrorCode; message: string }
}

export interface BatchState {
  id: string
  status: 'running' | 'done' | 'cancelled' | 'failed'
  items: BatchItemState[]
  message?: string
}

/** Longest single narration unit (a chapter; longer chapters are split into parts at import). */
export const MAX_CHARS_PER_PAGE = 60000
/** Total text accepted in one batch request. */
export const MAX_BATCH_CHARS = 4_000_000
export const MAX_BATCH_ITEMS = 1000
