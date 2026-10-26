import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { buildBookRecords, extractDocument, titleFromFileName } from '@/lib/documents'
import { DocumentError } from '@/lib/documents/errors'
import { htmlStringToBlocks } from '@/lib/documents/htmlBlocks'
import { ocrTextToMarkup } from '@/lib/documents/ocr'
import { paginateBlocks } from '@/lib/documents/paginate'
import { itemsToMarkup } from '@/lib/documents/pdf'
import { decodeText, extractTxt, textToBlocks } from '@/lib/documents/txt'
import { validateFile } from '@/lib/documents/validate'

const file = (bytes: BlobPart, name: string, type = '') => new File([bytes], name, { type })
const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer

describe('validation', () => {
  it('rejects unsupported extensions with a useful message', async () => {
    await expect(validateFile(file('x', 'notes.rtf'))).rejects.toThrow(/PDF, EPUB, TXT or DOCX/)
  })
  it('rejects mismatched MIME types, empty files and oversize files', async () => {
    await expect(validateFile(file('%PDF-1.4', 'a.pdf', 'image/png'))).rejects.toMatchObject({ code: 'unsupported' })
    await expect(validateFile(file('', 'a.txt'))).rejects.toMatchObject({ code: 'empty' })
    await expect(validateFile(file('x'.repeat(2000), 'a.txt'), 1000)).rejects.toMatchObject({ code: 'too_large' })
  })
  it('detects malformed documents by signature', async () => {
    await expect(validateFile(file('hello world', 'fake.pdf', 'application/pdf'))).rejects.toMatchObject({ code: 'corrupt' })
    await expect(validateFile(file('not a zip', 'fake.epub'))).rejects.toMatchObject({ code: 'corrupt' })
    await expect(validateFile(file('not a zip', 'fake.docx'))).rejects.toMatchObject({ code: 'corrupt' })
    await expect(validateFile(file(new Uint8Array([1, 2, 0, 3]), 'bin.txt'))).rejects.toMatchObject({ code: 'corrupt' })
  })
  it('accepts valid files', async () => {
    expect(await validateFile(file('%PDF-1.7 ...', 'a.PDF', 'application/pdf'))).toBe('pdf')
    expect(await validateFile(file(new Uint8Array([0x50, 0x4b, 3, 4, 0]), 'a.epub', 'application/epub+zip'))).toBe('epub')
    expect(await validateFile(file('plain text', 'a.txt', 'text/plain'))).toBe('txt')
  })
})

