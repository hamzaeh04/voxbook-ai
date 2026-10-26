import { DocumentError } from './errors'
import { htmlToBlocks } from './htmlBlocks'
import { chaptersFromBlocks, chaptersToDoc, normalizeChapters, type Chapter } from './chapters'
import type { ExtractedDoc } from './txt'

interface Section {
  href: string
  load: (req: (path: string) => Promise<unknown>) => Promise<unknown>
  unload: () => void
}

interface NavItem {
  label: string
  href: string
  subitems?: NavItem[]
}

/** Marks where a table-of-contents entry begins inside the extracted block stream. */
const SENTINEL = '\u0001TOC:'

const fileOf = (href: string) => decodeURIComponent(href.split('#')[0]).split('/').pop() ?? ''

function flattenToc(items: NavItem[], out: NavItem[] = []): NavItem[] {
  for (const item of items) {
    if (item.href && item.label?.trim()) out.push(item)
    if (item.subitems?.length) flattenToc(item.subitems, out)
  }
  return out
}

/** Insert a sentinel paragraph before each TOC target in this section's document. */
function markTocTargets(root: Element, sectionHref: string, toc: NavItem[]) {
  const doc = root.ownerDocument
  toc.forEach((item, index) => {
    if (fileOf(item.href) !== fileOf(sectionHref)) return
    const frag = item.href.split('#')[1]
    const marker = doc.createElement('p')
    marker.textContent = `${SENTINEL}${index}`
    const target = frag ? doc.getElementById(decodeURIComponent(frag)) : null
    if (target && target !== root) {
      const block = target.closest('h1,h2,h3,h4,h5,h6,p,div,section,article,li') ?? target
      if (block === root || !block.parentNode) root.insertBefore(marker, root.firstChild)
      else block.parentNode.insertBefore(marker, block)
    } else if (!frag) {
      root.insertBefore(marker, root.firstChild)
    }
  })
}

/** Turn a block stream containing TOC sentinels into chapters titled from the TOC. */
export function chaptersFromTocBlocks(blocks: string[], toc: { label: string }[]): Chapter[] {
  const chapters: Chapter[] = []
  let cur: Chapter = { title: 'Opening', blocks: [] }
  for (const block of blocks) {
    if (block.startsWith(SENTINEL)) {
      if (cur.blocks.length) chapters.push(cur)
      const item = toc[Number(block.slice(SENTINEL.length))]
      cur = { title: (item?.label ?? 'Chapter').replace(/\s+/g, ' ').trim().slice(0, 160), blocks: [] }
    } else cur.blocks.push(block)
  }
  if (cur.blocks.length) chapters.push(cur)
  return chapters
}

export async function extractEpub(buf: ArrayBuffer, onProgress?: (done: number, total: number) => void): Promise<ExtractedDoc> {
  const { default: ePub } = await import('epubjs')
  let book: ReturnType<typeof ePub>
  try {
    book = ePub(buf)
    await book.ready
  } catch {
    throw new DocumentError('corrupt', 'This EPUB could not be opened. It may be corrupted or DRM-protected.')
  }
  try {
    const meta = await book.loaded.metadata
    const sections: Section[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(book.spine as any).each((s: Section) => sections.push(s))
    if (!sections.length) throw new DocumentError('empty', 'This EPUB has no readable chapters.')

    let toc: NavItem[] = []
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toc = flattenToc(((await book.loaded.navigation) as any).toc ?? [])
    } catch {
      /* no table of contents */
    }

    const blocks: string[] = []
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i]
      try {
        const loaded = (await s.load(book.load.bind(book))) as Document | Element
        const root = (loaded as Document).body ?? (loaded as Element).querySelector?.('body') ?? (loaded as Element)
        if (toc.length) markTocTargets(root, s.href, toc)
        blocks.push(...htmlToBlocks(root))
      } catch {
        /* skip unreadable section, keep going */
      } finally {
        s.unload()
      }
      onProgress?.(i + 1, sections.length)
    }
    const text = blocks.filter((b) => !b.startsWith(SENTINEL))
    if (!text.length) throw new DocumentError('empty', 'No text could be extracted from this EPUB (it may be image-only or DRM-protected).')

    // Chapters from the table of contents; fall back to headings/size when it is missing or unusable.
    const fromToc = toc.length ? normalizeChapters(chaptersFromTocBlocks(blocks, toc)) : []
    const chapters = fromToc.length >= 2 ? fromToc : chaptersFromBlocks(text)

    let cover: Blob | undefined
    try {
      const url = await book.coverUrl()
      if (url) cover = await (await fetch(url)).blob()
    } catch {
      /* no cover */
    }
    return { title: meta.title?.trim() || undefined, author: meta.creator?.trim() || undefined, ...chaptersToDoc(chapters), cover }
  } finally {
    book.destroy()
  }
}
