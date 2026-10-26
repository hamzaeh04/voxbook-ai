import { BookOpen, Clock, Search, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BookActions } from '@/components/books/BookActions'
import { BookCard } from '@/components/books/BookCard'
import { UploadQueue, UploadZone, useFilePicker } from '@/components/books/UploadZone'
import { SetupBanner } from '@/components/layout/SetupBanner'
import { LibraryBanner } from '@/components/layout/LibraryBanner'
import { Button } from '@/components/ui/Button'
import { EmptyState, Select } from '@/components/ui/misc'
import { useLibrary } from '@/hooks/useLibrary'
import type { Book } from '@/lib/types'
import { useVoices } from '@/stores/voices'
import { useSettings } from '@/stores/settings'

type Sort = 'recent' | 'title' | 'progress' | 'added'
type Filter = 'all' | 'reading' | 'unread' | 'finished' | 'audio' | 'incomplete'
const PAGE_SIZE = 48

export default function Library({ mode = 'library' }: { mode?: 'library' | 'recent' }) {
  const { books, counts, loading } = useLibrary()
  const voices = useVoices((s) => s.voices)
  const globalVoice = useSettings((s) => s.preferredVoiceId)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>(mode === 'recent' ? 'recent' : 'added')
  const [filter, setFilter] = useState<Filter>('all')
  const [active, setActive] = useState<string>()
  const [visible, setVisible] = useState(PAGE_SIZE)
  const picker = useFilePicker()
  const sentinel = useRef<HTMLDivElement>(null)

  const list = useMemo(() => {
    let out = books.filter((b) => (mode === 'recent' ? b.lastOpenedAt > 0 : true))
    const query = q.trim().toLowerCase()
    if (query) out = out.filter((b) => `${b.title} ${b.author}`.toLowerCase().includes(query))
    const audio = (b: Book) => counts[b.id] ?? 0
    out = out.filter((b) => {
      switch (filter) {
        case 'reading': return b.readingProgress > 0 && b.readingProgress < 1
        case 'unread': return b.readingProgress === 0
        case 'finished': return b.readingProgress >= 1
        case 'audio': return audio(b) > 0
        case 'incomplete': return audio(b) > 0 && audio(b) < b.totalPages
        default: return true
      }
    })
    const by: Record<Sort, (a: Book, b: Book) => number> = {
      recent: (a, b) => b.lastOpenedAt - a.lastOpenedAt,
      title: (a, b) => a.title.localeCompare(b.title),
      progress: (a, b) => b.readingProgress - a.readingProgress,
      added: (a, b) => b.createdAt - a.createdAt,
    }
    return [...out].sort(by[sort])
  }, [books, counts, q, sort, filter, mode])

  // Progressive rendering keeps very large libraries fast.
  useEffect(() => setVisible(PAGE_SIZE), [q, sort, filter])
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setVisible((v) => v + PAGE_SIZE), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [list.length])

  const voiceName = (b: Book) => voices.find((v) => v.id === (b.preferredVoiceId ?? globalVoice))?.displayName

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{mode === 'recent' ? 'Recently Read' : 'My Library'}</h1>
          <p className="text-sm text-muted">{mode === 'recent' ? 'Pick up where you left off.' : `${books.length} book${books.length === 1 ? '' : 's'} stored on this device.`}</p>
        </div>
        {mode === 'library' && <>{picker.input}<Button variant="primary" onClick={picker.open}><Upload size={16} /> Upload book</Button></>}
      </header>
      <SetupBanner />
      <LibraryBanner />
      {mode === 'library' && <UploadQueue />}

      {books.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5" role="search">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Search books" placeholder="Search title or author" className="h-10 w-full rounded-xl border border-line bg-raised pl-9 pr-3 text-sm" />
          </div>
          <Select label="Sort books" value={sort} onChange={(v) => setSort(v as Sort)} options={[{ value: 'added', label: 'Recently added' }, { value: 'recent', label: 'Last opened' }, { value: 'title', label: 'Title A–Z' }, { value: 'progress', label: 'Most progress' }]} />
          <Select label="Filter books" value={filter} onChange={(v) => setFilter(v as Filter)} options={[{ value: 'all', label: 'All books' }, { value: 'reading', label: 'In progress' }, { value: 'unread', label: 'Not started' }, { value: 'finished', label: 'Finished' }, { value: 'audio', label: 'Has narration' }, { value: 'incomplete', label: 'Narration incomplete' }]} />
        </div>
      )}

      {loading ? null : books.length === 0 ? (
        mode === 'recent' ? (
          <EmptyState icon={<Clock size={26} />} title="Nothing read yet" body="Books you open will show up here." />
        ) : (
          <div className="space-y-4">
            <EmptyState icon={<BookOpen size={26} />} title="Your library is empty" body="Upload a PDF, EPUB, TXT or DOCX to start reading and listening." />
            <UploadZone />
          </div>
        )
      ) : list.length === 0 ? (
        <EmptyState icon={<Search size={26} />} title={mode === 'recent' ? 'No recently opened books' : 'No matching books'} body="Try a different search or filter." />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {list.slice(0, visible).map((b) => (
              <li key={b.id}><BookCard book={b} audioPages={counts[b.id]} voiceName={voiceName(b)} onMenu={() => setActive(b.id)} /></li>
            ))}
          </ul>
          <div ref={sentinel} aria-hidden="true" className="h-px" />
        </>
      )}
      <BookActions book={books.find((b) => b.id === active)} onClose={() => setActive(undefined)} />
    </div>
  )
}
