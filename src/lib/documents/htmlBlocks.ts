const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TABLE', 'TR', 'PRE', 'FIGURE', 'ASIDE'])

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Convert an HTML subtree to page-markup blocks, preserving headings, lists and paragraphs. */
export function htmlToBlocks(root: Element): string[] {
  const blocks: string[] = []
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toUpperCase()
      if (['SCRIPT', 'STYLE', 'NAV', 'HEAD', 'SVG', 'IMG'].includes(tag)) continue
      if (/^H[1-6]$/.test(tag)) {
        const t = clean(child.textContent ?? '')
        if (t) blocks.push(`# ${t}`)
      } else if (tag === 'LI') {
        const t = clean(child.textContent ?? '')
        if (t) blocks.push(`- ${t}`)
      } else if (tag === 'TR') {
        const t = Array.from(child.children).map((c) => clean(c.textContent ?? '')).filter(Boolean).join(' | ')
        if (t) blocks.push(t)
      } else if (BLOCK_TAGS.has(tag) && Array.from(child.children).some((c) => BLOCK_TAGS.has(c.tagName.toUpperCase()))) {
        walk(child)
      } else {
        const t = clean(child.textContent ?? '')
        if (t) blocks.push(t)
      }
    }
  }
  walk(root)
  // Consecutive list items should read as one block.
  const merged: string[] = []
  for (const b of blocks) {
    const prev = merged[merged.length - 1]
    if (b.startsWith('- ') && prev?.startsWith('- ')) merged[merged.length - 1] = `${prev}\n${b}`
    else merged.push(b)
  }
  if (!merged.length) {
    const t = clean(root.textContent ?? '')
    if (t) merged.push(t)
  }
  return merged
}

export function htmlStringToBlocks(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return htmlToBlocks(doc.body)
}
