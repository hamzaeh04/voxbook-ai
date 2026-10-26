/**
 * Page markup: blocks separated by a blank line. `# ` = heading, `- ` = list item.
 * Logical pagination keeps blocks intact where possible and splits oversize
 * paragraphs on sentence boundaries.
 */
export const TARGET_PAGE_CHARS = 1800

export function splitSentences(text: string): string[] {
  return text.match(/[^.!?。！？]+(?:[.!?。！？]+["'”’)\]]*)?\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [text]
}

function splitLongBlock(block: string, max: number): string[] {
  if (block.length <= max) return [block]
  const out: string[] = []
  let cur = ''
  for (const s of splitSentences(block)) {
    if (s.length > max) {
      if (cur) out.push(cur), (cur = '')
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max))
      continue
    }
    if (cur && cur.length + 1 + s.length > max) out.push(cur), (cur = s)
    else cur = cur ? `${cur} ${s}` : s
  }
  if (cur) out.push(cur)
  return out
}

export function paginateBlocks(blocks: string[], target = TARGET_PAGE_CHARS): string[] {
  const pages: string[] = []
  let cur: string[] = []
  let len = 0
  const flush = () => {
    if (cur.length) pages.push(cur.join('\n\n'))
    cur = []
    len = 0
  }
  for (const raw of blocks) {
    const block = raw.trim()
    if (!block) continue
    const isHeading = block.startsWith('# ')
    // A heading starts a new page once the current one is reasonably full.
    if (isHeading && len > target * 0.4) flush()
    for (const piece of splitLongBlock(block, target)) {
      if (len > 0 && len + piece.length > target) flush()
      cur.push(piece)
      len += piece.length + 2
    }
  }
  flush()
  return pages
}
