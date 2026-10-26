import { create } from 'zustand'

export interface OpeningBook {
  id: string
  title: string
  coverUrl?: string
  hue: number
  rect: { x: number; y: number; w: number; h: number }
}

export const useBookOpen = create<{ opening?: OpeningBook; start: (b: OpeningBook) => void; end: () => void }>((set) => ({
  start: (opening) => set({ opening }),
  end: () => set({ opening: undefined }),
}))
