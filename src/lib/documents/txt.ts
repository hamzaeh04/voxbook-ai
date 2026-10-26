import { DocumentError } from './errors'
import { chaptersFromBlocks, chaptersToDoc } from './chapters'

const HEADING_RE = /^(chapter|part|book|section|prologue|epilogue|introduction|preface)\b[\s\dIVXLC.:-]*.{0,60}$/i

export function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf).replace(/^﻿/, '')
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buf).replace(/^﻿/, '')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buf)
  }
}

export function textToBlocks(text: string): string[] {
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  return paragraphs
    .map((p) => {
      const lines = p.split('\n').map((l) => l.trim()).filter(Boolean)
      if (!lines.length) return ''
      if (lines.length === 1 && lines[0].length <= 80 && (HEADING_RE.test(lines[0]) || (/[A-Z]/.test(lines[0]) && lines[0] === lines[0].toUpperCase() && lines[0].length > 3))) {
        return `# ${lines[0]}`
      }
      if (lines.every((l) => /^[-*•]\s+/.test(l))) return lines.map((l) => `- ${l.replace(/^[-*•]\s+/, '')}`).join('\n')
      return lines.join(' ')
    })
    .filter(Boolean)
}

export interface ExtractedDoc {
  title?: string
  author?: string
  /** Text of each reading unit (chapters, or physical pages for page-based PDFs). */
  pages: string[]
  /** Chapter titles, parallel to `pages` (chapter mode only). */
  titles?: string[]
  unit?: 'chapter' | 'page'
  cover?: Blob
  scannedPages?: number[]
}

export function extractTxt(buf: ArrayBuffer): ExtractedDoc {
  const text = decodeText(buf)
  const blocks = textToBlocks(text)
  if (!blocks.length) throw new DocumentError('empty', 'The text file contains no readable text.')
  const first = blocks[0]
  const title = first.startsWith('# ') ? first.slice(2) : first.length <= 80 ? first : undefined
  return { title, ...chaptersToDoc(chaptersFromBlocks(blocks)) }
}
