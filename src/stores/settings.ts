import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { NarrationStyle } from '@shared/types'

export interface SettingsState {
  theme: 'dark' | 'light'
  profileName: string
  preferredVoiceId?: string
  style: NarrationStyle
  playbackSpeed: number
  volume: number
  continuous: boolean
  /** In continuous mode, generate missing next-page audio without asking. */
  autoGenerateNext: boolean
  fontSize: number
  lineHeight: number
  readingWidth: number
  /** providerId -> user agreed to send page text to it. */
  consent: Record<string, boolean>
  accessToken: string
  maxFileMB: number
  ocrLanguage: string
  motion: 'auto' | 'full' | 'reduced'
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      profileName: 'Reader',
      style: 'expressive',
      playbackSpeed: 1,
      volume: 0.9,
      continuous: false,
      autoGenerateNext: false,
      fontSize: 19,
      lineHeight: 1.85,
      readingWidth: 680,
      consent: {},
      accessToken: '',
      maxFileMB: 100,
      ocrLanguage: 'eng',
      motion: 'auto',
      set: (patch) => set(patch),
    }),
    {
      name: 'voxbook-settings',
      version: 1,
      // v1: emotional delivery became the default speaking style.
      migrate: (persisted, version) => {
        const state = persisted as Partial<SettingsState>
        if (version < 1 && state.style === 'neutral') state.style = 'expressive'
        return state as SettingsState
      },
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { set, ...rest } = s
        return rest
      },
    },
  ),
)

export function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d0d10' : '#f7f5f0')
}
