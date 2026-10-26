import { createHash } from 'node:crypto'
import type { VoiceInfo, VoiceSettings } from '../shared/types'
import { MAX_CHARS_PER_PAGE } from '../shared/types'
import { AudioCache } from './cache'
import { splitForTts } from '../shared/chunk'
import type { Config } from './config'
import { ApiError } from './errors'
import type { TtsProvider } from './providers/types'

const CHUNK_CONCURRENCY = 4

/** Promise.all with bounded concurrency; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export interface GenerationResult {
  id: string
  format: 'mp3' | 'wav'
  cached: boolean
}

export class NarrationService {
  private inflight = new Map<string, Promise<GenerationResult>>()
  private voiceCache?: { at: number; voices: VoiceInfo[] }

  constructor(
    public provider: TtsProvider,
    private cfg: Config,
    public cache: AudioCache,
  ) {}

  async voices(): Promise<VoiceInfo[]> {
    if (this.voiceCache && Date.now() - this.voiceCache.at < 5 * 60_000) return this.voiceCache.voices
    const voices = await this.provider.listVoices(AbortSignal.timeout(15_000))
    this.voiceCache = { at: Date.now(), voices }
    return voices
  }

  /** Deterministic id: identical text + voice + settings + provider/model never bill twice. */
  keyFor(voiceId: string, settings: VoiceSettings, text: string): string {
    return createHash('sha256')
      .update(JSON.stringify([this.provider.fingerprint, voiceId, settings.style, text.trim()]))
      .digest('hex')
  }

  async generate(text: string, voiceId: string, settings: VoiceSettings): Promise<GenerationResult> {
    if (!this.provider.info.configured) throw new ApiError('not_configured', 'No TTS provider is configured on the server.')
    const clean = text.trim()
    if (!clean) throw new ApiError('validation', 'This page has no text to narrate.')
    if (clean.length > MAX_CHARS_PER_PAGE) throw new ApiError('validation', `Page text exceeds ${MAX_CHARS_PER_PAGE} characters.`)

    const id = this.keyFor(voiceId, settings, clean)
    const existing = await this.cache.get(id)
    if (existing) return { id, format: existing.format, cached: true }

    const running = this.inflight.get(id)
    if (running) return running

    const job = this.run(id, clean, voiceId, settings).finally(() => this.inflight.delete(id))
    this.inflight.set(id, job)
    return job
  }

  private async run(id: string, text: string, voiceId: string, settings: VoiceSettings): Promise<GenerationResult> {
    const voice = (await this.voices()).find((v) => v.id === voiceId)
    if (!voice) throw new ApiError('validation', `Unknown voice “${voiceId}” for provider ${this.provider.info.id}.`)
    // Long chapters get proportionally more time (the base timeout covers ~10k characters).
    const signal = AbortSignal.timeout(this.cfg.requestTimeoutMs * Math.max(1, Math.ceil(text.length / 10_000)))
    const chunks = splitForTts(text, this.provider.info.maxCharsPerRequest)
    let parts: Buffer[] = []
    let format: 'mp3' | 'wav' = this.provider.info.audioFormat
    try {
      // Chunks of one page are synthesized in parallel, then joined in their original order.
      const results = await mapLimit(chunks, CHUNK_CONCURRENCY, (chunk) => this.provider.synthesize(chunk, voice, settings, signal))
      parts = results.map((r) => r.audio)
      format = results[results.length - 1]?.format ?? format
    } catch (e) {
      if (e instanceof ApiError) throw e
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw new ApiError('timeout', 'The TTS provider took too long to respond.')
      throw new ApiError('provider_error', 'Could not reach the TTS provider.')
    }
    await this.cache.put(id, { audio: Buffer.concat(parts), format })
    return { id, format, cached: false }
  }
}
