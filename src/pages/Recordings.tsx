import { Archive, AudioLines, Download, Mic, Pause, Play, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Waveform } from '@/components/audio/Waveform'
import { Button } from '@/components/ui/Button'
import { Badge, EmptyState, Select } from '@/components/ui/misc'
import { useDb } from '@/hooks/useDb'
import { getPage, listBooks, listNarrations, listRecordings, markDownloaded } from '@/lib/db'
import { downloadBookZip, narrationFile } from '@/lib/export'
import { playPage, stopPlayback } from '@/lib/playback'
import type { Narration } from '@/lib/types'
import { downloadBlob, formatBytes, formatDuration, narrationFileName, timeAgo, unitOf } from '@/lib/utils'
import { usePlayback } from '@/stores/playback'
import { toast } from '@/stores/toasts'

type Sort = 'date' | 'duration' | 'page'

export default function Recordings() {
  const { data } = useDb(async () => {
    const narrations = await listNarrations()
    // Chapter titles for the narrated units only (avoids loading every page's text).
    const titles = new Map((await Promise.all(narrations.map((n) => getPage(n.bookId, n.pageNumber)))).map((p) => [p?.id ?? '', p?.title ?? '']))
    return { books: await listBooks(), narrations, mics: await listRecordings(), titles }
  }, [])
  const pb = usePlayback()
  const [q, setQ] = useState('')
  const [voice, setVoice] = useState('all')
  const [sort, setSort] = useState<Sort>('date')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string>()

  const voices = useMemo(() => Array.from(new Set((data?.narrations ?? []).map((n) => n.voiceName))), [data])
  const groups = useMemo(() => {
    if (!data) return []
    const cmp: Record<Sort, (a: Narration, b: Narration) => number> = {
      date: (a, b) => b.createdAt - a.createdAt,
      duration: (a, b) => b.duration - a.duration,
      page: (a, b) => a.pageNumber - b.pageNumber,
    }
    return data.books
      .filter((b) => b.title.toLowerCase().includes(q.trim().toLowerCase()))
      .map((book) => ({
        book,
        items: data.narrations.filter((n) => n.bookId === book.id && (voice === 'all' || n.voiceName === voice)).sort(cmp[sort]),
        mics: data.mics.filter((m) => m.bookId === book.id).sort((a, b) => a.pageNumber - b.pageNumber),
      }))
      .filter((g) => g.items.length || g.mics.length)
  }, [data, q, voice, sort])

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const isPlaying = (n: Narration) => pb.bookId === n.bookId && pb.pageNumber === n.pageNumber && pb.status === 'playing'

  const dlSelected = async () => {
    setBusy('selected')
    try {
      for (const g of groups) {
        const pages = g.items.filter((n) => selected.has(n.id)).map((n) => n.pageNumber)
        if (pages.length) await downloadBookZip(g.book.id, { pages })
      }
      toast.success('Selected recordings exported.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed') } finally { setBusy(undefined) }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Saved Recordings</h1>
        <p className="text-sm text-muted">Every page narration and microphone take, grouped by book.</p>
      </header>

      {data && data.narrations.length + data.mics.length > 0 && (
        <div className="flex flex-wrap items-center gap-2.5" role="search">
          <div className="relative min-w-[200px] flex-1">
            <Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Search by book title" placeholder="Search by book title" className="h-10 w-full rounded-xl border border-line bg-raised pl-9 pr-3 text-sm" />
          </div>
          <Select label="Filter by voice" value={voice} onChange={setVoice} options={[{ value: 'all', label: 'All voices' }, ...voices.map((v) => ({ value: v, label: v }))]} />
          <Select label="Sort recordings" value={sort} onChange={(v) => setSort(v as Sort)} options={[{ value: 'date', label: 'Newest first' }, { value: 'duration', label: 'Longest first' }, { value: 'page', label: 'Page number' }]} />
          <Button disabled={!selected.size || busy === 'selected'} onClick={() => void dlSelected()}><Download size={16} /> Download selected ({selected.size})</Button>
        </div>
      )}

      {!data ? null : groups.length === 0 ? (
        <EmptyState icon={<AudioLines size={26} />} title={data.narrations.length ? 'No recordings match' : 'No recordings yet'} body={data.narrations.length ? 'Try another search or voice filter.' : 'Narrate a page in the reader and it will appear here, ready to play or download.'} action={!data.narrations.length ? <Link to="/library" className="text-amber hover:underline">Go to your library</Link> : undefined} />
      ) : (
        groups.map(({ book, items, mics }) => (
          <section key={book.id} aria-labelledby={`b-${book.id}`} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
              <div className="min-w-0">
                <h2 id={`b-${book.id}`} className="truncate font-semibold">{book.title}</h2>
                <p className="text-xs text-muted">{items.length} of {book.totalPages} {unitOf(book).many} narrated{mics.length ? ` · ${mics.length} microphone take(s)` : ''}</p>
              </div>
              <Button size="sm" disabled={!items.length || busy === book.id} onClick={async () => { setBusy(book.id); try { const r = await downloadBookZip(book.id, { includeMic: true }); toast.success(`Exported ${r.count} recordings`) } catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed') } finally { setBusy(undefined) } }}>
                <Archive size={15} /> Export book as ZIP
              </Button>
            </div>
            <ul className="divide-y divide-line">
              {items.map((n) => (
                <li key={n.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <input type="checkbox" aria-label={`Select ${unitOf(book).one} ${n.pageNumber} of ${book.title}`} checked={selected.has(n.id)} onChange={() => toggle(n.id)} className="h-4 w-4 accent-[rgb(var(--amber))]" />
                  <Button size="icon-sm" variant="secondary" aria-label={isPlaying(n) ? `Pause ${unitOf(book).one} ${n.pageNumber}` : `Play ${unitOf(book).one} ${n.pageNumber}`} onClick={() => (isPlaying(n) ? stopPlayback() : void playPage(n.bookId, n.pageNumber, { generateIfMissing: false }))}>
                    {isPlaying(n) ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}
                  </Button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{unitOf(book).One} {n.pageNumber}{data.titles.get(n.id) ? `: ${data.titles.get(n.id)}` : ''} <span className="font-normal text-muted">· {n.voiceName}</span></p>
                    <p className="text-xs text-muted">{n.audioFormat.toUpperCase()} · {formatDuration(n.duration)} · {formatBytes(n.size)} · {timeAgo(n.createdAt)}</p>
                  </div>
                  {isPlaying(n) && <Waveform active bars={12} className="h-6 w-14" />}
                  <Badge tone={n.downloadedAt ? 'ok' : 'neutral'}>{n.downloadedAt ? 'Saved' : 'Ready'}</Badge>
                  <Button size="icon-sm" variant="ghost" aria-label={`Download ${narrationFile(book, n)}`} onClick={() => { downloadBlob(n.audioBlob, narrationFile(book, n)); void markDownloaded([n.id]) }}><Download size={16} /></Button>
                </li>
              ))}
              {mics.map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <Mic size={16} className="text-violet" aria-hidden="true" />
                  <div className="min-w-0 flex-1 text-sm">{unitOf(book).One} {m.pageNumber} <span className="text-muted">· your voice · {formatDuration(m.duration)} · {formatBytes(m.blob.size)}</span></div>
                  <Button size="icon-sm" variant="ghost" aria-label={`Download microphone recording for ${unitOf(book).one} ${m.pageNumber}`} onClick={() => downloadBlob(m.blob, narrationFileName(book.title, m.pageNumber, m.mimeType.includes('mp4') ? 'm4a' : m.mimeType.includes('ogg') ? 'ogg' : 'webm', book.totalPages, unitOf(book).One).replace(`_${unitOf(book).One}_`, `_Mic_${unitOf(book).One}_`))}><Download size={16} /></Button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
