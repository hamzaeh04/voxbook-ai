/**
 * Rule-based emotional delivery for engines that only accept SSML prosody (the free Edge voices
 * reject <mstts:express-as> emotion styles, <break> and nested prosody). Each sentence is scored for
 * a mood from punctuation, dialogue and word cues, then voiced with a rate/pitch/volume shift.
 * Consecutive sentences with the same delivery are merged into one <prosody> element.
 */

export type Mood = 'neutral' | 'somber' | 'joyful' | 'excited' | 'questioning' | 'fearful' | 'angry' | 'dialogue' | 'heading'

export interface Prosody {
  rate: number // percent
  pitch: number // percent
  volume: number // percent
}

const LEXICON: Array<[Exclude<Mood, 'neutral' | 'excited' | 'questioning' | 'dialogue' | 'heading'>, RegExp]> = [
  ['angry', /\b(wrath|rage|raged|angry|anger|fury|furious|vengeance|curse[ds]?|smite|hate[ds]?|hatred|scorn)\b/i],
  ['fearful', /\b(fear(ed|ful)?|afraid|terror|terrified|tremble[ds]?|trembling|dread(ed)?|horror|shudder(ed)?|panic|quake[ds]?)\b/i],
  ['somber', /\b(death|dead|die[ds]?|dying|mourn(ed|ing)?|weep(ing|s)?|wept|tears?|grief|griev(e|ed|ing)|sorrow(s|ful)?|lament(ed|ation)?|darkness|perish(ed|es)?|destroy(ed)?|destruction|doom(ed)?|blood|lost|alone|despair|judgement|judgment|punish(ed|ment)?|sin(s|ners?)?|groan(ed|ing)?|wail(ed|ing)?)\b/i],
  ['joyful', /\b(joy(ful|ous)?|rejoice[ds]?|rejoicing|glory|glorious|bless(ed|ing)|praise[ds]?|delight(ed)?|happ(y|iness)|laugh(ed|ter)?|love[ds]?|beautiful|peace|light|hope|wonderful|smile[ds]?|celebrat(e|ed|ion))\b/i],
]

/** Delivery per mood, scaled by intensity (1 = expressive, 1.6 = dramatic). */
// Emotion is carried mostly by pace and loudness. Pitch moves only a little: larger pitch shifts
// change the voice's timbre enough that one narrator starts to sound like two different people.
const BASE: Record<Mood, Prosody> = {
  neutral: { rate: 0, pitch: 0, volume: 0 },
  heading: { rate: -10, pitch: 0, volume: 4 },
  somber: { rate: -9, pitch: -2, volume: -5 },
  joyful: { rate: 4, pitch: 2, volume: 5 },
  excited: { rate: 7, pitch: 3, volume: 12 },
  questioning: { rate: 0, pitch: 2, volume: 0 },
  fearful: { rate: 6, pitch: 1, volume: -8 },
  angry: { rate: 4, pitch: -1, volume: 14 },
  dialogue: { rate: 3, pitch: 1, volume: 3 },
}

/** Hard ceiling on pitch movement (percent) so the speaker always sounds like the same person. */
export const MAX_PITCH_SHIFT = 4

export function splitSentences(text: string): string[] {
  const out: string[] = []
  for (const para of text.split(/\n{2,}/)) {
    const parts = para.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*)?\s*/g) ?? [para]
    for (const p of parts) if (p.trim()) out.push(p.trim())
  }
  return out
}

export function moodOf(sentence: string, isHeading = false): Mood {
  if (isHeading) return 'heading'
  const s = sentence.trim()
  for (const [mood, re] of LEXICON) if (mood === 'angry' && re.test(s) && /!/.test(s)) return 'angry'
  if (/!["'”’)\]]*$/.test(s)) return 'excited'
  if (/\?["'”’)\]]*$/.test(s)) return 'questioning'
  for (const [mood, re] of LEXICON) if (re.test(s)) return mood
  if (/^["“‘']/.test(s) || /[“”]/.test(s)) return 'dialogue'
  return 'neutral'
}

export function prosodyFor(mood: Mood, intensity: number, base: Prosody = { rate: 0, pitch: 0, volume: 0 }): Prosody {
  const m = BASE[mood]
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)))
  return {
    rate: clamp(base.rate + m.rate * intensity, -30, 30),
    pitch: clamp(base.pitch + m.pitch * intensity, -MAX_PITCH_SHIFT, MAX_PITCH_SHIFT),
    volume: clamp(base.volume + m.volume * intensity, -30, 30),
  }
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n}%`

export interface Segment {
  text: string
  mood: Mood
  prosody: Prosody
}

/** Sentence-level emotional segments, merged where the delivery is the same. */
export function emotionalSegments(text: string, intensity: number, base?: Prosody): Segment[] {
  const segments: Segment[] = []
  const headings = new Set(text.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length < 90 && !/[.!?,;:]$/.test(p)))
  const sentences = splitSentences(text)
  const moods = sentences.map((sentence) => moodOf(sentence, headings.has(sentence)))
  // Smooth flicker: a lone neutral sentence between two sentences of the same mood keeps that mood.
  for (let i = 1; i < moods.length - 1; i++) {
    if (moods[i] === 'neutral' && moods[i - 1] === moods[i + 1] && moods[i - 1] !== 'heading') moods[i] = moods[i - 1]
  }
  for (const [i, sentence] of sentences.entries()) {
    const mood = moods[i]
    const prosody = prosodyFor(mood, intensity, base)
    const last = segments[segments.length - 1]
    if (last && last.prosody.rate === prosody.rate && last.prosody.pitch === prosody.pitch && last.prosody.volume === prosody.volume) last.text += ` ${sentence}`
    else segments.push({ text: sentence, mood, prosody })
  }
  return segments
}

/** Full SSML document: one <voice> with sibling <prosody> elements (the only shape the free endpoint accepts). */
export function buildSsml(voiceName: string, segments: Segment[], lang = 'en-US'): string {
  const body = segments
    .map((s) => `<prosody rate="${pct(s.prosody.rate)}" pitch="${pct(s.prosody.pitch)}" volume="${pct(s.prosody.volume)}">${escapeXml(s.text)} </prosody>`)
    .join('')
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voiceName}">${body}</voice></speak>`
}
