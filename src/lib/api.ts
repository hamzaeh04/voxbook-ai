import type {
  ApiErrorBody,
  ApiErrorCode,
  BatchRequest,
  BatchState,
  GenerateRequest,
  VoicesResponse,
} from '@shared/types'
import { useSettings } from '@/stores/settings'

export type ClientErrorCode = ApiErrorCode | 'network' | 'aborted'

export class ApiClientError extends Error {
  constructor(
    public code: ClientErrorCode,
    message: string,
    public retryAfter?: number,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
  /** Worth offering a Retry button. */
  get retryable() {
    return ['network', 'rate_limited', 'timeout', 'provider_error'].includes(this.code)
  }
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

function headers(extra: Record<string, string> = {}) {
  const token = useSettings.getState().accessToken
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(path, { ...init, headers: headers(init.headers as Record<string, string>) })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new ApiClientError('aborted', 'Request cancelled.')
    throw new ApiClientError('network', 'Cannot reach the narration server. Check that it is running and that you are online.')
  }
  if (!res.ok) {
    let body: ApiErrorBody | undefined
    try {
      body = await res.json()
    } catch {
      /* non-JSON error (e.g. proxy down) */
    }
    if (body?.error) throw new ApiClientError(body.error.code, body.error.message, body.error.retryAfter)
    if (res.status === 502 || res.status === 504) throw new ApiClientError('network', 'The narration server is not responding.')
    throw new ApiClientError('internal', `Unexpected server response (HTTP ${res.status}).`)
  }
  return res
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export interface GeneratedAudio {
  blob: Blob
  narrationId: string
  format: 'mp3' | 'wav'
  cached: boolean
}

async function toAudio(res: Response, fallbackId = ''): Promise<GeneratedAudio> {
  const format = (res.headers.get('X-Audio-Format') ?? (res.headers.get('content-type')?.includes('wav') ? 'wav' : 'mp3')) as 'mp3' | 'wav'
  return {
    blob: await res.blob(),
    narrationId: res.headers.get('X-Narration-Id') ?? fallbackId,
    format,
    cached: res.headers.get('X-Cache') === 'HIT',
  }
}

export const api = {
  async voices(): Promise<VoicesResponse> {
    return (await request('/api/voices')).json()
  },
  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GeneratedAudio> {
    return toAudio(await request('/api/narration/generate', { ...json(req), signal }))
  },
  async fetchAudio(id: string): Promise<GeneratedAudio> {
    return toAudio(await request(`/api/narration/${id}`), id)
  },
  async createBatch(req: BatchRequest): Promise<{ jobId: string }> {
    return (await request('/api/narration/batch', json(req))).json()
  },
  async getBatch(id: string): Promise<BatchState> {
    return (await request(`/api/narration/batch/${id}`)).json()
  },
  async cancelBatch(id: string): Promise<BatchState> {
    return (await request(`/api/narration/batch/${id}/cancel`, { method: 'POST' })).json()
  },
  async retryBatch(id: string): Promise<BatchState> {
    return (await request(`/api/narration/batch/${id}/retry`, { method: 'POST' })).json()
  },
}
