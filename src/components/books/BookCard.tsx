import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Headphones, MoreVertical } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMotionLevel } from '@/hooks/useMotion'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import type { Book } from '@/lib/types'
import { timeAgo, unitOf } from '@/lib/utils'
import { useBookOpen } from '@/stores/bookOpen'
import { Progress } from '../ui/misc'
import { Cover, coverHue } from './Cover'

interface Props {
  book: Book
  audioPages?: number
  voiceName?: string
  menu?: ReactNode
  onMenu?: () => void
}

/**
 * Signature animation 2 (cards) — pointer-reactive 3D book. Tilt is driven by spring motion
 * values (no re-renders). Clicking triggers the opening transition and navigates immediately;
 * the transition is only a visual overlay, so it never delays reading.
 */
export function BookCard({ book, audioPages = 0, voiceName, onMenu }: Props) {
  const navigate = useNavigate()
  const { effects3d } = useMotionLevel()
  const ref = useRef<HTMLButtonElement>(null)
  const coverUrl = useObjectUrl(book.cover)
  const start = useBookOpen((s) => s.start)

  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const sx = useSpring(px, { stiffness: 180, damping: 18 })
  const sy = useSpring(py, { stiffness: 180, damping: 18 })
  const rotateY = useTransform(sx, [-0.5, 0.5], [-9, 9])
  const rotateX = useTransform(sy, [-0.5, 0.5], [8, -8])

  const onMove = (e: React.PointerEvent) => {
    if (!effects3d || e.pointerType !== 'mouse' || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    px.set((e.clientX - r.left) / r.width - 0.5)
    py.set((e.clientY - r.top) / r.height - 0.5)
  }
  const reset = () => (px.set(0), py.set(0))

  const open = () => {
    if (effects3d && ref.current) {
      const r = ref.current.getBoundingClientRect()
      start({ id: book.id, title: book.title, coverUrl, hue: coverHue(book.title), rect: { x: r.left, y: r.top, w: r.width, h: r.height } })
    }
    navigate(`/read/${book.id}`)
  }

  const pct = Math.round(book.readingProgress * 100)
  return (
    <article className="group relative flex flex-col gap-3">
      <div style={{ perspective: 900 }}>
        <motion.button
          ref={ref}
          type="button"
          onClick={open}
          onPointerMove={onMove}
          onPointerLeave={reset}
          aria-label={`Open ${book.title} by ${book.author}${pct ? `, ${pct}% read` : ''}`}
          style={effects3d ? { rotateX, rotateY, transformStyle: 'preserve-3d' } : undefined}
          whileTap={{ scale: 0.98 }}
          className="relative block aspect-[2/3] w-full overflow-hidden rounded-r-xl rounded-l-sm bg-raised text-left shadow-card"
        >
          <Cover book={book} />
          {/* spine + page-edge highlights give the cover physical depth */}
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/50 via-black/15 to-transparent" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 w-px bg-white/15" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-r-xl ring-1 ring-inset ring-white/10" />
          {audioPages > 0 && (
            <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
              <Headphones size={11} aria-hidden="true" /> {audioPages}/{book.totalPages}
            </span>
          )}
        </motion.button>
      </div>

      <div className="min-w-0 px-0.5">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold" title={book.title}>{book.title}</h3>
            <p className="truncate text-xs text-muted">{book.author}</p>
          </div>
          {onMenu && (
            <button aria-label={`Actions for ${book.title}`} onClick={onMenu} className="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg">
              <MoreVertical size={16} />
            </button>
          )}
        </div>
        <Progress value={book.readingProgress} label={`Reading progress for ${book.title}`} className="mt-2.5" />
        <p className="mt-1.5 text-[11px] leading-4 text-muted">
          {book.totalPages} {unitOf(book).many} · {pct}% · {book.lastOpenedAt ? `opened ${timeAgo(book.lastOpenedAt)}` : 'not opened yet'}
        </p>
        {voiceName && <p className="truncate text-[11px] text-muted">Voice: {voiceName}</p>}
      </div>
    </article>
  )
}
