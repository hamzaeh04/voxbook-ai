import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error' | 'warning'
  message: string
  action?: { label: string; run: () => void }
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>, ttl?: number) => void
  dismiss: (id: number) => void
}

let nextId = 1
export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t, ttl = 6000) => {
    const id = nextId++
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] })
    if (ttl > 0) setTimeout(() => get().dismiss(id), ttl)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = {
  info: (message: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'info', message, action }),
  success: (message: string) => useToasts.getState().push({ kind: 'success', message }),
  warning: (message: string) => useToasts.getState().push({ kind: 'warning', message }, 9000),
  error: (message: string, action?: Toast['action']) => useToasts.getState().push({ kind: 'error', message, action }, 9000),
}
