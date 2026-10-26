import { create } from 'zustand'

/** In-memory source of truth for the page the reader shows; persisted to IndexedDB by the Reader. */
interface ReaderState {
  bookId?: string
  title: string
  page: number
  totalPages: number
  open: (bookId: string, page: number, totalPages: number, title: string) => void
  setPage: (page: number) => void
  close: () => void
}

export const useReader = create<ReaderState>((set, get) => ({
  title: '',
  page: 1,
  totalPages: 0,
  open: (bookId, page, totalPages, title) => set({ bookId, page, totalPages, title }),
  setPage: (page) => {
    const { totalPages } = get()
    if (totalPages && page >= 1 && page <= totalPages) set({ page })
  },
  close: () => set({ bookId: undefined }),
}))
