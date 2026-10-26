import clsx, { type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const v = bytes / 1024 ** i
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function formatListening(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.round(seconds / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`
}

export function timeAgo(ts: number, now = Date.now()): string {
  const d = Math.max(0, now - ts)
  const min = Math.floor(d / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

/** `Book Title!` -> `Book_Title` */
export function safeFileStem(title: string): string {
  const stem = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s-]+/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 80)
  return stem || 'Book'
}

/** `Book_Title_Chapter_001.mp3` / `Book_Title_Page_001.mp3` — extension is the real audio format, never relabelled. */
export function narrationFileName(title: string, pageNumber: number, format: string, totalPages = 0, unit: 'Page' | 'Chapter' = 'Page'): string {
  const width = Math.max(3, String(totalPages).length)
  return `${safeFileStem(title)}_${unit}_${String(pageNumber).padStart(width, '0')}.${format}`
}

/** Words for a book's reading unit: chapter-based books (new imports) or page-based (legacy, scanned PDFs). */
export function unitOf(book?: { unit?: 'chapter' | 'page' } | null) {
  return book?.unit === 'chapter'
    ? ({ One: 'Chapter', one: 'chapter', Many: 'Chapters', many: 'chapters' } as const)
    : ({ One: 'Page', one: 'page', Many: 'Pages', many: 'pages' } as const)
}

/** Fast non-cryptographic 53-bit string hash (cyrb53); used for stale-audio detection. */
export function hashText(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export const pageId = (bookId: string, pageNumber: number) => `${bookId}:${pageNumber}`

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Plain text of page markup, for TTS and search. */
export function markupToPlain(markup: string): string {
  return markup
    .split(/\n{2,}/)
    .map((b) => b.replace(/^#{1,3}\s+/, '').replace(/^[-•]\s+/gm, ''))
    .join('\n\n')
    .trim()
}
