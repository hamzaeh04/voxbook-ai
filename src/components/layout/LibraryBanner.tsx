import { Globe2, Loader2, RefreshCw } from 'lucide-react'
import { syncLibrary, useCloud } from '@/lib/cloud'
import { Button } from '../ui/Button'
import { Notice } from '../ui/misc'

/** Explains the shared library and surfaces its status (not set up / unreachable / syncing). */
export function LibraryBanner() {
  const { enabled, reason, error, syncing } = useCloud()
  if (enabled === false) return <Notice tone="warning" title="Shared library is off">{reason} Until then, books stay only in this browser.</Notice>
  if (error)
    return (
      <Notice tone="warning" title="Shared library sync problem" action={<Button size="sm" onClick={() => void syncLibrary()}><RefreshCw size={14} /> Try again</Button>}>
        {error}
      </Notice>
    )
  if (!enabled) return null
  return (
    <p className="flex items-center gap-2 text-sm text-muted">
      {syncing ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Globe2 size={15} aria-hidden="true" />}
      Shared library: books and narration here are visible to everyone who opens this link. Your reading progress and bookmarks stay on this device.
    </p>
  )
}
