import { DocumentError } from './errors'
import { htmlStringToBlocks } from './htmlBlocks'
import { chaptersFromBlocks, chaptersToDoc } from './chapters'
import type { ExtractedDoc } from './txt'

export async function extractDocx(buf: ArrayBuffer): Promise<ExtractedDoc> {
  const mammoth = await import('mammoth/mammoth.browser')
  let html: string
  try {
    html = (await mammoth.convertToHtml({ arrayBuffer: buf })).value
  } catch {
    throw new DocumentError('corrupt', 'This DOCX file could not be read. It may be corrupted or password protected.')
  }
  const blocks = htmlStringToBlocks(html)
  if (!blocks.length) throw new DocumentError('empty', 'This DOCX file contains no text.')
  const h1 = blocks.find((b) => b.startsWith('# '))
  return { title: h1?.slice(2), ...chaptersToDoc(chaptersFromBlocks(blocks)) }
}
