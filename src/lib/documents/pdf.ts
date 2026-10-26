import type { PDFDocumentProxy } from 'pdfjs-dist'
import { DocumentError } from './errors'
import { chaptersFromBlocks, chaptersToDoc, normalizeChapters, type Chapter } from './chapters'
import type { ExtractedDoc } from './txt'

export const MIN_TEXT_CHARS = 20

let workerReady: Promise<typeof import('pdfjs-dist')> | null = null
export function loadPdfjs() {
  workerReady ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })()
  return workerReady
}

interface TextItem {
  str: string
  transform: number[]
  hasEOL?: boolean
  height?: number
}

/** Rebuild paragraphs from positioned text items using line gaps and font size. */
export function itemsToMarkup(items: TextItem[]): string {
  const lines: { text: string; y: number; size: number }[] = []
  for (const it of items) {
    if (!('str' in it)) continue
    const y = it.transform[5]
    const size = Math.abs(it.height || it.transform[3] || 10)
    const last = lines[lines.length - 1]
    if (last && Math.abs(last.y - y) < size * 0.5) {
      last.text += it.str
      last.size = Math.max(last.size, size)
    } else if (it.str.trim() || last) {
      lines.push({ text: it.str, y, size })
    }
  }
  const nonEmpty = lines.filter((l) => l.text.trim())
  if (!nonEmpty.length) return ''
  const sizes = nonEmpty.map((l) => l.size).sort((a, b) => a - b)
  const body = sizes[Math.floor(sizes.length / 2)] || 10
  const gaps = nonEmpty.slice(1).map((l, i) => Math.abs(nonEmpty[i].y - l.y)).sort((a, b) => a - b)
  // a low percentile approximates the regular line pitch even when headings add large gaps
  const normalGap = gaps[Math.floor((gaps.length - 1) * 0.4)] || body * 1.3

  const blocks: string[] = []
  let cur = ''
  const flush = () => {
    if (cur.trim()) blocks.push(cur.trim())
    cur = ''
  }
  nonEmpty.forEach((line, i) => {
    const text = line.text.replace(/\s+/g, ' ').trim()
    const isHeading = line.size > body * 1.25 && text.length < 120
    const gap = i > 0 ? Math.abs(nonEmpty[i - 1].y - line.y) : 0
    if (isHeading) {
      flush()
      blocks.push(`# ${text}`)
      return
    }
    if (i > 0 && gap > normalGap * 1.6) flush()
    if (cur.endsWith('-') && /^[a-z]/.test(text)) cur = cur.slice(0, -1) + text
    else cur = cur ? `${cur} ${text}` : text
  })
  flush()
  return blocks.join('\n\n')
}

/** Chapters from the PDF's bookmarks (outline): each entry starts a chapter at its page. */
async function outlineChapters(pdf: PDFDocumentProxy, pages: string[]): Promise<Chapter[]> {
  try {
    const outline = await pdf.getOutline()
    if (!outline?.length) return []
    type Item = { title: string; dest: unknown; items?: Item[] }
    const flat: Item[] = []
    const walk = (items: Item[]) => items.forEach((it) => (flat.push(it), it.items?.length && walk(it.items)))
    walk(outline as Item[])
    const starts: { title: string; page: number }[] = []
    for (const item of flat) {
      try {
        const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : (item.dest as unknown[] | null)
        if (!dest?.[0]) continue
        const page = await pdf.getPageIndex(dest[0] as Parameters<PDFDocumentProxy['getPageIndex']>[0])
        starts.push({ title: item.title.trim() || `Chapter ${starts.length + 1}`, page })
      } catch {
        /* unresolvable bookmark */
      }
    }
    // One chapter per starting page (the first bookmark wins), in page order.
    const byPage = [...new Map(starts.sort((a, b) => a.page - b.page).map((s) => [s.page, s])).values()]
    if (!byPage.length) return []
    const chapters: Chapter[] = []
    if (byPage[0].page > 0) chapters.push({ title: 'Opening', blocks: pages.slice(0, byPage[0].page).flatMap((p) => p.split(/\n{2,}/)) })
    byPage.forEach((s, i) => {
      const end = byPage[i + 1]?.page ?? pages.length
      chapters.push({ title: s.title.slice(0, 160), blocks: pages.slice(s.page, end).flatMap((p) => p.split(/\n{2,}/)) })
    })
    return normalizeChapters(chapters)
  } catch {
    return []
  }
}

async function renderCover(pdf: PDFDocumentProxy): Promise<Blob | undefined> {
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 360 / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    return await new Promise((res) => canvas.toBlob((b) => res(b ?? undefined), 'image/jpeg', 0.8))
  } catch {
    return undefined
  }
}

export async function extractPdf(buf: ArrayBuffer, onProgress?: (done: number, total: number) => void): Promise<ExtractedDoc> {
  const pdfjs = await loadPdfjs()
  let pdf: PDFDocumentProxy
  try {
    // pdf.js transfers the buffer to its worker, so pass a copy.
    pdf = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise
  } catch (e) {
    const name = (e as { name?: string }).name
    if (name === 'PasswordException') throw new DocumentError('encrypted', 'This PDF is password protected and cannot be imported.')
    throw new DocumentError('corrupt', 'This PDF could not be read. It may be corrupted.')
  }
  try {
    const pages: string[] = []
    const scanned: number[] = []
    // Physical page boundaries are preserved: one app page per PDF page.
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      const markup = itemsToMarkup(content.items as TextItem[])
      if (markup.replace(/\s/g, '').length < MIN_TEXT_CHARS) scanned.push(n)
      pages.push(markup)
      page.cleanup()
      onProgress?.(n, pdf.numPages)
    }
    const meta = (await pdf.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined
    const cover = await renderCover(pdf)
    const info = { title: meta?.Title?.trim() || undefined, author: meta?.Author?.trim() || undefined, cover }
    // Scanned PDFs stay page-based so OCR can fill in their physical pages later.
    if (scanned.length) return { ...info, pages, unit: 'page', scannedPages: scanned }
    const fromOutline = await outlineChapters(pdf, pages)
    const blocks = pages.flatMap((p) => p.split(/\n{2,}/)).filter((b) => b.trim())
    return { ...info, ...chaptersToDoc(fromOutline.length >= 2 ? fromOutline : chaptersFromBlocks(blocks)) }
  } finally {
    void pdf.destroy()
  }
}
