import { useEffect, useState } from 'react'
import { useBatches } from '@/lib/batch'
import { usePlayback } from '@/stores/playback'

/** Polite live region announcing important playback and generation changes to screen readers. */
export function Announcer() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    let last = ''
    const say = (m: string) => m !== last && ((last = m), setMsg(m))
    const u1 = usePlayback.subscribe((s, p) => {
      if (s.status === p.status && s.pageNumber === p.pageNumber) return
      const page = s.pageNumber ? `section ${s.pageNumber}` : ''
      if (s.status === 'generating') say(`Generating narration for ${page}`)
      else if (s.status === 'playing') say(`Playing ${page}`)
      else if (s.status === 'paused') say('Paused')
      else if (s.status === 'ended') say(`Finished ${page}`)
      else if (s.status === 'error') say(`Narration error: ${s.error ?? 'unknown'}`)
    })
    const u2 = useBatches.subscribe((s, p) => {
      for (const [id, b] of Object.entries(s.batches)) {
        if (p.batches[id]?.status !== b.status && ['done', 'failed', 'cancelled', 'error'].includes(b.status)) say(`Batch narration ${b.status}: ${b.done} of ${b.total} pages`)
      }
    })
    return () => (u1(), u2())
  }, [])
  return <div aria-live="polite" aria-atomic="true" className="sr-only">{msg}</div>
}
