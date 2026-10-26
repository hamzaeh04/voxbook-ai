import type { Book, BookFormat, Page } from '../types'
import { deleteOriginalFile, getBook, getOriginalFile, replacePageTexts, saveImportedBook, updateBook } from '../db'
import { pageId } from '../utils'
import { extractDocx } from './docx'
import { DocumentError } from './errors'
import { extractEpub } from './epub'
import { ocrPdfPages, type OcrProgress } from './ocr'
import { extractPdf } from './pdf'
import { extractTxt, type ExtractedDoc } from './txt'
import { MAX_FILE_BYTES_DEFAULT, readBytes, validateFile } from './validate'

export type ImportPhase = 'validating' | 'reading' | 'extracting' | 'saving' | 'done'

export interface ImportProgress {
  phase: ImportPhase
  /** 0..1 when the phase has measurable progress (pages processed), else undefined. */
  fraction?: number
  detail?: string
}

export interface ImportResult {
  book: Book
  scannedPages: number[]
}

export function titleFromFileName(name: string) {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled'
}

/** Extract text/pages from an already validated file. Exposed for tests. */
export async function extractDocument(
  format: BookFormat,
  buf: ArrayBuffer,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedDoc> {
  switch (format) {
    case 'pdf':
      return extractPdf(buf, onProgress)
    case 'epub':
      return extractEpub(buf, onProgress)
    case 'docx':
      return extractDocx(buf)
    case 'txt':
      return extractTxt(buf)
  }
}

export function buildBookRecords(
  id: string,
  file: { name: string; size: number },
  format: BookFormat,
  doc: ExtractedDoc,
): { book: Book; pages: Page[] } {
  const now = Date.now()
  const book: Book = {
    id,
    title: doc.title?.slice(0, 200) || titleFromFileName(file.name),
    author: doc.author?.slice(0, 200) || 'Unknown author',
    format,
    cover: doc.cover,
    totalPages: doc.pages.length,
    createdAt: now,
    lastOpenedAt: 0,
    lastReadPage: 1,
    readingProgress: 0,
    completedPages: [],
    fileSize: file.size,
    scannedPages: doc.scannedPages?.length ? doc.scannedPages : undefined,
    unit: doc.unit ?? 'page',
  }
  const pages: Page[] = doc.pages.map((text, i) => ({
    id: pageId(id, i + 1),
    bookId: id,
    pageNumber: i + 1,
    extractedText: text,
    title: doc.titles?.[i],
    bookmarked: false,
    narrationStatus: 'none',
  }))
  return { book, pages }
}

export async function importFile(
  file: File,
  onProgress: (p: ImportProgress) => void,
  opts: { maxBytes?: number } = {},
): Promise<ImportResult> {
  onProgress({ phase: 'validating' })
  const format = await validateFile(file, opts.maxBytes ?? MAX_FILE_BYTES_DEFAULT)
  onProgress({ phase: 'reading' })
  const buf = await readBytes(file)
  onProgress({ phase: 'extracting', fraction: 0 })
  const doc = await extractDocument(format, buf, (done, total) => onProgress({ phase: 'extracting', fraction: done / total, detail: `${done} of ${total}` }))
  if (doc.pages.every((p) => !p.trim()) && !(doc.scannedPages?.length)) throw new DocumentError('no_text', 'No text could be extracted from this file.')
  const { book, pages } = buildBookRecords(crypto.randomUUID(), file, format, doc)
  onProgress({ phase: 'saving' })
  // Keep the original PDF only while OCR may still be needed.
  await saveImportedBook(book, pages, book.scannedPages ? file : undefined)
  onProgress({ phase: 'done' })
  return { book, scannedPages: doc.scannedPages ?? [] }
}

/** Run OCR on a book's scanned PDF pages and write recognised text into those pages. */
export async function runOcrForBook(bookId: string, opts: { language?: string; onProgress?: (p: OcrProgress) => void; signal?: AbortSignal }) {
  const book = await getBook(bookId)
  const file = await getOriginalFile(bookId)
  if (!book?.scannedPages?.length || !file) throw new DocumentError('no_text', 'The original PDF is no longer stored, so OCR cannot run for this book.')
  const texts = await ocrPdfPages(file, book.scannedPages, opts)
  await replacePageTexts(bookId, texts)
  const stillEmpty = book.scannedPages.filter((n) => !(texts.get(n) ?? '').trim())
  await updateBook(bookId, { scannedPages: stillEmpty.length ? stillEmpty : undefined })
  if (!stillEmpty.length) await deleteOriginalFile(bookId)
  return { recognised: texts.size - stillEmpty.length, empty: stillEmpty.length }
}
