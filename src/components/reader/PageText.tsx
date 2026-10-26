import { useMemo } from 'react'
import { cn } from '@/lib/utils'

export type Block = { kind: 'h' | 'p' | 'ul'; text: string; items?: string[]; weight: number }

export function parseBlocks(markup: string): Block[] {
  return markup
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map<Block>((b) => {
      if (b.startsWith('# ')) return { kind: 'h', text: b.slice(2), weight: b.length }
      if (/^- /.test(b)) {
        const items = b.split('\n').map((l) => l.replace(/^- /, ''))
        return { kind: 'ul', text: items.join(' '), items, weight: b.length }
      }
      return { kind: 'p', text: b, weight: b.length }
    })
}

/** Which block is being read, estimated from playback fraction (char-weighted; not word-accurate). */
export function activeBlockIndex(blocks: Block[], fraction: number): number {
  const total = blocks.reduce((s, b) => s + b.weight, 0)
  if (!total) return -1
  let acc = 0
  for (let i = 0; i < blocks.length; i++) {
    acc += blocks[i].weight
    if (fraction * total <= acc) return i
  }
  return blocks.length - 1
}

/** The page's blocks as plain elements; the caller supplies the container (page column, scroll view…). */
export function PageBlocks({ markup, fraction }: { markup: string; fraction?: number }) {
  const blocks = useMemo(() => parseBlocks(markup), [markup])
  const active = fraction === undefined ? -1 : activeBlockIndex(blocks, fraction)
  return (
    <>
      {blocks.map((b, i) => {
        const cls = cn(i === active && 'active-block')
        if (b.kind === 'h') return <h2 key={i} className={cls} style={{ fontSize: '1.4em' }}>{b.text}</h2>
        if (b.kind === 'ul') return <ul key={i} className={cls}>{b.items!.map((it, j) => <li key={j}>{it}</li>)}</ul>
        return <p key={i} className={cls} aria-current={i === active ? 'true' : undefined}>{b.text}</p>
      })}
    </>
  )
}

interface Props {
  markup: string
  fontSize: number
  lineHeight: number
  width: number
  /** 0..1 playback fraction, or undefined when this page is not the audio being played. */
  fraction?: number
}

export function PageText({ markup, fontSize, lineHeight, width, fraction }: Props) {
  return (
    <div className="book-text mx-auto w-full" style={{ maxWidth: width, fontSize, lineHeight }}>
      <PageBlocks markup={markup} fraction={fraction} />
    </div>
  )
}
