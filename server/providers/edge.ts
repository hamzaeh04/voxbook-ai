import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import type { VoiceInfo, VoiceSettings } from '../../shared/types'
import { EMOTION_SAMPLE } from '../../shared/voices'
import { buildSsml, emotionalSegments, type Segment } from '../emotion'
import { ApiError } from '../errors'
import type { SynthesisResult, TtsProvider } from './types'

/**
 * Microsoft Edge "Read Aloud" neural voices via msedge-tts (Node port of edge-tts).
 * Free and keyless, but UNOFFICIAL: Microsoft can change or block the endpoint at any time.
 * The live catalogue is loaded from the service and limited to English voices (every accent, plus the
 * multilingual English voices); the three narrator personas are pinned to specific voices and listed first.
 */
const PERSONAS: Record<string, Pick<VoiceInfo, 'displayName' | 'description' | 'persona'>> = {
  'en-US-GuyNeural': {
    displayName: 'Confident Heavy Male',
    description: 'Microsoft “Guy” — confident, steady US male voice. Good for nonfiction, biography and drama.',
    persona: 'heavy-male',
  },
  'en-US-JennyNeural': {
    displayName: 'Warm Professional Female',
    description: 'Microsoft “Jenny” — warm, friendly US female voice for novels and long listening sessions.',
    persona: 'warm-female',
  },
  'en-US-AriaNeural': {
    displayName: 'Neutral Narrator',
    description: 'Microsoft “Aria” — clear, balanced US female voice for general reading and study.',
    persona: 'neutral',
  },
}

/** Shape of an entry in the service's voice list. */
export interface EdgeVoice {
  ShortName: string
  Gender: string
  Locale: string
  LocaleName?: string
  FriendlyName?: string
  VoiceTag?: { ContentCategories?: string[]; VoicePersonalities?: string[] }
}

/** Used when the live list can't be fetched, so narration keeps working. */
const FALLBACK: EdgeVoice[] = [
  { ShortName: 'en-US-GuyNeural', Gender: 'Male', Locale: 'en-US', LocaleName: 'English (United States)' },
  { ShortName: 'en-US-JennyNeural', Gender: 'Female', Locale: 'en-US', LocaleName: 'English (United States)' },
  { ShortName: 'en-US-AriaNeural', Gender: 'Female', Locale: 'en-US', LocaleName: 'English (United States)' },
  { ShortName: 'en-GB-RyanNeural', Gender: 'Male', Locale: 'en-GB', LocaleName: 'English (United Kingdom)' },
  { ShortName: 'en-GB-SoniaNeural', Gender: 'Female', Locale: 'en-GB', LocaleName: 'English (United Kingdom)' },
  { ShortName: 'en-AU-NatashaNeural', Gender: 'Female', Locale: 'en-AU', LocaleName: 'English (Australia)' },
]

const REGION_SHORT: Record<string, string> = { 'United States': 'US', 'United Kingdom': 'UK', Australia: 'AU', Canada: 'CA', India: 'IN', Ireland: 'IE', 'New Zealand': 'NZ', 'South Africa': 'ZA' }

/** "en-GB-RyanNeural" → "Ryan"; "en-US-AndrewMultilingualNeural" → "Andrew Multilingual". */
function voiceName(shortName: string, locale: string) {
  const raw = shortName.slice(locale.length + 1).replace(/Neural$/, '')
  return raw.replace(/([a-z])([A-Z])/g, '$1 $2') || shortName
}

