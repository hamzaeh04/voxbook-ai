import { create } from 'zustand'

export type PlayStatus = 'idle' | 'loading' | 'generating' | 'playing' | 'paused' | 'ended' | 'error'

export interface PlaybackState {
  bookId?: string
  bookTitle?: string
  pageNumber?: number
  totalPages?: number
  voiceName?: string
  status: PlayStatus
  currentTime: number
  duration: number
  error?: string
  /** Continuous mode paused because the next page has no narration yet. */
  offerGenerate?: { bookId: string; pageNumber: number }
}

export const usePlayback = create<PlaybackState>(() => ({ status: 'idle', currentTime: 0, duration: 0 }))
