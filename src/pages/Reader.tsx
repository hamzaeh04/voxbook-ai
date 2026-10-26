import { ArrowLeft, Bookmark, BookmarkCheck, ChevronLeft, ChevronRight, Headphones, ListOrdered, Maximize2, Minimize2, Type } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PlayerBar } from '@/components/audio/PlayerBar'
import { OcrControl } from '@/components/books/OcrControl'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Notice } from '@/components/ui/misc'
import { Slider } from '@/components/ui/Slider'
import { NarrationPanel } from '@/components/reader/NarrationPanel'
import { PagesDialog } from '@/components/reader/PagesDialog'
import { PageText } from '@/components/reader/PageText'
import { useDb } from '@/hooks/useDb'
import { useMotionLevel } from '@/hooks/useMotion'
import { addHistory, getBook, getPage, updateBook, updatePage } from '@/lib/db'
import { stopPlayback } from '@/lib/playback'
import { clamp, cn, unitOf } from '@/lib/utils'
import { usePlayback } from '@/stores/playback'
import { useReader } from '@/stores/reader'
import { useSettings } from '@/stores/settings'

const DWELL_MS = 3500

export default function ReaderPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const { data: book, loading } = useDb(() => getBook(id), [id])
  const reader = useReader()
  const { fontSize, lineHeight, readingWidth, set } = useSettings()
  const { effects3d, reduced } = useMotionLevel()
  const [showType, setShowType] = useState(false)
  const [panel, setPanel] = useState(false)
  const [allPages, setAllPages] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [pageInput, setPageInput] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const opened = useRef<string>()
  const prevPage = useRef(1)

  // Open the reader once per book. If audio for this book is already active, follow its page.
  useEffect(() => {
    if (!book || opened.current === book.id) return
    opened.current = book.id
    const pb = usePlayback.getState()
    const follow = pb.bookId === book.id && pb.status !== 'idle' && pb.pageNumber
    const wanted = parseInt(params.get('page') ?? '', 10)
    const start = clamp(Number.isFinite(wanted) ? wanted : follow ? pb.pageNumber! : book.lastReadPage, 1, book.totalPages)
    prevPage.current = start
    reader.open(book.id, start, book.totalPages, book.title)
    void updateBook(book.id, { lastOpenedAt: Date.now() })
  }, [book]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { opened.current = undefined; useReader.getState().close() }, [id])

  const page = reader.bookId === id ? reader.page : 0
  const total = book?.totalPages ?? 0
  const { data: pageData } = useDb(() => (page ? getPage(id, page) : Promise.resolve(undefined)), [id, page])

  // Persist position (debounced) — no Save button needed.
  useEffect(() => {
    if (!book || !page) return
    const t = setTimeout(() => void updateBook(id, { lastReadPage: page }), 250)
    return () => clearTimeout(t)
  }, [id, page]) // eslint-disable-line react-hooks/exhaustive-deps

  // A page counts as read after a short dwell; also logs reading history.
  useEffect(() => {
    if (!book || !page) return
    const t = setTimeout(async () => {
      const fresh = await getBook(id)
      if (!fresh) return
      if (!fresh.completedPages.includes(page)) {
        const completed = [...fresh.completedPages, page].sort((a, b) => a - b)
        await updateBook(id, { completedPages: completed, readingProgress: completed.length / fresh.totalPages })
      }
      void addHistory({ bookId: id, bookTitle: fresh.title, pageNumber: page, at: Date.now(), kind: 'read' })
    }, DWELL_MS)
    return () => clearTimeout(t)
  }, [id, page, !!book]) // eslint-disable-line react-hooks/exhaustive-deps

  // Audio must never keep reading a page the user has left.
  const lastPage = useRef(page)
  useEffect(() => {
    if (page && lastPage.current && lastPage.current !== page) {
      const pb = usePlayback.getState()
      if (pb.bookId === id && pb.pageNumber !== page && pb.status !== 'idle') stopPlayback()
    }
    lastPage.current = page
    scroller.current?.scrollTo({ top: 0 })
    setPageInput(String(page || ''))
  }, [page, id])
  useEffect(() => { prevPage.current = page }, [page])

  const go = useCallback((n: number) => reader.setPage(clamp(n, 1, Math.max(1, total))), [reader, total])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') (e.preventDefault(), go(useReader.getState().page + 1))
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') (e.preventDefault(), go(useReader.getState().page - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  const toggleFullscreen = () => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen?.().catch(() => undefined))

  const pb = usePlayback()
  const isTrack = pb.bookId === id && pb.pageNumber === page && ['playing', 'paused'].includes(pb.status)
  const fraction = isTrack && pb.duration ? pb.currentTime / pb.duration : undefined

  // Chapters are long: keep the paragraph being read in view while narration plays.
  const followed = useRef<Element | null>(null)
  useEffect(() => {
    if (fraction === undefined || pb.status !== 'playing') return
    const active = scroller.current?.querySelector('.active-block')
    if (!active || active === followed.current) return
    followed.current = active
    const box = scroller.current!.getBoundingClientRect()
    const r = active.getBoundingClientRect()
    if (r.top < box.top + 40 || r.bottom > box.bottom - 40) active.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [fraction, pb.status, reduced])

  if (loading && !book) return <div className="grid h-dvh place-items-center text-muted" role="status">Opening book…</div>
  if (!book) {
    return (
      <div className="grid h-dvh place-items-center p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold">Book not found</h1>
          <p className="mt-1 text-muted">It may have been removed from your library.</p>
          <Link to="/library" className="mt-4 inline-block text-amber hover:underline">Back to library</Link>
        </div>
      </div>
    )
  }
  if (!page) return <div className="grid h-dvh place-items-center text-muted" role="status">Opening book…</div>

  const dir = page >= prevPage.current ? 1 : -1
  const u = unitOf(book)
  const scanned = book.scannedPages?.includes(page)
  const empty = pageData && !pageData.extractedText.trim()

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-2 py-2 sm:px-4">
        <Link to="/library" aria-label="Back to library" className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-raised hover:text-fg"><ArrowLeft size={20} /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{book.title}</h1>
          <p className="truncate text-xs text-muted">{u.One} {page} of {total}{pageData?.title ? ` · ${pageData.title}` : ` · ${book.author}`}</p>
        </div>
        <Button size="icon" variant="ghost" aria-label={`All ${u.many} and narration status`} onClick={() => setAllPages(true)}><ListOrdered size={20} /></Button>
        <Button size="icon" variant="ghost" aria-pressed={!!pageData?.bookmarked} aria-label={pageData?.bookmarked ? 'Remove bookmark' : `Bookmark this ${u.one}`} onClick={() => pageData && void updatePage(pageData.id, { bookmarked: !pageData.bookmarked })}>
          {pageData?.bookmarked ? <BookmarkCheck className="text-amber" size={20} /> : <Bookmark size={20} />}
        </Button>
        <div className="relative">
          <Button size="icon" variant="ghost" aria-label="Text settings" aria-expanded={showType} onClick={() => setShowType((s) => !s)}><Type size={20} /></Button>
          {showType && (
            <div className="absolute right-0 top-12 z-30 w-72 space-y-4 rounded-2xl border border-line bg-surface p-4 shadow-card" role="group" aria-label="Reading settings">
              <label className="block text-xs text-muted">Font size · {fontSize}px
                <Slider label="Font size" min={14} max={32} value={fontSize} onChange={(v) => set({ fontSize: v })} />
              </label>
              <label className="block text-xs text-muted">Line spacing · {lineHeight.toFixed(2)}
                <Slider label="Line spacing" min={1.3} max={2.4} step={0.05} value={lineHeight} onChange={(v) => set({ lineHeight: v })} />
              </label>
              <label className="block text-xs text-muted">Reading width · {readingWidth}px
                <Slider label="Reading width" min={420} max={960} step={20} value={readingWidth} onChange={(v) => set({ readingWidth: v })} />
              </label>
            </div>
          )}
        </div>
        <Button size="icon" variant="ghost" className="hidden sm:inline-flex" aria-label={fullscreen ? 'Exit full screen' : 'Enter full screen'} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 size={19} /> : <Maximize2 size={19} />}
        </Button>
        <Button size="icon" variant="ghost" className="lg:hidden" aria-label="Open narration panel" onClick={() => setPanel(true)}><Headphones size={20} /></Button>
      </header>

      {book.unit !== 'chapter' && !book.scannedPages && (
        <div role="status" className="border-b border-amber/30 bg-amber/10 px-4 py-2 text-sm">
          This copy was imported page by page (before chapter support). To read and listen by chapter, remove it from{' '}
          <Link to="/library" className="font-semibold text-amber hover:underline">My Library</Link> and upload the file again.
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={scroller} className="scroll-thin relative min-w-0 flex-1 overflow-y-auto" onClick={() => showType && setShowType(false)}>
          <div className="mx-auto px-5 py-8 sm:px-10 sm:py-12" style={{ perspective: effects3d ? 1600 : undefined }}>
            <AnimatePresence mode="popLayout" initial={false} custom={dir}>
              <motion.article
                key={page}
                aria-label={`${u.One} ${page}${pageData?.title ? `: ${pageData.title}` : ''}`}
                custom={dir}
                variants={{
                  enter: (d: number) => (reduced ? { opacity: 0 } : { opacity: 0, x: d * 36, rotateY: effects3d ? d * -10 : 0 }),
                  center: { opacity: 1, x: 0, rotateY: 0 },
                  exit: (d: number) => (reduced ? { opacity: 0 } : { opacity: 0, x: d * -36, rotateY: effects3d ? d * 10 : 0 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: reduced ? 0.01 : 0.28, ease: [0.25, 0.8, 0.3, 1] }}
                style={{ transformOrigin: dir > 0 ? 'left center' : 'right center' }}
              >
                {pageData && !empty && <PageText markup={pageData.extractedText} fontSize={fontSize} lineHeight={lineHeight} width={readingWidth} fraction={fraction} />}
                {empty && (
                  <div className="mx-auto max-w-lg space-y-3 text-center">
                    <Notice tone="warning" title={`No text in this ${u.one}`}>
                      {scanned ? 'This looks like a scanned page. Run OCR to recognise its text.' : 'This page has no extractable text (it may be an image or blank).'}
                    </Notice>
                    {scanned && book.scannedPages && <OcrControl bookId={book.id} pages={book.scannedPages.length} />}
                  </div>
                )}
              </motion.article>
            </AnimatePresence>
            {fraction !== undefined && <p className="mx-auto mt-6 text-center text-xs text-muted" style={{ maxWidth: readingWidth }}>Highlight follows playback approximately (the voice provider does not supply word timings).</p>}
          </div>
        </div>
        <aside aria-label="Narration" className="scroll-thin hidden w-[360px] shrink-0 overflow-y-auto border-l border-line bg-surface p-5 lg:block">
          {pageData && <NarrationPanel book={book} page={pageData} />}
        </aside>
      </div>

      <nav aria-label={`${u.One} navigation`} className="flex items-center gap-2 border-t border-line bg-surface px-3 py-2 sm:gap-4 sm:px-5">
        <Button size="icon" variant="secondary" aria-label={`Previous ${u.one}`} disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={20} /></Button>
        <Slider className="flex-1" label={`${u.One} progress`} min={1} max={Math.max(2, total)} value={page} valueText={`${u.One} ${page} of ${total}`} onChange={go} />
        <form className="flex items-center gap-1.5 text-sm text-muted" onSubmit={(e) => (e.preventDefault(), go(parseInt(pageInput, 10) || page))}>
          <label className="sr-only" htmlFor="page-input">Go to {u.one}</label>
          <input id="page-input" inputMode="numeric" pattern="[0-9]*" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))} onBlur={() => go(parseInt(pageInput, 10) || page)} className={cn('h-10 w-14 rounded-lg border border-line bg-raised text-center text-fg')} />
          <span aria-hidden="true">/ {total}</span>
        </form>
        <Button size="icon" variant="secondary" aria-label={`Next ${u.one}`} disabled={page >= total} onClick={() => go(page + 1)}><ChevronRight size={20} /></Button>
      </nav>
      <PlayerBar />

      <PagesDialog book={book} open={allPages} onOpenChange={setAllPages} />
      <Dialog open={panel} onOpenChange={setPanel} title="Narration" className="max-w-md">
        <div className="mt-4">{pageData && <NarrationPanel book={book} page={pageData} />}</div>
      </Dialog>
    </div>
  )
}