export function toVoiceInfo(v: EdgeVoice): VoiceInfo {
  const localeName = v.LocaleName ?? v.FriendlyName?.split(' - ').pop() ?? v.Locale
  const region = localeName.match(/\(([^)]+)\)/)?.[1] ?? ''
  const name = voiceName(v.ShortName, v.Locale)
  const personalities = v.VoiceTag?.VoicePersonalities ?? []
  const categories = v.VoiceTag?.ContentCategories ?? []
  const multilingual = /Multilingual/i.test(v.ShortName)
  const gender = (['Male', 'Female'].includes(v.Gender) ? v.Gender : 'Neutral') as VoiceInfo['gender']
  const persona = PERSONAS[v.ShortName]
  const details = [personalities.length ? personalities.join(', ') : '', categories.length ? `suited to ${categories.join(', ').toLowerCase()}` : '', multilingual ? 'reads many languages' : '']
    .filter(Boolean)
    .join(' · ')
  return {
    id: `edge:${v.ShortName}`,
    provider: 'edge',
    providerVoiceId: v.ShortName,
    displayName: persona?.displayName ?? `${name} (${REGION_SHORT[region] ?? region ?? v.Locale})`.replace(' ()', ''),
    description: persona?.description ?? `${gender} · ${localeName}${details ? ` · ${details}` : ''}.`,
    language: localeName,
    locale: v.Locale,
    gender,
    multilingual,
    characteristics: [gender ?? '', ...personalities].filter(Boolean).slice(0, 4),
    persona: persona?.persona ?? 'other',
    supportedSettings: { style: true, pitch: false, speed: false },
    sampleText: v.Locale.startsWith('en') ? EMOTION_SAMPLE : undefined,
  }
}

/** Personas first, then English (US first), then every other language alphabetically. */
export function sortVoices(voices: VoiceInfo[]): VoiceInfo[] {
  const rank = (v: VoiceInfo) => (v.persona !== 'other' ? 0 : v.locale === 'en-US' ? 1 : v.locale?.startsWith('en') ? 2 : 3)
  const personaOrder = ['heavy-male', 'warm-female', 'neutral']
  return [...voices].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      personaOrder.indexOf(a.persona) - personaOrder.indexOf(b.persona) ||
      a.language.localeCompare(b.language) ||
      a.displayName.localeCompare(b.displayName),
  )
}

const CATALOG_TTL_MS = 12 * 3600_000
/** Only English voices are offered for now (the service has 300+ in 75 languages). */
const VOICE_LANGUAGE_PREFIX = 'en-'

async function fetchEdgeVoices(): Promise<EdgeVoice[]> {
  const tts = new MsEdgeTTS()
  try {
    return (await tts.getVoices()) as EdgeVoice[]
  } finally {
    tts.close()
  }
}

/**
 * Style → delivery. "Emotional" and "Dramatic" run the sentence-level emotion engine; the free
 * endpoint rejects Microsoft's real emotion styles, so this is done with prosody only.
 */
function segmentsFor(text: string, style: VoiceSettings['style']): Segment[] {
  switch (style) {
    case 'expressive':
      return emotionalSegments(text, 1)
    case 'dramatic':
      return emotionalSegments(text, 1.6, { rate: -6, pitch: 0, volume: 0 })
    case 'calm':
      return [{ text, mood: 'neutral', prosody: { rate: -12, pitch: 0, volume: -5 } }]
    default:
      return [{ text, mood: 'neutral', prosody: { rate: 0, pitch: 0, volume: 0 } }]
  }
}

/** The free endpoint rejects requests with more than this many <prosody> elements. */
const MAX_SEGMENTS_PER_REQUEST = 2
const MAX_CHARS_PER_SSML_REQUEST = 2000
const MAX_CONCURRENT_REQUESTS = 6

