import { Archive, Layers, Loader2, RotateCw, X } from 'lucide-react'
import { useState } from 'react'
import type { VoiceInfo } from '@shared/types'
import { cancelBatch, retryFailed, startBatch, useBatches } from '@/lib/batch'
import { downloadBookZip } from '@/lib/export'
import { useDb } from '@/hooks/useDb'
import { listNarrations } from '@/lib/db'
import { useSettings } from '@/stores/settings'
import { unitOf } from '@/lib/utils'
import { useVoices } from '@/stores/voices'
import { toast } from '@/stores/toasts'
import { Button } from '../ui/Button'
import { Notice, Progress } from '../ui/misc'

/** Generate narration for every page in the background, resume after interruption, export as ZIP. */
export function BatchPanel({ bookId, totalPages, voice, unit }: { bookId: string; totalPages: number; voice?: VoiceInfo; unit?: 'chapter' | 'page' }) {
  const u = unitOf({ unit })
  const batch = useBatches((s) => s.batches[bookId])
  const style = useSettings((s) => s.style)
  const serverJobs = useVoices((s) => s.provider?.serverJobs !== false)
  const { data: narrations } = useDb(() => listNarrations(bookId), [bookId])
  const [zipping, setZipping] = useState(false)
  const have = narrations?.length ?? 0
  const running = batch?.status === 'running' || batch?.status === 'starting'
  const missing = totalPages - have

  const zip = async () => {
    setZipping(true)
    try {
      const r = await downloadBookZip(bookId, { includeMic: true })
      toast.success(`Exported ${r.count} page recording${r.count === 1 ? '' : 's'}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{u.Many} with saved audio</span>
        <span className="font-semibold tabular-nums">{have} / {totalPages}</span>
      </div>
      <Progress value={totalPages ? have / totalPages : 0} label={`${u.Many} narrated`} />

      {running && (
        <div className="rounded-xl border border-line bg-raised p-3" aria-live="polite">
          <p className="flex items-center gap-2 text-sm"><Loader2 size={15} className="animate-spin text-amber" />{batch.status === 'starting' ? 'Starting batch…' : `Generating… ${batch.done} of ${batch.total} ${u.many} saved`}</p>
          <Progress className="mt-2" value={batch.total ? batch.done / batch.total : undefined} label="Batch progress" />
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => void cancelBatch(bookId)}><X size={14} /> Cancel batch</Button>
        </div>
      )}
      {batch && !running && batch.status === 'done' && !batch.failed && <Notice tone="success">{batch.message ?? `Batch complete: ${batch.done} ${u.many} generated and saved.`}</Notice>}
      {batch && !running && batch.status === 'cancelled' && <Notice tone="warning">Batch cancelled. {batch.done} {u.many} were saved; press “Resume” to finish the rest.</Notice>}
      {batch && !running && (batch.status === 'failed' || batch.status === 'error') && (
        <Notice tone="error" title="Batch stopped">{batch.message}</Notice>
      )}
      {batch && !running && batch.failed > 0 && (
        <Notice tone="error" title={`${batch.failed} ${u.many} failed`} action={<Button size="sm" onClick={() => void retryFailed(bookId, voice && { voice, settings: { style } })}><RotateCw size={14} /> Retry failed pages</Button>}>
          {batch.errors.slice(0, 3).map((e) => <p key={e.page}>{u.One} {e.page}: {e.message}</p>)}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={!voice || running || missing <= 0} onClick={() => voice && void startBatch(bookId, voice, { style })}>
          <Layers size={15} /> {have > 0 && missing > 0 ? `Resume (${missing} left)` : `Generate all ${u.many}`}
        </Button>
        <Button size="sm" disabled={!have || zipping} onClick={() => void zip()}>
          {zipping ? <Loader2 size={15} className="animate-spin" /> : <Archive size={15} />} Download ZIP
        </Button>
      </div>
      <p className="text-xs text-muted">{serverJobs ? 'Generation continues on the server even if you leave this page.' : 'Generation runs in this browser tab: keep it open while it works.'} Finished {u.many} are never regenerated when you resume.</p>
    </div>
  )
}
