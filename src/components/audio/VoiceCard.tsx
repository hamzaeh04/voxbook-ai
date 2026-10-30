import { Check, Download, Loader2, Play, Square } from 'lucide-react'
import type { VoiceInfo } from '@shared/types'
import { cn } from '@/lib/utils'
import { Badge } from '../ui/misc'
import { Button } from '../ui/Button'

const PERSONA_LABEL: Record<string, string> = { 'heavy-male': 'Male · deep', 'warm-female': 'Female · warm', neutral: 'Neutral', other: 'Additional' }

export function VoiceCard({
  voice,
  selected,
  previewState,
  progressLabel,
  onDownload,
  downloading,
  onSelect,
  onPreview,
  compact,
}: {
  voice: VoiceInfo
  selected: boolean
  previewState: 'idle' | 'generating' | 'playing'
  /** Live status for slow previews, e.g. "Downloading model 45%". */
  progressLabel?: string
  onDownload?: () => void
  downloading?: boolean
  onSelect: () => void
  onPreview: () => void
  compact?: boolean
}) {
  return (
    <div className={cn('card relative flex flex-col gap-3 p-4 transition-colors', selected && 'border-amber/60 bg-amber/5')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold leading-tight">{voice.displayName}</h3>
          <p className="mt-0.5 text-xs text-muted">{voice.language}</p>
        </div>
        {selected && <Badge tone="amber"><Check size={12} /> Selected</Badge>}
      </div>
      {!compact && <p className="text-sm text-muted">{voice.description}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Badge tone="violet">{PERSONA_LABEL[voice.persona]}</Badge>
        <Badge tone={voice.provider === 'kokoro' ? 'ok' : 'neutral'}>{voice.provider === 'kokoro' ? 'On this device' : 'Microsoft Edge'}</Badge>
        {voice.characteristics.slice(0, 3).map((c) => <Badge key={c}>{c}</Badge>)}
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button size="sm" onClick={onPreview} aria-label={previewState === 'playing' ? `Stop preview of ${voice.displayName}` : `Preview ${voice.displayName}`} aria-busy={previewState === 'generating'}>
          {previewState === 'generating' ? <Loader2 size={14} className="animate-spin" /> : previewState === 'playing' ? <Square size={13} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          {previewState === 'generating' ? (progressLabel ?? 'Generating…') : previewState === 'playing' ? 'Stop' : 'Preview'}
        </Button>
        {onDownload && (
          <Button size="sm" variant="ghost" onClick={onDownload} disabled={downloading} aria-label={`Download a sample of ${voice.displayName}`} title="Download this voice's sample as MP3">
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {downloading ? (progressLabel ?? 'Preparing…') : 'Download'}
          </Button>
        )}
        <Button size="sm" variant={selected ? 'ghost' : 'primary'} disabled={selected} onClick={onSelect}>{selected ? 'Default voice' : 'Use this voice'}</Button>
      </div>
    </div>
  )
}
