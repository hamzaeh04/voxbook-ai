import type { ApiErrorCode } from '../shared/types'

const STATUS: Record<ApiErrorCode, number> = {
  validation: 400,
  unauthorized: 401,
  not_configured: 503,
  rate_limited: 429,
  quota_exceeded: 402,
  provider_error: 502,
  timeout: 504,
  not_found: 404,
  internal: 500,
}

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public retryAfter?: number,
  ) {
    super(message)
  }
  get status() {
    return STATUS[this.code]
  }
}

/** Map an upstream provider HTTP failure to a typed error. Never leaks keys. */
export function fromProviderStatus(status: number, body: string, retryAfter?: number): ApiError {
  const lower = body.toLowerCase()
  if (status === 429 && (lower.includes('quota') || lower.includes('billing') || lower.includes('credit')))
    return new ApiError('quota_exceeded', 'The TTS provider quota or billing limit has been reached.')
  if (status === 429) return new ApiError('rate_limited', 'The TTS provider is rate limiting requests. Try again shortly.', retryAfter ?? 20)
  if (status === 401 || status === 403) return new ApiError('not_configured', 'The TTS provider rejected the server credentials. Check the API key.')
  if (status === 402) return new ApiError('quota_exceeded', 'The TTS provider requires payment or has no remaining credits.')
  return new ApiError('provider_error', `The TTS provider returned an error (HTTP ${status}).`)
}
