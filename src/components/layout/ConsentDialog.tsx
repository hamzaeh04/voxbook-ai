import { ShieldCheck } from 'lucide-react'
import { useConsent } from '@/stores/consent'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'

export function ConsentDialog() {
  const { pending, answer } = useConsent()
  return (
    <Dialog
      open={!!pending}
      onOpenChange={(o) => !o && answer(false)}
      title="Send page text to your TTS provider?"
      description="Generating narration needs an external speech service."
      footer={
        <>
          <Button variant="ghost" onClick={() => answer(false)}>Not now</Button>
          <Button variant="primary" onClick={() => answer(true)}>I agree</Button>
        </>
      }
    >
      <div className="mt-4 space-y-3 text-sm text-muted">
        <p className="flex gap-2 text-fg"><ShieldCheck size={18} className="mt-0.5 shrink-0 text-amber" /> Your books stay on this device.</p>
        <p>
          Only the text of the single page being narrated is sent, via this app’s server, to <strong className="text-fg">{pending?.provider.label}</strong>. The server keeps generated
          audio temporarily to avoid duplicate requests. Your API key never reaches the browser.
        </p>
        <p>{pending?.provider.retentionNote}</p>
        <p>You can withdraw this permission in Settings.</p>
      </div>
    </Dialog>
  )
}
