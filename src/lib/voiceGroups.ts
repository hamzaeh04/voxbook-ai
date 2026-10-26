import type { VoiceInfo } from '@shared/types'

/** "English (United Kingdom)" → "United Kingdom". */
export const accentOf = (v: VoiceInfo) => v.language.match(/\(([^)]+)\)/)?.[1] ?? v.language

export const PERSONA_GROUP = 'Narrators'

/** Voices grouped for pickers: the narrator personas first, then one group per accent (US first). */
export function groupVoices(voices: VoiceInfo[]): [string, VoiceInfo[]][] {
  const groups = new Map<string, VoiceInfo[]>()
  for (const v of voices) {
    const key = v.persona !== 'other' ? PERSONA_GROUP : accentOf(v)
    groups.set(key, [...(groups.get(key) ?? []), v])
  }
  const order = (k: string) => (k === PERSONA_GROUP ? 0 : k === 'United States' ? 1 : k === 'United Kingdom' ? 2 : 3)
  return [...groups].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
}

/** Accent filter options with voice counts. */
export function accentOptions(voices: VoiceInfo[]): { value: string; label: string }[] {
  const counts = new Map<string, number>()
  for (const v of voices) counts.set(accentOf(v), (counts.get(accentOf(v)) ?? 0) + 1)
  const order = (k: string) => (k === 'United States' ? 0 : k === 'United Kingdom' ? 1 : 2)
  return [...counts].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b)).map(([accent, n]) => ({ value: accent, label: `${accent} (${n})` }))
}
