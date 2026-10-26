import { ScanText } from 'lucide-react'
import { useState } from 'react'
import { useUploads } from '@/stores/uploads'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Notice, Progress } from '../ui/misc'

/** Offers OCR for scanned PDF pages, with consent about the language-model download and live progress. */
export function OcrControl({ bookId, pages }: { bookId: string; pages: number }) {
  const [confirm, setConfirm] = useState(false)
  const state = useUploads((s) => s.ocr[bookId])
  const { startOcr, cancelOcr } = useUploads()

  if (state?.status === 'running') {
    const frac = state.total ? (state.done + state.pageProgress) / state.total : undefined
    return (
      <div className="space-y-2" aria-live="polite">
        <p className="text-sm">
          Recognising page {state.page || '…'} ({state.done}/{state.total || pages})
        </p>
        <Progress value={frac} label="OCR progress" />
        <Button size="sm" variant="ghost" onClick={() => cancelOcr(bookId)}>
          Cancel OCR
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {state?.status === 'error' && <Notice tone="error" title="OCR failed">{state.message}</Notice>}
      {state?.status === 'cancelled' && <Notice tone="warning">{state.message}</Notice>}
      {state?.status === 'done' && <Notice tone="success">{state.message}</Notice>}
      {state?.status !== 'done' && (
        <Button size="sm" variant="violet" onClick={() => setConfirm(true)}>
          <ScanText size={15} /> Run OCR on {pages} scanned page{pages === 1 ? '' : 's'}
        </Button>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Run OCR on scanned pages?"
        description="Text recognition runs entirely in your browser."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => (setConfirm(false), void startOcr(bookId))}>Start OCR</Button>
          </>
        }
      >
        <p className="mt-4 text-sm text-muted">
          {pages} page{pages === 1 ? ' has' : 's have'} no selectable text. OCR can take a few seconds per page. Your PDF is not uploaded anywhere; the
          first run downloads the OCR language model (a few MB) from a public CDN.
        </p>
      </Dialog>
    </div>
  )
}
