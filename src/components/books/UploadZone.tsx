import { CheckCircle2, FileText, Loader2, Upload, X, AlertCircle, RotateCw } from 'lucide-react'
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ACCEPT } from '@/lib/documents/validate'
import { cn, formatBytes } from '@/lib/utils'
import { useUploads, type UploadItem } from '@/stores/uploads'
import { Button } from '../ui/Button'
import { Progress } from '../ui/misc'
import { OcrControl } from './OcrControl'

const PHASE: Record<string, string> = {
  queued: 'Waiting…',
  validating: 'Checking file…',
  reading: 'Reading file…',
  extracting: 'Extracting pages',
  saving: 'Saving to your library…',
  done: 'Ready',
}

export function useFilePicker() {
  const input = useRef<HTMLInputElement>(null)
  const enqueue = useUploads((s) => s.enqueue)
  const el = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      multiple
      className="hidden"
      aria-label="Choose book files"
      onChange={(e) => {
        if (e.target.files?.length) enqueue(Array.from(e.target.files))
        e.target.value = ''
      }}
    />
  )
  return { open: () => input.current?.click(), input: el }
}

export function UploadZone({ compact }: { compact?: boolean }) {
  const [over, setOver] = useState(false)
  const enqueue = useUploads((s) => s.enqueue)
  const picker = useFilePicker()

  return (
    <div
      onDragEnter={(e) => (e.preventDefault(), setOver(true))}
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (e.dataTransfer.files.length) enqueue(Array.from(e.dataTransfer.files))
      }}
      className={cn(
        'rounded-2xl border-2 border-dashed text-center transition-colors',
        compact ? 'p-5' : 'p-8 sm:p-10',
        over ? 'border-amber bg-amber/10' : 'border-line bg-surface/60 hover:border-muted/50',
      )}
    >
      {picker.input}
      <div className={cn('mx-auto grid place-items-center rounded-2xl bg-raised text-amber', compact ? 'mb-2 h-10 w-10' : 'mb-3 h-12 w-12')}>
        <Upload size={compact ? 18 : 22} aria-hidden="true" />
      </div>
      <p className="font-semibold">{over ? 'Drop to add to your library' : 'Drag and drop books here'}</p>
      <p className="mt-1 text-sm text-muted">PDF, EPUB, TXT or DOCX. Files are processed and stored on this device.</p>
      <Button variant="primary" className="mt-4" onClick={picker.open}>
        <Upload size={16} /> Choose files
      </Button>
    </div>
  )
}

function UploadRow({ item }: { item: UploadItem }) {
  const { dismiss, retry } = useUploads()
  const active = !['done', 'error', 'queued'].includes(item.status)
  return (
    <li className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-muted">
          {item.status === 'done' ? <CheckCircle2 size={20} className="text-ok" /> : item.status === 'error' ? <AlertCircle size={20} className="text-danger" /> : active ? <Loader2 size={20} className="animate-spin text-amber" /> : <FileText size={20} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="text-xs text-muted">
            {item.type} · {formatBytes(item.size)} · {item.status === 'error' ? 'Failed' : `${PHASE[item.status]}${item.detail && item.status === 'extracting' ? ` ${item.detail}` : ''}`}
          </p>
          {item.status === 'error' && <p className="mt-1 text-sm text-danger" role="alert">{item.error}</p>}
          {active && <Progress className="mt-2" value={item.status === 'extracting' ? item.fraction : undefined} label={`${item.name}: ${PHASE[item.status]}`} />}
          {item.status === 'done' && item.bookId && (
            <div className="mt-2 space-y-2">
              <Link className="text-sm font-medium text-amber hover:underline" to={`/read/${item.bookId}`}>Start reading</Link>
              {!!item.scannedPages && (
                <div className="rounded-lg border border-amber/30 bg-amber/10 p-3">
                  <p className="mb-2 text-sm">{item.scannedPages} page(s) look scanned (no selectable text).</p>
                  <OcrControl bookId={item.bookId} pages={item.scannedPages} />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="flex">
          {item.status === 'error' && item.file && (
            <Button size="icon-sm" variant="ghost" aria-label={`Retry ${item.name}`} onClick={() => retry(item.id)}><RotateCw size={16} /></Button>
          )}
          {!active && <Button size="icon-sm" variant="ghost" aria-label={`Dismiss ${item.name}`} onClick={() => dismiss(item.id)}><X size={16} /></Button>}
        </div>
      </div>
    </li>
  )
}

export function UploadQueue() {
  const items = useUploads((s) => s.items)
  if (!items.length) return null
  return (
    <section aria-label="Uploads" className="space-y-2">
      <ul className="space-y-2" aria-live="polite">{items.map((i) => <UploadRow key={i.id} item={i} />)}</ul>
    </section>
  )
}
