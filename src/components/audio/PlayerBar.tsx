import { Loader2, Pause, Play, Repeat, RotateCcw, SkipBack, SkipForward, Square, Volume2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { updateBook, getBook } from '@/lib/db'
import { useDb } from '@/hooks/useDb'
import { navigatePage, playPage, restart, seek, setRate, setVolume, stopPlayback, togglePlay } from '@/lib/playback'
import { cn, formatDuration, unitOf } from '@/lib/utils'
import { useJobs } from '@/lib/narration'
import { usePlayback } from '@/stores/playback'
import { useReader } from '@/stores/reader'
import { useSettings } from '@/stores/settings'
import { Button } from '../ui/Button'
import { Select } from '../ui/misc'
import { Slider } from '../ui/Slider'
import { Waveform } from './Waveform'

const RATES = [0.75, 0.8, 0.9, 1, 1.25, 1.5, 1.75, 2]
const rateLabel = (r: number) => `${r < 1 ? r.toFixed(2) : r}×`

export const STATUS_TEXT: Record<string, string> = {
  idle: 'Ready',
  loading: 'Loading audio…',
  generating: 'Generating narration…',
  playing: 'Playing',
  paused: 'Paused',
  ended: 'Finished',
  error: 'Error',
}

/** Premium audio player. Acts on the reader's current page when the reader is open, otherwise on the loaded track. */
export function PlayerBar() {
  const pb = usePlayback()
  const rd = useReader()
  const volume = useSettings((s) => s.volume)
  const settings = useSettings()
  const bookId = rd.bookId ?? pb.bookId
  const { data: book } = useDb(() => (bookId ? getBook(bookId) : Promise.resolve(undefined)), [bookId])
  const jobs = useJobs((s) => s.jobs)
  // While scrubbing, show the thumb locally; seeking on every input would fight timeupdate re-renders.
  const [scrub, setScrub] = useState<number | null>(null)

  const forReader = Boolean(rd.bookId)
  const page = forReader ? rd.page : pb.pageNumber ?? 1
  const total = forReader ? rd.totalPages : pb.totalPages ?? 0
  const title = forReader ? rd.title : pb.bookTitle ?? ''
  const isThisTrack = pb.bookId === bookId && pb.pageNumber === page
  const status = isThisTrack ? pb.status : 'idle'
  const job = bookId ? jobs[`${bookId}:${page}`] : undefined
  const generating = status === 'generating' || job?.state === 'generating' || job?.state === 'queued'
  const playing = status === 'playing'
  const busy = generating || status === 'loading'
  const rate = book?.playbackSpeed ?? settings.playbackSpeed
  const continuous = book?.continuous ?? settings.continuous
  const time = isThisTrack ? pb.currentTime : 0
  const duration = isThisTrack ? pb.duration : 0

  const onPlay = useCallback(() => {
    if (bookId) void togglePlay(bookId, page)
  }, [bookId, page])

  if (!bookId) return null

  const label = generating ? STATUS_TEXT.generating : isThisTrack ? STATUS_TEXT[status] : 'Ready'
  const offer = pb.offerGenerate
  const u = unitOf(book)
  return (
    <section aria-label="Audio player" className="border-t border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      {offer && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber/30 bg-amber/10 px-4 py-2 text-sm">
          <span className="flex-1">{u.One} {offer.pageNumber} has no narration yet. Generate it to keep reading aloud?</span>
          <Button size="sm" variant="primary" onClick={() => void playPage(offer.bookId, offer.pageNumber)}>Generate &amp; continue</Button>
          <Button size="sm" onClick={() => (settings.set({ autoGenerateNext: true }), void playPage(offer.bookId, offer.pageNumber))}>Always do this</Button>
          <Button size="sm" variant="ghost" onClick={stopPlayback}>Stop here</Button>
        </div>
      )}
      <div className="mx-auto grid max-w-6xl gap-x-6 gap-y-2 px-3 py-2.5 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)] md:items-center">
        {/* now playing */}
        <div className="flex min-w-0 items-center gap-3">
          <Waveform active={playing} bars={14} className="h-9 w-16 shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title || 'Book'}</p>
            <p className="truncate text-xs text-muted">
              {u.One} {page}{total ? ` of ${total}` : ''} · {isThisTrack && pb.voiceName ? pb.voiceName : 'Selected voice'} · <span className={cn(status === 'error' && 'text-danger')}>{label}</span>
            </p>
          </div>
        </div>

        {/* transport */}
        <div className="space-y-1">
          <div className="flex items-center justify-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={`Previous ${u.one}`} disabled={page <= 1} onClick={() => void navigatePage(-1)}><SkipBack size={18} /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Restart ${u.one}`} disabled={!isThisTrack || !duration} onClick={restart}><RotateCcw size={17} /></Button>
            <Button size="icon" variant="primary" className="rounded-full" aria-label={playing ? 'Pause' : busy ? 'Loading' : 'Play'} aria-busy={busy} onClick={onPlay}>
              {busy ? <Loader2 size={20} className="animate-spin" /> : playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Stop" disabled={!isThisTrack || status === 'idle'} onClick={stopPlayback}><Square size={16} fill="currentColor" /></Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Next ${u.one}`} disabled={!!total && page >= total} onClick={() => void navigatePage(1)}><SkipForward size={18} /></Button>
          </div>
          <div className="flex items-center gap-2 text-xs tabular-nums text-muted">
            <span className="w-10 text-right">{formatDuration(scrub ?? time)}</span>
            <Slider className="flex-1" label="Audio position" min={0} max={duration || 1} step={0.1} value={scrub ?? time} disabled={!duration} valueText={`${formatDuration(scrub ?? time)} of ${formatDuration(duration)}`}
              onChange={setScrub} onCommit={(v) => scrub !== null && (seek(v), setScrub(null))} />
            <span className="w-10">{formatDuration(duration)}</span>
          </div>
        </div>

        {/* options */}
        <div className="flex items-center justify-between gap-3 md:justify-end">
          <Select
            label="Playback speed"
            className="h-9 w-[5.2rem] px-2"
            value={String(rate)}
            // include a custom default speed set in Voice Studio, so the select always shows the real rate
            options={[...new Set([...RATES, rate])].sort((a, b) => a - b).map((r) => ({ value: String(r), label: rateLabel(r) }))}
            onChange={(v) => {
              setRate(Number(v))
              if (bookId) void updateBook(bookId, { playbackSpeed: Number(v) })
            }}
          />
          <div className="flex w-28 items-center gap-1.5 text-muted">
            <Volume2 size={16} aria-hidden="true" />
            <Slider label="Volume" min={0} max={1} step={0.01} value={volume} valueText={`${Math.round(volume * 100)}%`} onChange={(v) => (setVolume(v), settings.set({ volume: v }))} />
          </div>
          <button
            type="button"
            aria-pressed={continuous}
            onClick={() => bookId && void updateBook(bookId, { continuous: !continuous })}
            className={cn('inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 text-xs font-medium', continuous ? 'border-amber/50 bg-amber/15 text-amber' : 'border-line text-muted hover:text-fg')}
            title={continuous ? `Continuous reading: plays on to the next ${u.one}` : `Single ${u.one}: stops after this ${u.one}`}
          >
            <Repeat size={14} aria-hidden="true" /> {continuous ? 'Continuous' : `Single ${u.one}`}
          </button>
        </div>
      </div>
    </section>
  )
}
