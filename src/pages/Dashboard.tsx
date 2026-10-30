import { AudioLines, BookOpen, Clock, Headphones, Upload } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { BookCard } from '@/components/books/BookCard'
import { Cover } from '@/components/books/Cover'
import { UploadQueue, UploadZone, useFilePicker } from '@/components/books/UploadZone'
import { VoiceCard } from '@/components/audio/VoiceCard'
import { SetupBanner } from '@/components/layout/SetupBanner'
import { LibraryBanner } from '@/components/layout/LibraryBanner'
import { Button } from '@/components/ui/Button'
import { EmptyState, Progress } from '@/components/ui/misc'
import { useDb } from '@/hooks/useDb'
import { useLibrary } from '@/hooks/useLibrary'
import { getMeta, listRecordings, narrationCounts } from '@/lib/db'
import { downloadVoiceSample, previewVoice, stopPreview, usePreview, useSampleDownloads } from '@/lib/preview'
import { formatListening, unitOf } from '@/lib/utils'
import { useSettings } from '@/stores/settings'
import { pickVoice, useVoices } from '@/stores/voices'

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="card flex items-center gap-3.5 p-4">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-raised text-amber" aria-hidden="true">{icon}</div>
      <div>
        <p className="text-xl font-bold tabular-nums leading-tight">{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { books, counts, loading } = useLibrary()
  const navigate = useNavigate()
  const picker = useFilePicker()
  const { voices } = useVoices()
  const settings = useSettings()
  const preview = usePreview()
  const sampleBusy = useSampleDownloads((st) => st.busy)
  const { data: listen } = useDb(() => getMeta<number>('listenSeconds'), [])
  const { data: mic } = useDb(async () => (await listRecordings()).length, [])
  const { data: audioTotal } = useDb(async () => Object.values(await narrationCounts()).reduce((a, b) => a + b, 0), [])

  const pagesRead = books.reduce((s, b) => s + b.completedPages.length, 0)
  const continueList = books.filter((b) => b.lastOpenedAt > 0 && b.readingProgress < 1).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt).slice(0, 3)
  const recent = [...books].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6)
  const selected = pickVoice(voices, settings.preferredVoiceId)
  const quick = voices.filter((v) => v.persona !== 'other').slice(0, 3)

  return (
    <div className="space-y-9">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome back to your reading space.</h1>
          <p className="mt-1 text-muted">Read, listen, and keep every page’s narration.</p>
        </div>
        {picker.input}
        <Button variant="primary" size="lg" onClick={picker.open}><Upload size={18} /> Upload book</Button>
      </header>

      <SetupBanner />
      <LibraryBanner />
      <UploadQueue />

      {!loading && books.length === 0 ? (
        <div className="space-y-4">
          <EmptyState icon={<BookOpen size={26} />} title="Your shelf is waiting" body="Upload your first book. It is processed on this device, split into pages, and ready to read or narrate in seconds." />
          <UploadZone />
        </div>
      ) : (
        <>
          <section aria-label="Reading statistics" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={<BookOpen size={19} />} label="Books uploaded" value={books.length} />
            <Stat icon={<Clock size={19} />} label="Pages & chapters read" value={pagesRead} />
            <Stat icon={<Headphones size={19} />} label="Listening time" value={formatListening(listen ?? 0)} />
            <Stat icon={<AudioLines size={19} />} label="Recordings saved" value={(audioTotal ?? 0) + (mic ?? 0)} />
          </section>

          {continueList.length > 0 && (
            <section aria-labelledby="continue-h" className="space-y-3">
              <h2 id="continue-h" className="text-lg font-semibold">Continue reading</h2>
              <ul className="grid gap-3 md:grid-cols-3">
                {continueList.map((b) => (
                  <li key={b.id}>
                    <button onClick={() => navigate(`/read/${b.id}`)} className="card flex w-full items-center gap-4 p-3 text-left transition-colors hover:border-amber/50" aria-label={`Continue ${b.title} from ${unitOf(b).one} ${b.lastReadPage}`}>
                      <div className="h-24 w-16 shrink-0 overflow-hidden rounded-md shadow-card"><Cover book={b} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{b.title}</p>
                        <p className="truncate text-xs text-muted">{b.author}</p>
                        <Progress className="mt-3" value={b.readingProgress} label={`${b.title} progress`} />
                        <p className="mt-1.5 text-xs text-muted">{unitOf(b).One} {b.lastReadPage} of {b.totalPages}</p>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="recent-h" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="recent-h" className="text-lg font-semibold">Recently added</h2>
              <Link to="/library" className="text-sm text-amber hover:underline">View library</Link>
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {recent.map((b) => <li key={b.id}><BookCard book={b} audioPages={counts[b.id]} /></li>)}
            </ul>
          </section>

          <UploadZone compact />
        </>
      )}

      {quick.length > 0 && (
        <section aria-labelledby="voices-h" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="voices-h" className="text-lg font-semibold">Preferred narration voices</h2>
            <Link to="/voices" className="text-sm text-amber hover:underline">Open Voice Studio</Link>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {quick.map((v) => (
              <VoiceCard key={v.id} voice={v} compact selected={selected?.id === v.id} downloading={Boolean(sampleBusy[v.id])} onDownload={() => void downloadVoiceSample(v, { style: settings.style })} previewState={preview.voiceId === v.id && preview.status !== 'idle' && preview.status !== 'error' ? preview.status : 'idle'}
                onSelect={() => settings.set({ preferredVoiceId: v.id })} onPreview={() => (preview.voiceId === v.id && preview.status === 'playing' ? stopPreview() : void previewVoice(v, { style: settings.style }))} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