/** Pack consecutive segments into requests the service will accept. Splits over-long segments on sentences. */
export function groupSegments(segments: Segment[]): Segment[][] {
  const pieces: Segment[] = []
  for (const seg of segments) {
    if (seg.text.length <= MAX_CHARS_PER_SSML_REQUEST) {
      pieces.push(seg)
      continue
    }
    let cur = ''
    for (const sentence of seg.text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*)?\s*/g) ?? [seg.text]) {
      if (cur && cur.length + sentence.length > MAX_CHARS_PER_SSML_REQUEST) pieces.push({ ...seg, text: cur.trim() }), (cur = '')
      cur += sentence
    }
    if (cur.trim()) pieces.push({ ...seg, text: cur.trim() })
  }
  const groups: Segment[][] = []
  for (const piece of pieces) {
    const last = groups[groups.length - 1]
    const size = last?.reduce((n, s) => n + s.text.length, 0) ?? 0
    if (last && last.length < MAX_SEGMENTS_PER_REQUEST && size + piece.text.length <= MAX_CHARS_PER_SSML_REQUEST) last.push(piece)
    else groups.push([piece])
  }
  return groups
}

let active = 0
const waiting: Array<() => void> = []
/** Process-wide cap on simultaneous connections to the Edge service. */
async function limit<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_REQUESTS) await new Promise<void>((r) => waiting.push(r))
  active++
  try {
    return await task()
  } finally {
    active--
    waiting.shift()?.()
  }
}

async function synthesizeSsml(voiceName: string, ssml: string, signal: AbortSignal): Promise<Buffer> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
  const tts = new MsEdgeTTS()
  const onAbort = () => tts.close()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.rawToStream(ssml)
    const chunks: Buffer[] = []
    for await (const chunk of audioStream) chunks.push(chunk as Buffer)
    if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    const audio = Buffer.concat(chunks)
    if (!audio.length) throw new ApiError('provider_error', 'The Edge voice service returned no audio. It may be temporarily unavailable.')
    return audio
  } catch (e) {
    if (e instanceof ApiError || signal.aborted) throw e
    throw new ApiError('provider_error', 'The Edge voice service did not return audio. It may be temporarily unavailable or blocked on this network.')
  } finally {
    signal.removeEventListener('abort', onAbort)
    tts.close()
  }
}

export function createEdgeProvider(fetchVoices: () => Promise<EdgeVoice[]> = fetchEdgeVoices): TtsProvider {
  let catalog: { at: number; voices: VoiceInfo[] } | null = null
  /** Live voice list from the service (cached for 12 h); falls back to six built-in voices offline. */
  const loadCatalog = async (): Promise<VoiceInfo[]> => {
    if (catalog && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.voices
    try {
      const raw = (await fetchVoices()).filter((v) => v.Locale.startsWith(VOICE_LANGUAGE_PREFIX))
      if (!raw.length) throw new Error('empty voice list')
      catalog = { at: Date.now(), voices: sortVoices(raw.map(toVoiceInfo)) }
      return catalog.voices
    } catch {
      return sortVoices(FALLBACK.map(toVoiceInfo)) // retried on the next request
    }
  }

  return {
    info: {
      id: 'edge',
      label: 'Microsoft Edge neural voices (free)',
      external: true,
      configured: true,
      isMock: false,
      audioFormat: 'mp3',
      maxCharsPerRequest: 12000, // the provider splits further into service-sized SSML requests itself
      retentionNote:
        'Each chapter’s text is sent to Microsoft’s Edge “Read Aloud” service. This is an unofficial, keyless integration (edge-tts); Microsoft’s handling of the text is not documented for this use and the service may change or stop working without notice.',
      authRequired: false,
    },
    fingerprint: 'edge:mp3-24khz-48k:emotion-v2',
    async listVoices() {
      return loadCatalog()
    },
    async synthesize(text, voice, settings, signal): Promise<SynthesisResult> {
      const lang = voice.locale ?? voice.providerVoiceId.split('-').slice(0, 2).join('-')
      const requests = groupSegments(segmentsFor(text, settings.style))
      // One request per group of mood runs, a few at a time, joined in reading order.
      const parts = await Promise.all(requests.map((group) => limit(() => synthesizeSsml(voice.providerVoiceId, buildSsml(voice.providerVoiceId, group, lang), signal))))
      return { audio: Buffer.concat(parts), format: 'mp3' }
    },
  }
}
