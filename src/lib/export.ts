import JSZip from 'jszip'
import { getBook, listNarrations, listRecordings, markDownloaded } from './db'
import { downloadBlob, narrationFileName, safeFileStem, unitOf } from './utils'
import type { Book, Narration } from './types'

export const narrationFile = (book: Pick<Book, 'title' | 'totalPages' | 'unit'>, n: Pick<Narration, 'pageNumber' | 'audioFormat'>) =>
  narrationFileName(book.title, n.pageNumber, n.audioFormat, book.totalPages, unitOf(book).One)

export async function downloadNarration(book: Book, n: Narration) {
  downloadBlob(n.audioBlob, narrationFile(book, n))
  await markDownloaded([n.id])
}

export interface ZipResult {
  blob: Blob
  count: number
  fileName: string
}

/** Zip a book's page narrations (optionally a subset). Files keep their real audio format. */
export async function buildBookZip(
  bookId: string,
  opts: { pages?: number[]; includeMic?: boolean; onProgress?: (done: number, total: number) => void } = {},
): Promise<ZipResult> {
  const book = await getBook(bookId)
  if (!book) throw new Error('Book not found')
  let narrations = (await listNarrations(bookId)).sort((a, b) => a.pageNumber - b.pageNumber)
  if (opts.pages) narrations = narrations.filter((n) => opts.pages!.includes(n.pageNumber))
  if (!narrations.length) throw new Error('There are no completed page recordings to export yet.')

  const zip = new JSZip()
  const manifest = narrations.map((n) => ({
    page: n.pageNumber,
    file: narrationFile(book, n),
    voice: n.voiceName,
    format: n.audioFormat,
    durationSeconds: Math.round(n.duration * 10) / 10,
    generatedAt: new Date(n.createdAt).toISOString(),
  }))
  narrations.forEach((n, i) => {
    zip.file(narrationFile(book, n), n.audioBlob, { compression: 'STORE' })
    opts.onProgress?.(i + 1, narrations.length)
  })
  if (opts.includeMic) {
    for (const r of await listRecordings(bookId)) {
      const ext = r.mimeType.includes('ogg') ? 'ogg' : r.mimeType.includes('mp4') ? 'm4a' : 'webm'
      zip.file(`microphone/${safeFileStem(book.title)}_${unitOf(book).One}_${String(r.pageNumber).padStart(3, '0')}_mic.${ext}`, r.blob, { compression: 'STORE' })
    }
  }
  zip.file('manifest.json', JSON.stringify({ book: book.title, author: book.author, totalPages: book.totalPages, recordings: manifest }, null, 2))
  const blob = await zip.generateAsync({ type: 'blob' })
  return { blob, count: narrations.length, fileName: `${safeFileStem(book.title)}_Narration.zip` }
}

export async function downloadBookZip(bookId: string, opts: Parameters<typeof buildBookZip>[1] = {}) {
  const res = await buildBookZip(bookId, opts)
  downloadBlob(res.blob, res.fileName)
  await markDownloaded((await listNarrations(bookId)).filter((n) => !opts.pages || opts.pages.includes(n.pageNumber)).map((n) => n.id))
  return res
}
