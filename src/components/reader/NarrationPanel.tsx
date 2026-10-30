import { Download, Headphones, Loader2, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react'
import type { NarrationStyle, VoiceInfo } from '@shared/types'
import { STYLE_LABELS } from '@shared/voices'
import { Badge, Notice, Progress } from '../ui/misc'
import { Button } from '../ui/Button'
import { VoiceOrb, type OrbState } from '../audio/VoiceOrb'
import { cancelGeneration, generateForPage, narrationIsCurrent, useJobs } from '@/lib/narration'
import { refreshLoadedNarration, togglePlay } from '@/lib/playback'
import { deleteNarration, getNarration, updateBook } from '@/lib/db'
import { downloadNarration, narrationFile } from '@/lib/export'
import { useDb } from '@/hooks/useDb'
import { usePlayback } from '@/stores/playback'
import { useSettings } from '@/stores/settings'
import { useVoices, pickVoice } from '@/stores/voices'
import { formatBytes, formatDuration, timeAgo, unitOf } from '@/lib/utils'
import type { Book, Page } from '@/lib/types'
import { toast } from '@/stores/toasts'
import { useEffect, useState } from 'react'
import { ApiClientError } from '@/lib/api'
import { groupVoices } from '@/lib/voiceGroups'
import { useKokoro } from '@/lib/kokoro'
import { isKokoro } from '@/lib/kokoro/voices'
import { BatchPanel } from './BatchPanel'
import { MicRecorderPanel } from './MicRecorderPanel'

export type PageStatus = 'none' | 'generating' | 'ready' | 'playing' | 'saved'
const STATUS_LABEL: Record<PageStatus, string> = { none: 'Not generated', generating: 'Generating', ready: 'Ready', playing: 'Playing', saved: 'Saved' }

export function NarrationPanel({ book, page }: { book: Book; page: Page }) {
  const pageNumber = page.pageNumber
  const kokoro = useKokoro()
  const kokoroTask = kokoro.task?.key === `${book.id}:${page.pageNumber}` ? kokoro.task : undefined
  const u = unitOf(book)
  const { voices, provider } = useVoices()
  const style = useSettings((s) => s.style)
  const setStyle = (v: NarrationStyle) => useSettings.getState().set({ style: v })
  const globalVoice = useSettings((s) => s.preferredVoiceId)
  const voice = pickVoice(voices, book.preferredVoiceId ?? globalVoice)
  const settings = { style }
  const { data: narration } = useDb(() => getNarration(book.id, pageNumber), [book.id, pageNumber])
  const job = useJobs((s) => s.jobs[`${book.id}:${pageNumber}`])
  const pb = usePlayback()
  const isTrack = pb.bookId === book.id && pb.pageNumber === pageNumber
  const playing = isTrack && pb.status === 'playing'
  const generating = job?.state === 'generating' || job?.state === 'queued' || (isTrack && pb.status === 'generating')
  const current = narrationIsCurrent(narration, page, voice?.id ?? '', settings)
  const status: PageStatus = playing ? 'playing' : generating ? 'generating' : narration ? (narration.downloadedAt ? 'saved' : 'ready') : 'none'

  // Success flash after generation completes.
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!narration) return
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 1800)
    return () => clearTimeout(t)
  }, [narration?.createdAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const orb: OrbState = job?.state === 'error' ? 'error' : generating ? 'generating' : playing ? 'playing' : flash ? 'success' : 'idle'

  const generate = async (force: boolean) => {
    if (!voice) return
    try {
      await generateForPage({ bookId: book.id, pageNumber, voice, settings, force })
      await refreshLoadedNarration(book.id, pageNumber)
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'aborted') return
      if (e instanceof Error && !useJobs.getState().jobs[`${book.id}:${pageNumber}`]) toast.error(e.message)
    }
  }
  const hasText = Boolean(page.extractedText.trim())

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <VoiceOrb state={orb} size={72} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{u.One} {pageNumber} narration</h2>
            <Badge tone={status === 'none' ? 'neutral' : status === 'generating' ? 'violet' : status === 'playing' ? 'amber' : 'ok'}>{STATUS_LABEL[status]}</Badge>
          </div>
          <p className="truncate text-xs text-muted">{narration ? `${narration.voiceName} · ${formatDuration(narration.duration)} · ${narration.audioFormat.toUpperCase()} · ${formatBytes(narration.size)}` : voice ? `Will use ${voice.displayName}` : 'No voice available'}</p>
          {narration && <p className="text-xs text-muted">Generated {timeAgo(narration.createdAt)}</p>}
        </div>
      </div>

      {generating && isKokoro(voice?.id) && (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <p className="text-xs text-muted">
            {kokoro.status === 'loading'
              ? `Downloading the on-device voice model (one time)… ${kokoro.download ? `${Math.round(kokoro.download)}%` : ''}`
              : kokoroTask
                ? `Performing on this device: ${kokoroTask.done} of ${kokoroTask.total} sentences`
                : 'Waiting for the on-device voice…'}
          </p>
          <Progress value={kokoro.status === 'loading' ? (kokoro.download ?? 0) / 100 : kokoroTask ? kokoroTask.done / kokoroTask.total : undefined} label="On-device narration progress" />
        </div>
      )}
      {job?.state === 'error' && (
        <Notice tone="error" title={job.error!.code === 'quota_exceeded' ? 'Provider quota reached' : job.error!.code === 'rate_limited' ? 'Rate limit reached' : 'Narration failed'}
          action={job.error!.retryable ? <Button size="sm" onClick={() => void generate(true)}><RefreshCw size={14} /> Retry</Button> : undefined}>
          {job.error!.message}
        </Notice>
      )}
      {narration && !current && !generating && (
        <Notice tone="warning">This audio was made with a different voice, style, text or an older version of the voice engine. Regenerate to match {voice?.displayName ?? 'your current voice'}.</Notice>
      )}
      {!hasText && <Notice>This {u.one} has no text to narrate.</Notice>}

      <div className="flex flex-wrap gap-2">
        {generating ? (
          <Button variant="secondary" onClick={() => cancelGeneration(book.id, pageNumber)}><X size={16} /> Cancel</Button>
        ) : (
          <Button variant="primary" disabled={!hasText || !voice} onClick={() => void togglePlay(book.id, pageNumber)}>
            {playing ? <Pause size={16} fill="currentColor" /> : narration ? <Play size={16} fill="currentColor" /> : <Headphones size={16} />}
            {playing ? 'Pause' : narration ? 'Listen' : 'Listen (generate)'}
          </Button>
        )}
        {!narration && !generating && (
          <Button disabled={!hasText || !voice} onClick={() => void generate(false)}>Generate only</Button>
        )}
        {narration && (
          <>
            <Button disabled={generating || !voice} onClick={() => void generate(true)} title={voice ? `Regenerate with ${voice.displayName}` : undefined}>
              {generating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />} Regenerate
            </Button>
            <Button onClick={() => void downloadNarration(book, narration)} aria-label={`Download ${narrationFile(book, narration)}`}><Download size={16} /> Download</Button>
            <Button variant="ghost" size="icon" aria-label={`Delete this ${u.one}'s audio`} onClick={() => void deleteNarration(narration.id).then(() => toast.info('Page audio deleted.'))}><Trash2 size={16} /></Button>
          </>
        )}
      </div>

      <VoicePicker voices={voices} value={voice} onChange={(v) => void updateBook(book.id, { preferredVoiceId: v.id })} disabled={generating} providerLabel={provider?.label} />
      {voice?.supportedSettings.style && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted" htmlFor="style-select">Emotion / delivery</label>
          <select id="style-select" disabled={generating} value={style} onChange={(e) => setStyle(e.target.value as NarrationStyle)} className="h-10 w-full rounded-xl border border-line bg-raised px-3 text-sm">
            {(Object.keys(STYLE_LABELS) as NarrationStyle[]).map((k) => <option key={k} value={k}>{STYLE_LABELS[k]}</option>)}
          </select>
          <p className="mt-1 text-[11px] text-muted">Emotional reads sorrow, joy, fear, anger, questions and dialogue from the text, sentence by sentence.</p>
        </div>
      )}

      <section aria-labelledby="mic-h" className="space-y-2 border-t border-line pt-4">
        <h3 id="mic-h" className="text-sm font-semibold">Your own voice (microphone)</h3>
        <p className="text-xs text-muted">Record yourself reading this {u.one}. This is separate from AI narration and never records the app’s playback.</p>
        <MicRecorderPanel book={book} pageNumber={pageNumber} />
      </section>

      <section aria-labelledby="batch-h" className="space-y-2 border-t border-line pt-4">
        <h3 id="batch-h" className="text-sm font-semibold">Whole book</h3>
        <BatchPanel bookId={book.id} totalPages={book.totalPages} voice={voice} unit={book.unit} />
      </section>
    </div>
  )
}

export function VoicePicker({ voices, value, onChange, disabled, providerLabel }: { voices: VoiceInfo[]; value?: VoiceInfo; onChange: (v: VoiceInfo) => void; disabled?: boolean; providerLabel?: string }) {
  if (!voices.length) return null
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-muted" htmlFor="voice-select">Narrator voice{providerLabel ? ` · ${providerLabel}` : ''}</label>
      <select
        id="voice-select"
        disabled={disabled}
        value={value?.id}
        onChange={(e) => onChange(voices.find((v) => v.id === e.target.value)!)}
        className="h-10 w-full rounded-xl border border-line bg-raised px-3 text-sm"
      >
        {groupVoices(voices).map(([group, list]) => (
          <optgroup key={group} label={`${group} (${list.length})`}>
            {list.map((v) => <option key={v.id} value={v.id}>{v.displayName}{v.persona === 'other' && v.gender ? ` · ${v.gender}` : ''}</option>)}
          </optgroup>
        ))}
      </select>
      {value && value.persona === 'other' && <p className="mt-1 text-[11px] text-muted">{value.description}</p>}
    </div>
  )
}
