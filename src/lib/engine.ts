import { useVoices } from '@/stores/voices'
import { KOKORO_ENGINE } from './kokoro'
import { isKokoro } from './kokoro/voices'

/** Engine version that would produce audio for this voice now (on-device Kokoro, or the server's provider). */
export const engineFor = (voiceId: string): string | undefined => (isKokoro(voiceId) ? KOKORO_ENGINE : useVoices.getState().provider?.engineVersion)
