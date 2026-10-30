import type { NarrationStyle } from '@shared/types'
import { moodOf, splitSentences, type Mood } from '@shared/emotion'

/**
 * Kokoro has no emotion tags, but because it runs here we control the audio directly: each sentence
 * gets its own speaking rate, loudness and the pause after it. (Edge's free endpoint rejects pauses.)
 */
export interface Piece {
  text: string
  mood: Mood
  /** Kokoro speaking speed (1 = normal). */
  speed: number
  /** Loudness multiplier applied to the generated samples. */
  gain: number
  /** Silence after this piece, in milliseconds. */
  pauseMs: number
}

const DELIVERY: Record<Mood, { speed: number; gain: number; pauseMs: number }> = {
  neutral: { speed: 1, gain: 1, pauseMs: 260 },
  heading: { speed: 0.9, gain: 1.05, pauseMs: 750 },
  somber: { speed: 0.88, gain: 0.82, pauseMs: 560 },
  joyful: { speed: 1.05, gain: 1.08, pauseMs: 260 },
  excited: { speed: 1.1, gain: 1.16, pauseMs: 220 },
  questioning: { speed: 1, gain: 1, pauseMs: 420 },
  fearful: { speed: 1.08, gain: 0.8, pauseMs: 320 },
  angry: { speed: 1.05, gain: 1.2, pauseMs: 260 },
  dialogue: { speed: 1.03, gain: 1.03, pauseMs: 260 },
}

/** Kokoro silently truncates long inputs (~510 tokens), so pieces stay well below that. */
export const MAX_PIECE_CHARS = 280
const PARAGRAPH_PAUSE_MS = 380

function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_PIECE_CHARS) return [sentence]
  const out: string[] = []
  let cur = ''
  for (const part of sentence.split(/(?<=[,;:—–])\s+/)) {
    if (cur && cur.length + part.length + 1 > MAX_PIECE_CHARS) out.push(cur), (cur = '')
    cur = cur ? `${cur} ${part}` : part
  }
  if (cur) out.push(cur)
  // a single clause can still be too long: hard-split on spaces
  return out.flatMap((p) => {
    if (p.length <= MAX_PIECE_CHARS) return [p]
    const words = p.split(' ')
    const chunks: string[] = []
    let c = ''
    for (const w of words) {
      if (c && c.length + w.length + 1 > MAX_PIECE_CHARS) chunks.push(c), (c = '')
      c = c ? `${c} ${w}` : w
    }
    if (c) chunks.push(c)
    return chunks
  })
}

export function planPerformance(text: string, style: NarrationStyle): Piece[] {
  const emotional = style === 'expressive' || style === 'dramatic'
  const intensity = style === 'dramatic' ? 1.6 : 1
  const pauseScale = style === 'dramatic' ? 1.35 : style === 'calm' ? 1.3 : 1
  const baseSpeed = style === 'calm' ? 0.9 : style === 'dramatic' ? 0.95 : 1
  const baseGain = style === 'calm' ? 0.9 : 1

  const pieces: Piece[] = []
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  for (const para of paragraphs) {
    const isHeading = para.length < 90 && !/[.!?,;:]$/.test(para)
    const sentences = splitSentences(para)
    sentences.forEach((sentence, i) => {
      const mood: Mood = emotional ? moodOf(sentence, isHeading) : isHeading ? 'heading' : 'neutral'
      const d = DELIVERY[mood]
      const speed = Math.min(1.35, Math.max(0.7, baseSpeed * (1 + (d.speed - 1) * intensity)))
      const gain = Math.min(1.4, Math.max(0.6, baseGain * (1 + (d.gain - 1) * intensity)))
      const parts = splitLong(sentence)
      parts.forEach((part, j) => {
        const lastOfSentence = j === parts.length - 1
        const lastOfParagraph = lastOfSentence && i === sentences.length - 1
        const pause = lastOfSentence ? d.pauseMs * (emotional ? pauseScale : 1) + (lastOfParagraph ? PARAGRAPH_PAUSE_MS : 0) : 120
        pieces.push({ text: part, mood, speed, gain, pauseMs: Math.round(pause) })
      })
    })
  }
  return pieces
}
