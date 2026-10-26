/**
 * Chapter segmentation. A chapter is the unit you read and listen to: one record, one narration.
 * Sources, best first: EPUB table of contents, PDF outline, headings in the text, then fixed-size parts.
 */

/** A chapter longer than this is split into parts (keeps each narration to roughly an hour). */
export const CHAPTER_MAX_CHARS = 60_000
/** Sections shorter than this (e.g. a part title on its own) are merged into the following chapter. */
export const CHAPTER_MIN_CHARS = 300
/** Size of the parts used when a document has no structure at all. */
export const PART_TARGET_CHARS = 8_000

export interface Chapter {
  title: string
  blocks: string[]
}

const length = (blocks: string[]) => blocks.reduce((n, b) => n + b.length, 0)
const headingText = (block: string) => block.replace(/^#\s+/, '').trim()
const GUTENBERG_END = /^\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i
const GUTENBERG_START = /^\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG/i

/** Every `# ` heading starts a chapter; text before the first heading becomes "Opening". */
export function chaptersFromHeadings(blocks: string[]): Chapter[] {
  const chapters: Chapter[] = []
  let cur: Chapter = { title: 'Opening', blocks: [] }
  for (const block of blocks) {
    if (block.startsWith('# ')) {
      if (cur.blocks.length) chapters.push(cur)
      cur = { title: headingText(block).slice(0, 160), blocks: [block] }
    } else cur.blocks.push(block)
  }
  if (cur.blocks.length) chapters.push(cur)
  return chapters
}

/** Fixed-size parts for documents with no headings or table of contents. */
export function chaptersBySize(blocks: string[], target = PART_TARGET_CHARS): Chapter[] {
  const chapters: Chapter[] = []
  let cur: string[] = []
  for (const block of blocks) {
    cur.push(block)
    if (length(cur) >= target) chapters.push({ title: `Part ${chapters.length + 1}`, blocks: cur }), (cur = [])
  }
  if (cur.length) chapters.push({ title: `Part ${chapters.length + 1}`, blocks: cur })
  return chapters
}

/** Split an over-long block list into pieces of at most `max` characters, on block boundaries. */
function splitBlocks(blocks: string[], max: number): string[][] {
  const out: string[][] = []
  let cur: string[] = []
  for (const block of blocks) {
    if (cur.length && length(cur) + block.length > max) out.push(cur), (cur = [])
    cur.push(block)
  }
  if (cur.length) out.push(cur)
  return out
}

/**
 * Clean up a raw chapter list: drop empty ones, keep Project Gutenberg boilerplate in its own
 * sections, merge tiny title-only sections into the next chapter, and split very long chapters.
 */
export function normalizeChapters(raw: Chapter[]): Chapter[] {
  // 1. Separate Gutenberg header/licence so they are not narrated as part of the story.
  const separated: Chapter[] = []
  for (const ch of raw) {
    let cur: Chapter = { title: ch.title, blocks: [] }
    for (const block of ch.blocks) {
      if (GUTENBERG_END.test(block)) {
        if (cur.blocks.length) separated.push(cur)
        cur = { title: 'Project Gutenberg licence', blocks: [block] }
      } else if (GUTENBERG_START.test(block)) {
        cur.blocks.push(block)
        separated.push({ title: 'Project Gutenberg notice', blocks: cur.blocks })
        cur = { title: ch.title, blocks: [] }
      } else cur.blocks.push(block)
    }
    if (cur.blocks.length) separated.push(cur)
  }

  // 2. Merge tiny sections forward (a part title followed by its first chapter reads as one).
  const merged: Chapter[] = []
  let carry: string[] = []
  separated.forEach((ch, i) => {
    const blocks = [...carry, ...ch.blocks].filter((b) => b.trim())
    carry = []
    if (!blocks.length) return
    const isLast = i === separated.length - 1
    if (length(blocks) < CHAPTER_MIN_CHARS && !isLast && !/gutenberg/i.test(ch.title)) {
      carry = blocks
      return
    }
    merged.push({ title: ch.title, blocks })
  })
  if (carry.length) {
    const last = merged[merged.length - 1]
    if (last) last.blocks.push(...carry)
    else merged.push({ title: 'Opening', blocks: carry })
  }

  // 3. Split chapters that are too long to narrate as one file.
  return merged.flatMap((ch) => {
    if (length(ch.blocks) <= CHAPTER_MAX_CHARS) return [ch]
    return splitBlocks(ch.blocks, CHAPTER_MAX_CHARS).map((blocks, i) => ({ title: i === 0 ? ch.title : `${ch.title} (part ${i + 1})`, blocks }))
  })
}

/** Best available structure for a flat list of blocks. */
export function chaptersFromBlocks(blocks: string[]): Chapter[] {
  const byHeadings = normalizeChapters(chaptersFromHeadings(blocks))
  return byHeadings.length >= 2 ? byHeadings : normalizeChapters(chaptersBySize(blocks))
}

export function chaptersToDoc(chapters: Chapter[]) {
  return { pages: chapters.map((c) => c.blocks.join('\n\n')), titles: chapters.map((c) => c.title), unit: 'chapter' as const }
}
