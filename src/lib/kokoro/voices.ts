import type { VoiceInfo } from '@shared/types'

/**
 * Kokoro-82M English voices with the model authors' own quality grades (from kokoro-js).
 * Grades vary a lot: A/B voices are excellent, D/F voices are noticeably rougher.
 */
const RAW: Array<[id: string, name: string, accent: 'US' | 'UK', gender: 'Female' | 'Male', grade: string, note?: string]> = [
  ['af_heart', 'Heart', 'US', 'Female', 'A', 'Warm and expressive; the best-rated Kokoro voice'],
  ['af_bella', 'Bella', 'US', 'Female', 'A-', 'Bright and energetic'],
  ['af_nicole', 'Nicole', 'US', 'Female', 'B-', 'Soft, close, whispery (ASMR-like)'],
  ['af_aoede', 'Aoede', 'US', 'Female', 'C+'],
  ['af_kore', 'Kore', 'US', 'Female', 'C+'],
  ['af_sarah', 'Sarah', 'US', 'Female', 'C+'],
  ['af_alloy', 'Alloy', 'US', 'Female', 'C'],
  ['af_nova', 'Nova', 'US', 'Female', 'C'],
  ['af_sky', 'Sky', 'US', 'Female', 'C-'],
  ['af_jessica', 'Jessica', 'US', 'Female', 'D'],
  ['af_river', 'River', 'US', 'Female', 'D'],
  ['am_fenrir', 'Fenrir', 'US', 'Male', 'C+', 'Deep and strong'],
  ['am_michael', 'Michael', 'US', 'Male', 'C+', 'Steady, warm narrator'],
  ['am_puck', 'Puck', 'US', 'Male', 'C+', 'Playful and lively'],
  ['am_echo', 'Echo', 'US', 'Male', 'D'],
  ['am_eric', 'Eric', 'US', 'Male', 'D'],
  ['am_liam', 'Liam', 'US', 'Male', 'D'],
  ['am_onyx', 'Onyx', 'US', 'Male', 'D'],
  ['am_santa', 'Santa', 'US', 'Male', 'D-', 'Jolly, Santa-like character voice'],
  ['am_adam', 'Adam', 'US', 'Male', 'F+'],
  ['bf_emma', 'Emma', 'UK', 'Female', 'B-', 'Clear, warm British narrator'],
  ['bf_isabella', 'Isabella', 'UK', 'Female', 'C'],
  ['bf_alice', 'Alice', 'UK', 'Female', 'D'],
  ['bf_lily', 'Lily', 'UK', 'Female', 'D'],
  ['bm_fable', 'Fable', 'UK', 'Male', 'C', 'British storyteller'],
  ['bm_george', 'George', 'UK', 'Male', 'C', 'Mature British voice'],
  ['bm_lewis', 'Lewis', 'UK', 'Male', 'D+'],
  ['bm_daniel', 'Daniel', 'UK', 'Male', 'D'],
]

export const KOKORO_VOICES: VoiceInfo[] = RAW.map(([id, name, accent, gender, grade, note]) => ({
  id: `kokoro:${id}`,
  provider: 'kokoro',
  providerVoiceId: id,
  displayName: `${name} (${accent})`,
  description: `${note ? `${note}. ` : ''}Kokoro open-source voice, quality grade ${grade}. Runs on this device: free, and no text leaves your browser.`,
  language: accent === 'US' ? 'English (United States)' : 'English (United Kingdom)',
  locale: accent === 'US' ? 'en-US' : 'en-GB',
  gender,
  characteristics: [gender, `Grade ${grade}`, ...(note ? [note.split(/[,;(]/)[0].trim()] : [])].slice(0, 3),
  persona: 'other',
  supportedSettings: { style: true, pitch: false, speed: false },
}))

export const isKokoro = (voiceId?: string) => Boolean(voiceId?.startsWith('kokoro:'))
