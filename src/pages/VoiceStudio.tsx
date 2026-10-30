import { SAMPLE_SENTENCE, STYLE_LABELS } from '@shared/voices'
import type { NarrationStyle } from '@shared/types'
import { Info, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { accentOf, accentOptions } from '@/lib/voiceGroups'
import { useKokoro } from '@/lib/kokoro'
import { VoiceCard } from '@/components/audio/VoiceCard'
import { VoiceOrb, type OrbState } from '@/components/audio/VoiceOrb'
import { Waveform } from '@/components/audio/Waveform'
import { SetupBanner } from '@/components/layout/SetupBanner'
import { Notice, Select } from '@/components/ui/misc'
import { Slider } from '@/components/ui/Slider'
import { setVolume } from '@/lib/playback'
import { previewVoice, stopPreview, usePreview } from '@/lib/preview'
import { useSettings } from '@/stores/settings'
import { pickVoice, useVoices } from '@/stores/voices'

export default function VoiceStudio() {
  const { voices, provider, status } = useVoices()
  const s = useSettings()
  const preview = usePreview()
  const selected = pickVoice(voices, s.preferredVoiceId)
  const orb: OrbState = preview.status === 'error' ? 'error' : preview.status === 'generating' ? 'generating' : preview.status === 'playing' ? 'playing' : 'idle'
  const supports = selected?.supportedSettings
  const [q, setQ] = useState('')
  const [accent, setAccent] = useState('all')
  const [engine, setEngine] = useState('all')
  const kokoro = useKokoro()
  const [gender, setGender] = useState('all')
  const [multi, setMulti] = useState(false)
  const [shown, setShown] = useState(60)
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase()
    return voices.filter(
      (v) =>
        (accent === 'all' || accentOf(v) === accent) &&
        (engine === 'all' || v.provider === engine) &&
        (gender === 'all' || v.gender === gender) &&
        (!multi || v.multilingual) &&
        (!query || `${v.displayName} ${v.language} ${v.description} ${v.characteristics.join(' ')}`.toLowerCase().includes(query)),
    )
  }, [voices, q, accent, engine, gender, multi])
  useEffect(() => setShown(60), [q, accent, engine, gender, multi])

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Voice Studio</h1>
        <p className="text-sm text-muted">Preview narrators and tune how your books are read.</p>
      </header>
      <SetupBanner />

      <section className="card grid items-center gap-6 p-6 md:grid-cols-[auto_1fr]">
        <div className="mx-auto"><VoiceOrb state={orb} size={140} /></div>
        <div className="space-y-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted">Sample sentence</p>
            <p className="mt-1 font-serif text-lg italic">“{selected?.sampleText ?? SAMPLE_SENTENCE}”</p>
          </div>
          <Waveform active={preview.status === 'playing'} bars={48} className="h-14" label={preview.status === 'playing' ? 'Audio waveform, playing' : 'Audio waveform, idle'} />
          <p className="text-sm text-muted" role="status">
            {preview.status === 'generating' ? 'Generating preview…' : preview.status === 'playing' ? `Playing ${selected && preview.voiceId === selected.id ? selected.displayName : 'preview'}` : preview.status === 'error' ? '' : selected ? `Selected: ${selected.displayName}` : 'No voice available yet.'}
          </p>
          {preview.status === 'error' && <Notice tone="error" title="Preview failed">{preview.error}</Notice>}
        </div>
      </section>

      {status === 'loading' && <p className="text-muted" role="status">Loading voices…</p>}
      {voices.length > 0 && (
        <section aria-labelledby="vc-h" className="space-y-3">
          <h2 id="vc-h" className="text-lg font-semibold">{voices.length} English voices · 2 free engines</h2>
          <div className="flex flex-wrap items-center gap-2.5" role="search">
            <div className="relative min-w-[200px] flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-3 text-muted" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Search voices" placeholder="Search name, accent or personality" className="h-10 w-full rounded-xl border border-line bg-raised pl-9 pr-3 text-sm" />
            </div>
            <Select label="Engine" value={engine} onChange={setEngine} options={[
              { value: 'all', label: 'All engines' },
              { value: 'edge', label: `Microsoft Edge · online (${voices.filter((v) => v.provider === 'edge').length})` },
              { value: 'kokoro', label: `Kokoro · on this device (${voices.filter((v) => v.provider === 'kokoro').length})` },
            ]} />
            <Select label="Accent" value={accent} onChange={setAccent} options={[{ value: 'all', label: `All English accents (${voices.length})` }, ...accentOptions(voices)]} />
            <Select label="Gender" value={gender} onChange={setGender} options={[{ value: 'all', label: 'Any gender' }, { value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }]} />
            <label className="flex h-10 items-center gap-2 text-sm text-muted"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--amber))]" />Multilingual only</label>
          </div>
          {(engine === 'kokoro' || kokoro.status === 'loading' || kokoro.status === 'error') && (
            <Notice tone={kokoro.status === 'error' ? 'error' : 'info'} title="Kokoro runs on this device">
              {kokoro.status === 'loading'
                ? `Downloading the voice model (one time${kokoro.device === 'webgpu' ? ', GPU version ~310 MB' : ', ~90 MB'})… ${kokoro.download ? `${Math.round(kokoro.download)}%` : ''}`
                : kokoro.status === 'error'
                  ? `The on-device engine failed: ${kokoro.error}`
                  : `Free and private: speech is generated in your browser${kokoro.device ? ` using the ${kokoro.device === 'webgpu' ? 'GPU' : 'CPU'}` : ''}, nothing is sent anywhere. The first use downloads the voice model once. Emotion is performed with per-sentence pace, loudness and pauses.`}
            </Notice>
          )}
          <p className="text-sm text-muted" role="status">Showing {Math.min(shown, filtered.length)} of {filtered.length} matching voices.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.slice(0, shown).map((v) => (
              <VoiceCard key={v.id} voice={v} selected={selected?.id === v.id} previewState={preview.voiceId === v.id && (preview.status === 'generating' || preview.status === 'playing') ? preview.status : 'idle'}
                onSelect={() => s.set({ preferredVoiceId: v.id })}
                onPreview={() => (preview.voiceId === v.id && preview.status === 'playing' ? stopPreview() : void previewVoice(v, { style: s.style }))} />
            ))}
          </div>
          {filtered.length > shown && <div className="text-center"><Button onClick={() => setShown((n) => n + 60)}>Show more voices ({filtered.length - shown} more)</Button></div>}
          {!filtered.length && <p className="text-sm text-muted">No voices match these filters.</p>}
          <p className="flex gap-2 text-xs text-muted"><Info size={14} className="mt-0.5 shrink-0" />Voice names describe the closest match the active provider offers. “Heavy male”, “warm female” and “neutral” are assigned to real provider voices; the app does not alter or fake pitch or gender.</p>
        </section>
      )}

      <section aria-labelledby="ctl-h" className="card space-y-5 p-6">
        <h2 id="ctl-h" className="text-lg font-semibold">Narration settings</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="style" className="text-sm font-medium">Speaking style / expressiveness</label>
            <Select label="Speaking style" value={s.style} onChange={(v) => s.set({ style: v as NarrationStyle })} className="w-full" options={(Object.keys(STYLE_LABELS) as NarrationStyle[]).map((k) => ({ value: k, label: STYLE_LABELS[k] }))} />
            <p className="text-xs text-muted">{supports?.style === false ? 'This voice/provider ignores style; the setting has no effect.' : 'Style changes the generated audio, so existing pages show “regenerate” until updated.'}</p>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Language / accent</p>
            <p className="flex h-10 items-center rounded-xl border border-line bg-raised px-3 text-sm text-muted">{selected?.language ?? '—'}</p>
            <p className="text-xs text-muted">Determined by the voice; the provider detects the text language automatically.</p>
          </div>
          <label className="block space-y-1.5 text-sm font-medium">Default speaking speed · {s.playbackSpeed.toFixed(2)}×
            <Slider label="Default playback speed" min={0.5} max={2} step={0.05} value={s.playbackSpeed} onChange={(v) => s.set({ playbackSpeed: v })} />
            <span className="block text-xs font-normal text-muted">Applied at playback with pitch preserved, so changing it never needs a new generation.</span>
          </label>
          <label className="block space-y-1.5 text-sm font-medium">Volume · {Math.round(s.volume * 100)}%
            <Slider label="Volume" min={0} max={1} step={0.01} value={s.volume} onChange={(v) => (s.set({ volume: v }), setVolume(v))} />
          </label>
          <div className="space-y-1.5 opacity-60">
            <p className="text-sm font-medium">Pitch</p>
            <Slider label="Pitch (not supported)" min={-1} max={1} step={0.1} value={0} onChange={() => undefined} disabled />
            <p className="text-xs text-muted">Not supported by {provider?.label ?? 'the current provider'}.</p>
          </div>
        </div>
      </section>
    </div>
  )
}
