import { create } from 'zustand'
import type { ProviderInfo } from '@shared/types'
import { useSettings } from './settings'

interface ConsentState {
  pending?: { provider: ProviderInfo; resolve: (ok: boolean) => void }
  request: (provider: ProviderInfo) => Promise<boolean>
  answer: (ok: boolean) => void
}

export const useConsent = create<ConsentState>((set, get) => ({
  request: (provider) => {
    if (!provider.external || useSettings.getState().consent[provider.id]) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => set({ pending: { provider, resolve } }))
  },
  answer: (ok) => {
    const p = get().pending
    if (!p) return
    if (ok) useSettings.getState().set({ consent: { ...useSettings.getState().consent, [p.provider.id]: true } })
    set({ pending: undefined })
    p.resolve(ok)
  },
}))
