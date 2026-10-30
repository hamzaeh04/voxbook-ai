import { create } from 'zustand'
import type { ProviderInfo, VoiceInfo } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import { KOKORO_VOICES } from '@/lib/kokoro/voices'

interface VoiceCatalog {
  provider?: ProviderInfo
  voices: VoiceInfo[]
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: string
  load: () => Promise<void>
}

export const useVoices = create<VoiceCatalog>((set, get) => ({
  voices: [],
  status: 'idle',
  async load() {
    if (get().status === 'loading') return
    set({ status: 'loading', error: undefined })
    try {
      const res = await api.voices()
      // Server voices (e.g. Microsoft Edge) plus Kokoro voices that run in this browser.
      set({ provider: res.provider, voices: [...res.voices, ...KOKORO_VOICES], status: 'ready' })
    } catch (e) {
      // Without the server, the on-device Kokoro voices still work.
      set({ status: 'error', error: errorMessage(e), voices: KOKORO_VOICES })
    }
  },
}))

/** Resolve the effective voice: explicit id if it still exists, else the heavy-male persona, else the first voice. */
export function pickVoice(voices: VoiceInfo[], id?: string): VoiceInfo | undefined {
  return voices.find((v) => v.id === id) ?? voices.find((v) => v.persona === 'heavy-male') ?? voices[0]
}
