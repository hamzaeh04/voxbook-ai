import type { BookFormat } from '../types'
import { DocumentError } from './errors'

export const MAX_FILE_BYTES_DEFAULT = 100 * 1024 * 1024

const EXT_MIME: Record<BookFormat, string[]> = {
  pdf: ['application/pdf'],
  epub: ['application/epub+zip'],
  txt: ['text/plain'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
}

export const ACCEPT = '.pdf,.epub,.txt,.docx,application/pdf,application/epub+zip,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function detectFormat(name: string): BookFormat | null {
  const ext = name.toLowerCase().split('.').pop()
  return ext === 'pdf' || ext === 'epub' || ext === 'txt' || ext === 'docx' ? ext : null
}

/** Blob.arrayBuffer with a FileReader fallback for older engines. */
export function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

const startsWith = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b)

/** Validates extension, MIME type, size and file signature (magic bytes). */
export async function validateFile(file: File, maxBytes = MAX_FILE_BYTES_DEFAULT): Promise<BookFormat> {
  const format = detectFormat(file.name)
  if (!format) throw new DocumentError('unsupported', `“${file.name}” is not supported. Use PDF, EPUB, TXT or DOCX files.`)
  if (file.type && file.type !== 'application/octet-stream' && !EXT_MIME[format].includes(file.type)) {
    throw new DocumentError('unsupported', `“${file.name}” has a MIME type (${file.type}) that does not match a .${format} file.`)
  }
  if (file.size === 0) throw new DocumentError('empty', `“${file.name}” is empty.`)
  if (file.size > maxBytes) {
    throw new DocumentError('too_large', `“${file.name}” is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${(maxBytes / 1048576).toFixed(0)} MB.`)
  }
  const head = new Uint8Array(await readBytes(file.slice(0, 1024)))
  if (format === 'pdf' && !head.slice(0, 1024).join(',').includes('37,80,68,70')) {
    throw new DocumentError('corrupt', `“${file.name}” does not look like a valid PDF (missing %PDF header).`)
  }
  if ((format === 'epub' || format === 'docx') && !startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    throw new DocumentError('corrupt', `“${file.name}” is not a valid ${format.toUpperCase()} archive.`)
  }
  if (format === 'txt' && head.includes(0)) {
    throw new DocumentError('corrupt', `“${file.name}” looks like a binary file, not plain text.`)
  }
  return format
}
