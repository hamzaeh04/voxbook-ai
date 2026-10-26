import { Download, Headphones, Mic, Pause, Play, RefreshCw } from 'lucide-react'
import { Badge } from '../ui/misc'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { useDb } from '@/hooks/useDb'
import { getPages, listNarrations, listRecordings } from '@/lib/db'
import { downloadNarration } from '@/lib/export'
import { generateForPage, narrationIsCurrent, useJobs } from '@/lib/narration'
import { playPage, refreshLoadedNarration, stopPlayback } from '@/lib/playback'
import type { Book } from '@/lib/types'
import { formatDuration, timeAgo, unitOf } from '@/lib/utils'
import { usePlayback } from '@/stores/playback'
import { useReader } from '@/stores/reader'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/toasts'
import { pickVoice, useVoices } from '@/stores/voices'

/** Every page of the book with its own narration status, voice, duration, timestamp and actions. */
export function PagesDialog({ book, open, onOpenChange }: { book: Book; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data } = useDb(
    async () => (open ? { pages: await getPages(book.id), narrations: await listNarrations(book.id), mics: await listRecordings(book.id) } : undefined),
    [book.id, open],
  )
  const jobs = useJobs((s) => s.jobs)
  const pb = usePlayback()
  const { voices } = useVoices()
  const style = useSettings((s) => s.style)
  const globalVoice = useSettings((s) => s.preferredVoiceId)
  const voice = pickVoice(voices, book.preferredVoiceId ?? globalVoice)
  const u = unitOf(book)
  const goTo = (n: number) => (useReader.getState().setPage(n), onOpenChange(false))

  const regenerate = async (pageNumber: number) => {
    if (!voice) return
    try {
      await generateForPage({ bookId: book.id, pageNumber, voice, settings: { style }, force: true })
      await refreshLoadedNarration(book.id, pageNumber)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generation failed')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`All ${u.many}`} description={`Narration status for each of the ${book.totalPages} ${u.many}.`} className="max-w-3xl">
      <ul className="mt-4 max-h-[60dvh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
        {data?.pages.map((p) => {
          const n = data.narrations.find((x) => x.pageNumber === p.pageNumber)
          const mic = data.mics.find((x) => x.pageNumber === p.pageNumber)
          const generating = ['queued', 'generating'].includes(jobs[`${book.id}:${p.pageNumber}`]?.state ?? '')
          const playing = pb.bookId === book.id && pb.pageNumber === p.pageNumber && pb.status === 'playing'
          const hasText = Boolean(p.extractedText.trim())
          const stale = n && voice && !narrationIsCurrent(n, p, voice.id, { style })
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 [content-visibility:auto]">
              <button className="min-w-0 max-w-[45%] truncate text-left text-sm font-semibold hover:text-amber" onClick={() => goTo(p.pageNumber)} aria-label={`Go to ${u.one} ${p.pageNumber}`} title={p.title}>{u.One} {p.pageNumber}{p.title ? <span className="font-normal text-muted"> · {p.title}</span> : null}</button>
              <Badge tone={generating ? 'violet' : playing ? 'amber' : n ? 'ok' : 'neutral'}>
                {generating ? 'Generating' : playing ? 'Playing' : n ? (n.downloadedAt ? 'Saved' : 'Ready') : hasText ? 'Not generated' : 'No text'}
              </Badge>
              {stale && <Badge tone="amber">Outdated</Badge>}
              <span className="min-w-0 flex-1 truncate text-xs text-muted">
                {n ? `${n.voiceName} · ${formatDuration(n.duration)} · ${timeAgo(n.createdAt)}` : '—'}
              </span>
              {mic && <span className="inline-flex items-center gap-1 text-xs text-violet"><Mic size={12} aria-hidden="true" />{formatDuration(mic.duration)}<span className="sr-only">microphone take recorded</span></span>}
              <div className="flex gap-0.5">
                <Button size="icon-sm" variant="ghost" disabled={!hasText || generating} aria-label={playing ? `Pause ${u.one} ${p.pageNumber}` : n ? `Play ${u.one} ${p.pageNumber}` : `Generate and play ${u.one} ${p.pageNumber}`}
                  onClick={() => (playing ? stopPlayback() : void (goTo(p.pageNumber), playPage(book.id, p.pageNumber)))}>
                  {playing ? <Pause size={15} /> : n ? <Play size={15} fill="currentColor" /> : <Headphones size={15} />}
                </Button>
                <Button size="icon-sm" variant="ghost" disabled={!hasText || generating || !voice} aria-label={`Regenerate ${u.one} ${p.pageNumber}`} onClick={() => void regenerate(p.pageNumber)}><RefreshCw size={15} /></Button>
                <Button size="icon-sm" variant="ghost" disabled={!n} aria-label={`Download ${u.one} ${p.pageNumber}`} onClick={() => n && void downloadNarration(book, n)}><Download size={15} /></Button>
              </div>
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
