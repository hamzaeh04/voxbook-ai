import { Download, Mic, Pause, Play, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDb } from '@/hooks/useDb'
import { deleteRecording, getRecording, putRecording } from '@/lib/db'
import { MicError, MicRecorder, micSupported } from '@/lib/recorder'
import { downloadBlob, formatDuration, narrationFileName, pageId, unitOf } from '@/lib/utils'
import type { Book } from '@/lib/types'
import { Button } from '../ui/Button'
import { Notice } from '../ui/misc'
import { toast } from '@/stores/toasts'
import { usePlayback } from '@/stores/playback'
import { stopPlayback } from '@/lib/playback'

/** Human voice recording for a page (MediaRecorder). Permission is requested only on Record. */
export function MicRecorderPanel({ book, pageNumber }: { book: Book; pageNumber: number }) {
  const { data: saved } = useDb(() => getRecording(book.id, pageNumber), [book.id, pageNumber])
  const [state, setState] = useState<'idle' | 'requesting' | 'recording' | 'review'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string>()
  const [draft, setDraft] = useState<{ blob: Blob; mimeType: string; duration: number }>()
  const [playing, setPlaying] = useState(false)
  const recorder = useRef<MicRecorder | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string>()
  const ttsActive = usePlayback((s) => s.status === 'playing')

  useEffect(() => {
    // switching pages cancels an in-progress take and releases the microphone
    return () => {
      recorder.current?.cancel()
      recorder.current = null
      audio.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [pageNumber])
  useEffect(() => {
    setState('idle')
    setDraft(undefined)
    setError(undefined)
    setPlaying(false)
  }, [pageNumber, book.id])

  useEffect(() => {
    if (state !== 'recording') return
    const t = setInterval(() => setElapsed(recorder.current?.elapsed ?? 0), 200)
    return () => clearInterval(t)
  }, [state])

  const start = async () => {
    setError(undefined)
    stopPlayback() // never record over the app's own playback
    const r = new MicRecorder()
    setState('requesting')
    try {
      await r.start()
      recorder.current = r
      setElapsed(0)
      setState('recording')
    } catch (e) {
      setState('idle')
      setError(e instanceof MicError ? e.message : 'The microphone could not be started.')
    }
  }
  const stop = async () => {
    const res = await recorder.current!.stop()
    recorder.current = null
    setDraft(res)
    setState('review')
  }
  const play = (blob: Blob) => {
    audio.current?.pause()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = URL.createObjectURL(blob)
    const a = new Audio(urlRef.current)
    audio.current = a
    a.onended = a.onpause = () => setPlaying(false)
    setPlaying(true)
    void a.play().catch(() => setPlaying(false))
  }
  const pause = () => audio.current?.pause()
  const save = async () => {
    if (!draft) return
    try {
      await putRecording({ id: pageId(book.id, pageNumber), bookId: book.id, pageNumber, blob: draft.blob, mimeType: draft.mimeType, duration: draft.duration, createdAt: Date.now() })
      toast.success('Microphone recording saved.')
      setDraft(undefined)
      setState('idle')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the recording.')
    }
  }
  const ext = (mime: string) => (mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm')

  if (!micSupported()) return <Notice>Microphone recording is not supported in this browser.</Notice>
  const current = draft ?? saved
  return (
    <div className="space-y-2.5">
      {error && <Notice tone="error" title="Microphone unavailable">{error}</Notice>}
      {ttsActive && state === 'idle' && <p className="text-xs text-muted">Playback will pause when you start recording.</p>}
      {state === 'recording' ? (
        <div className="flex items-center gap-3 rounded-xl border border-danger/40 bg-danger/10 p-3" role="status">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
          <span className="flex-1 text-sm font-medium tabular-nums">Recording… {formatDuration(elapsed)}</span>
          <Button size="sm" variant="danger" onClick={() => void stop()}><Square size={14} fill="currentColor" /> Stop</Button>
        </div>
      ) : (
        <Button size="sm" disabled={state === 'requesting'} onClick={() => void start()}>
          <Mic size={15} /> {state === 'requesting' ? 'Waiting for microphone permission…' : current ? 'Record again' : 'Record my voice'}
        </Button>
      )}
      {current && state !== 'recording' && state !== 'requesting' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-raised p-2.5">
          <span className="text-xs text-muted tabular-nums">{draft ? 'Unsaved take' : 'Saved'} · {formatDuration(current.duration)}</span>
          <div className="ml-auto flex gap-1">
            <Button size="icon-sm" variant="ghost" aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={() => (playing ? pause() : play(current.blob))}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </Button>
            {draft ? (
              <>
                <Button size="sm" variant="primary" onClick={() => void save()}>Save</Button>
                <Button size="icon-sm" variant="ghost" aria-label="Discard take" onClick={() => (setDraft(undefined), setState('idle'))}><Trash2 size={16} /></Button>
              </>
            ) : (
              <>
                <Button size="icon-sm" variant="ghost" aria-label="Download my recording" onClick={() => downloadBlob(current.blob, narrationFileName(book.title, pageNumber, ext((current as { mimeType: string }).mimeType), book.totalPages, unitOf(book).One).replace(`_${unitOf(book).One}_`, `_Mic_${unitOf(book).One}_`))}><Download size={16} /></Button>
                <Button size="icon-sm" variant="ghost" aria-label="Delete my recording" onClick={() => void deleteRecording(pageId(book.id, pageNumber))}><Trash2 size={16} /></Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