describe('pagination', () => {
  it('keeps paragraphs intact and respects the target size', () => {
    const blocks = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}. ` + 'word '.repeat(60).trim())
    const pages = paginateBlocks(blocks, 1000)
    expect(pages.length).toBeGreaterThan(5)
    for (const p of pages) expect(p.length).toBeLessThanOrEqual(1000 + 400)
    expect(pages.join('\n\n').split('\n\n')).toEqual(blocks)
  })
  it('splits an oversize paragraph on sentence boundaries', () => {
    const long = Array.from({ length: 50 }, (_, i) => `This is sentence ${i}.`).join(' ')
    const pages = paginateBlocks([long], 300)
    expect(pages.length).toBeGreaterThan(3)
    expect(pages.every((p) => p.length <= 300)).toBe(true)
    expect(pages.every((p) => /\.$/.test(p))).toBe(true)
  })
  it('starts headings on a fresh page once the page is mostly full', () => {
    const body = 'x '.repeat(400).trim()
    const pages = paginateBlocks([body, '# Chapter Two', 'Short.'], 1000)
    expect(pages).toHaveLength(2)
    expect(pages[1].startsWith('# Chapter Two')).toBe(true)
  })
  it('drops empty blocks', () => expect(paginateBlocks(['', '  ', 'A'])).toEqual(['A']))
})

describe('txt', () => {
  it('detects headings, lists, and re-joins hard-wrapped lines', () => {
    const blocks = textToBlocks('CHAPTER ONE\n\nIt was a dark\nand stormy night.\n\n- apples\n- pears')
    expect(blocks).toEqual(['# CHAPTER ONE', 'It was a dark and stormy night.', '- apples\n- pears'])
  })
  it('decodes UTF-8 (with BOM), UTF-16 and falls back to windows-1252', () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]).buffer)).toBe('hi')
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x68, 0, 0x69, 0]).buffer)).toBe('hi')
    expect(decodeText(new Uint8Array([0x63, 0x61, 0x66, 0xe9]).buffer)).toBe('café')
  })
  it('splits a text file into chapters at its chapter headings, and refuses empty text', () => {
    const body = (n: number) => `Chapter ${n} text. `.repeat(40)
    const doc = extractTxt(enc(`My Story\n\nCHAPTER ONE\n\n${body(1)}\n\nCHAPTER TWO\n\n${body(2)}\n\nCHAPTER THREE\n\n${body(3)}`))
    expect(doc.title).toBe('My Story')
    expect(doc.unit).toBe('chapter')
    expect(doc.titles).toEqual(['CHAPTER ONE', 'CHAPTER TWO', 'CHAPTER THREE'])
    expect(doc.pages[0]).toContain('My Story') // short front matter is merged into the first chapter
    expect(doc.pages[1].startsWith('# CHAPTER TWO')).toBe(true)
    expect(() => extractTxt(enc('   \n\n  '))).toThrow(DocumentError)
  })
})

describe('html and docx', () => {
  it('maps headings, paragraphs and lists to page markup', () => {
    const blocks = htmlStringToBlocks('<h1>Title</h1><p>Hello <b>world</b>.</p><ul><li>one</li><li>two</li></ul><div><p>nested</p></div>')
    expect(blocks).toEqual(['# Title', 'Hello world.', '- one\n- two', 'nested'])
  })

  async function makeDocx(paragraphs: string[]) {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`)
    return zip.generateAsync({ type: 'arraybuffer' })
  }

  it('extracts a real DOCX; without headings it falls back to parts', async () => {
    const buf = await makeDocx(Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'lorem ipsum '.repeat(25)}`))
    const doc = await extractDocument('docx', buf)
    expect(doc.unit).toBe('chapter')
    expect(doc.titles?.[0]).toBe('Part 1')
    expect(doc.pages.length).toBeGreaterThan(1)
    expect(doc.pages[0]).toContain('Paragraph 0')
  })
  it('reports a corrupt DOCX clearly', async () => {
    await expect(extractDocument('docx', enc('PK\u0003\u0004 garbage'))).rejects.toMatchObject({ code: 'corrupt' })
  })
})

describe('pdf + ocr text helpers', () => {
  const item = (str: string, y: number, h = 10) => ({ str, transform: [h, 0, 0, h, 50, y], height: h })
  it('rebuilds lines, paragraphs, headings and de-hyphenates', () => {
    const md = itemsToMarkup([
      item('A Big Title', 700, 22),
      item('First line of the', 660),
      item('paragraph that wraps hy-', 648),
      item('phenated text.', 636),
      item('Second paragraph starts here.', 600),
    ])
    expect(md).toBe('# A Big Title\n\nFirst line of the paragraph that wraps hyphenated text.\n\nSecond paragraph starts here.')
  })
  it('returns empty markup for pages with no text (scanned)', () => expect(itemsToMarkup([])).toBe(''))
  it('normalises OCR output', () => expect(ocrTextToMarkup('Line one\nline two\n\nNext para')).toBe('Line one line two\n\nNext para'))
})

describe('book records', () => {
  it('creates one page record per extracted page with stable ids', () => {
    const { book, pages } = buildBookRecords('b1', { name: 'My_Book.txt', size: 10 }, 'txt', { pages: ['a', 'b', 'c'], scannedPages: [2] })
    expect(book).toMatchObject({ id: 'b1', title: 'My Book', totalPages: 3, lastReadPage: 1, readingProgress: 0, scannedPages: [2] })
    expect(pages.map((p) => [p.id, p.pageNumber, p.narrationStatus])).toEqual([['b1:1', 1, 'none'], ['b1:2', 2, 'none'], ['b1:3', 3, 'none']])
    expect(titleFromFileName('war_and_peace.epub')).toBe('war and peace')
  })
})

import { CHAPTER_MAX_CHARS, chaptersFromBlocks, normalizeChapters } from '@/lib/documents/chapters'
import { chaptersFromTocBlocks } from '@/lib/documents/epub'

describe('chapters', () => {
  const para = (n: number, len = 400) => `Paragraph ${n}. ${'x'.repeat(len)}`

  it('uses table-of-contents markers for chapter boundaries and titles', () => {
    const blocks = ['Front notice ' + 'y'.repeat(400), '\u0001TOC:0', '# I.', para(1), '\u0001TOC:1', '# II.', para(2)]
    const chapters = normalizeChapters(chaptersFromTocBlocks(blocks, [{ label: 'I. The Watchers' }, { label: 'II. The Flood' }]))
    expect(chapters.map((c) => c.title)).toEqual(['Opening', 'I. The Watchers', 'II. The Flood'])
    expect(chapters[2].blocks).toEqual(['# II.', para(2)])
  })

  it('merges a title-only section into the chapter that follows it', () => {
    const chapters = normalizeChapters([
      { title: 'PART ONE', blocks: ['# PART ONE'] },
      { title: 'Chapter 1', blocks: ['# Chapter 1', para(1)] },
      { title: 'Chapter 2', blocks: ['# Chapter 2', para(2)] },
    ])
    expect(chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2'])
    expect(chapters[0].blocks[0]).toBe('# PART ONE')
  })

  it('splits a chapter that is too long to narrate as one file', () => {
    const blocks = Array.from({ length: 200 }, (_, i) => para(i, 900))
    const chapters = normalizeChapters([{ title: 'Long', blocks }])
    expect(chapters.length).toBeGreaterThan(1)
    expect(chapters[1].title).toBe('Long (part 2)')
    expect(chapters.every((c) => c.blocks.join('').length <= CHAPTER_MAX_CHARS)).toBe(true)
    expect(chapters.flatMap((c) => c.blocks)).toEqual(blocks)
  })

  it('keeps Project Gutenberg boilerplate out of the story chapters', () => {
    const chapters = chaptersFromBlocks([
      'The Project Gutenberg eBook ' + 'z'.repeat(400),
      '*** START OF THE PROJECT GUTENBERG EBOOK ENOCH ***',
      '# Chapter 1', para(1),
      '# Chapter 2', para(2),
      '*** END OF THE PROJECT GUTENBERG EBOOK ENOCH ***', 'Licence text ' + 'l'.repeat(400),
    ])
    expect(chapters.map((c) => c.title)).toEqual(['Project Gutenberg notice', 'Chapter 1', 'Chapter 2', 'Project Gutenberg licence'])
    expect(chapters[2].blocks.join(' ')).not.toContain('END OF THE PROJECT')
  })
})
