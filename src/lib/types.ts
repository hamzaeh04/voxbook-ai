import type { VoiceSettings } from '@shared/types'

export type BookFormat = 'pdf' | 'epub' | 'txt' | 'docx'

export interface Book {
  id: string
  title: string
  author: string
  format: BookFormat
  cover?: Blob
  totalPages: number
  createdAt: number
  lastOpenedAt: number
  lastReadPage: number
  /** 0..1, derived from completed pages. */
  readingProgress: number
  completedPages: number[]
  fileSize: number
  preferredVoiceId?: string
  playbackSpeed?: number
  continuous?: boolean
  /** Physical PDF pages with no extractable text (candidates for OCR). */
  scannedPages?: number[]
  /** Reading/narration unit. Books imported before chapter support are page-based. */
  unit?: 'chapter' | 'page'
  /** Shared-library state: `synced` once the book is on the server for everyone. */
  cloud?: 'pending' | 'uploading' | 'synced' | 'error'
  /** Listed from the shared library but chapter text not downloaded to this browser yet. */
  pagesMissing?: boolean
  /** Number of chapter bundles to download for a shared book. */
  sharedBundles?: number
}

/** Persisted narration state. “generating”, “playing” are live UI states; “saved” = downloaded. */
export type PageNarrationStatus = 'none' | 'ready'

export interface Page {
  /** `${bookId}:${pageNumber}` */
  id: string
  bookId: string
  pageNumber: number
  /** Lightweight markup: blank-line separated blocks; `# ` headings, `- ` list items. */
  extractedText: string
  /** Chapter title (chapter-based books). */
  title?: string
  bookmarked: boolean
  narrationStatus: PageNarrationStatus
}

export interface Narration {
  /** Same as page id: exactly one narration asset per page. */
  id: string
  bookId: string
  pageId: string
  pageNumber: number
  voiceId: string
  voiceName: string
  voiceSettings: VoiceSettings
  audioBlob: Blob
  audioFormat: 'mp3' | 'wav'
  duration: number
  size: number
  createdAt: number
  status: 'ready'
  /** Hash of the page text this audio was generated from (detects stale audio). */
  textHash: string
  /** Voice-engine version that produced this audio (see ProviderInfo.engineVersion). */
  engine?: string
  /** Downloaded from the shared library (so it is not published back). */
  shared?: boolean
  downloadedAt?: number
}

export interface MicRecording {
  id: string
  bookId: string
  pageNumber: number
  blob: Blob
  mimeType: string
  duration: number
  createdAt: number
}

export interface HistoryEntry {
  id?: number
  bookId: string
  bookTitle: string
  pageNumber: number
  at: number
  kind: 'read' | 'listen'
}

export interface BatchRecord {
  bookId: string
  jobId: string
  voiceId: string
  settings: VoiceSettings
  pages: number[]
  startedAt: number
}
