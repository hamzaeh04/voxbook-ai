import type { NarrationStyle } from './types'

export const STYLE_LABELS: Record<NarrationStyle, string> = {
  neutral: 'Neutral',
  expressive: 'Emotional (auto)',
  calm: 'Calm',
  dramatic: 'Dramatic',
}

/** Delivery instructions for providers that accept free-text steering. */
export const STYLE_INSTRUCTIONS: Record<NarrationStyle, string> = {
  neutral: 'Read clearly at a steady, natural pace with even tone.',
  expressive: 'Read as an engaged audiobook narrator. Let the emotion of each sentence come through: sorrow, joy, fear, anger, wonder, and lively dialogue, with natural emphasis.',
  calm: 'Read slowly and softly, with a relaxed, soothing delivery and gentle pauses.',
  dramatic: 'Read as a dramatic storyteller, with confident authority, deliberate pauses and strong emphasis.',
}

export const SAMPLE_SENTENCE =
  'Every great story begins with a single page, and every page deserves to be heard.'

/** Preview text that exercises several moods, so the emotional delivery is audible. */
export const EMOTION_SAMPLE =
  'The night was dark and full of sorrow. Then, suddenly, the doors flew open! Who could it be? It was her brother, home at last, and they wept with joy.'
