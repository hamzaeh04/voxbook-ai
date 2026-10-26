import { DocumentError } from './errors'
import { loadPdfjs } from './pdf'

export interface OcrProgress {
  page: number
  done: number
  total: number
  /** Recognition progress of the current page, 0..1 (reported by Tesseract). */
  pageProgress: number
}

/** Normalise OCR output into page markup: blank-line separated paragraphs. */
export function ocrTextToMarkup(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Runs Tesseract OCR on the given physical PDF pages, entirely in the browser.
 * (Tesseract downloads its language model from a CDN; the document itself is never uploaded.)
 */
export async function ocrPdfPages(
  pdfData: Blob,
  pages: number[],
  opts: { language?: string; onProgress?: (p: OcrProgress) => void; signal?: AbortSignal } = {},
): Promise<Map<number, string>> {
  const pdfjs = await loadPdfjs()
  const { createWorker } = await import('tesseract.js')
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await pdfData.arrayBuffer()) }).promise
  let current = 0
  let currentPage = 0
  const worker = await createWorker(opts.language ?? 'eng', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') opts.onProgress?.({ page: currentPage, done: current, total: pages.length, pageProgress: m.progress })
    },
  })
  const out = new Map<number, string>()
  try {
    for (const n of pages) {
      if (opts.signal?.aborted) throw new DocumentError('cancelled', 'OCR was cancelled.')
      currentPage = n
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
      const { data } = await worker.recognize(canvas)
      out.set(n, ocrTextToMarkup(data.text))
      current++
      opts.onProgress?.({ page: n, done: current, total: pages.length, pageProgress: 1 })
      canvas.width = canvas.height = 0
    }
  } finally {
    await worker.terminate()
    void pdf.destroy()
  }
  return out
}
