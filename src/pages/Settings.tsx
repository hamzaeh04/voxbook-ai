import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Select, Switch } from '@/components/ui/misc'
import { SetupBanner } from '@/components/layout/SetupBanner'
import { useStorage } from '@/hooks/useStorage'
import { getDb } from '@/lib/db'
import { unloadPlayback } from '@/lib/playback'
import { formatBytes } from '@/lib/utils'
import { applyTheme, useSettings } from '@/stores/settings'
import { toast } from '@/stores/toasts'
import { useVoices } from '@/stores/voices'

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="max-w-md"><p className="text-sm font-medium">{title}</p>{hint && <p className="text-xs text-muted">{hint}</p>}</div>
      {children}
    </div>
  )
}

export default function Settings() {
  const s = useSettings()
  const storage = useStorage()
  const { provider, load } = useVoices()
  const [wipe, setWipe] = useState(false)

  const wipeAll = async () => {
    unloadPlayback()
    const db = await getDb()
    for (const store of ['books', 'pages', 'narrations', 'recordings', 'history', 'files', 'meta'] as const) await db.clear(store)
    setWipe(false)
    toast.success('All local books, recordings and history were deleted.')
    location.assign('/')
  }

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <SetupBanner />
      <section className="card divide-y divide-line px-5" aria-label="Appearance">
        <Row title="Theme" hint="Dark is the default."><Select label="Theme" value={s.theme} onChange={(v) => { s.set({ theme: v as 'dark' | 'light' }); applyTheme(v as 'dark' | 'light') }} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} /></Row>
        <Row title="Animations" hint="Auto follows your system’s reduced-motion setting and turns off 3D effects on low-power devices."><Select label="Animations" value={s.motion} onChange={(v) => s.set({ motion: v as 'auto' | 'full' | 'reduced' })} options={[{ value: 'auto', label: 'Automatic' }, { value: 'full', label: 'Always full' }, { value: 'reduced', label: 'Reduced' }]} /></Row>
        <Row title="Profile name"><input value={s.profileName} maxLength={30} onChange={(e) => s.set({ profileName: e.target.value })} aria-label="Profile name" className="h-10 w-48 rounded-xl border border-line bg-raised px-3 text-sm" /></Row>
      </section>

      <section className="card divide-y divide-line px-5" aria-label="Narration and privacy">
        <Row title="Auto-generate next page in continuous mode" hint="When off, continuous reading asks before generating audio that does not exist yet (avoids surprise provider usage)."><Switch label="Auto-generate next page" checked={s.autoGenerateNext} onChange={(v) => s.set({ autoGenerateNext: v })} /></Row>
        <Row title="Send page text to the TTS provider" hint={provider?.external ? `Currently ${provider.label}. ${provider.retentionNote}` : 'Not needed for the current provider.'}>
          <Switch label="Permission to send page text to the TTS provider" checked={Boolean(provider && s.consent[provider.id])} onChange={(v) => provider && s.set({ consent: { ...s.consent, [provider.id]: v } })} />
        </Row>
        <Row title="Server access token" hint="Only needed if the server sets APP_ACCESS_TOKEN. Stored in this browser."><input type="password" value={s.accessToken} onChange={(e) => s.set({ accessToken: e.target.value })} onBlur={() => void load()} aria-label="Server access token" autoComplete="off" className="h-10 w-56 rounded-xl border border-line bg-raised px-3 text-sm" /></Row>
      </section>

      <section className="card divide-y divide-line px-5" aria-label="Library">
        <Row title="Maximum upload size" hint="Larger files are rejected before processing."><Select label="Maximum upload size" value={String(s.maxFileMB)} onChange={(v) => s.set({ maxFileMB: Number(v) })} options={[25, 50, 100, 250].map((n) => ({ value: String(n), label: `${n} MB` }))} /></Row>
        <Row title="OCR language" hint="Tesseract language code for scanned PDFs, e.g. eng, deu, fra, spa."><input value={s.ocrLanguage} onChange={(e) => s.set({ ocrLanguage: e.target.value.trim() || 'eng' })} aria-label="OCR language" className="h-10 w-28 rounded-xl border border-line bg-raised px-3 text-sm" /></Row>
        <Row title="Storage used" hint="Books, page text and audio are stored in this browser (IndexedDB).">
          <span className="text-sm tabular-nums">{storage ? `${formatBytes(storage.usage)} of ${formatBytes(storage.quota)}` : 'Unavailable'}</span>
        </Row>
        <Row title="Delete all local data" hint="Removes every book, recording, bookmark and history entry from this device."><Button variant="danger" onClick={() => setWipe(true)}>Delete everything</Button></Row>
      </section>

      <Dialog open={wipe} onOpenChange={setWipe} title="Delete all local data?" description="This cannot be undone." footer={<><Button variant="ghost" onClick={() => setWipe(false)}>Cancel</Button><Button variant="danger" onClick={() => void wipeAll()}>Delete everything</Button></>}>
        <p className="mt-4 text-sm text-muted">All books, page text, narration audio, microphone recordings, bookmarks and history stored by VoxBook on this device will be erased.</p>
      </Dialog>
    </div>
  )
}
