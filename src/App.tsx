import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Overlays, Shell } from '@/components/layout/Shell'
import { resumeActiveBatches } from '@/lib/batch'
import { initPlayback } from '@/lib/playback'
import { applyTheme, useSettings } from '@/stores/settings'
import { toast } from '@/stores/toasts'
import { useVoices } from '@/stores/voices'
import Dashboard from '@/pages/Dashboard'
import Library from '@/pages/Library'

const Reader = lazy(() => import('@/pages/Reader'))
const VoiceStudio = lazy(() => import('@/pages/VoiceStudio'))
const Recordings = lazy(() => import('@/pages/Recordings'))
const Bookmarks = lazy(() => import('@/pages/Bookmarks'))
const History = lazy(() => import('@/pages/History'))
const Settings = lazy(() => import('@/pages/Settings'))

const Loading = () => <div className="p-8 text-muted" role="status">Loading…</div>

export default function App() {
  const theme = useSettings((s) => s.theme)
  const load = useVoices((s) => s.load)
  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => {
    initPlayback()
    void load().then(() => resumeActiveBatches())
    navigator.storage?.estimate?.().then((e) => {
      if (e?.quota && (e.usage ?? 0) / e.quota > 0.9) toast.warning('Browser storage is over 90% full. Remove books or recordings to avoid failed saves.')
    }).catch(() => undefined)
  }, [load])

  return (
    <>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/read/:id" element={<Reader />} />
          <Route path="*" element={
            <Shell>
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/library" element={<Library />} />
                  <Route path="/recent" element={<Library mode="recent" />} />
                  <Route path="/bookmarks" element={<Bookmarks />} />
                  <Route path="/recordings" element={<Recordings />} />
                  <Route path="/voices" element={<VoiceStudio />} />
                  <Route path="/history" element={<History />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="*" element={<div className="py-20 text-center"><h1 className="text-xl font-semibold">Page not found</h1></div>} />
                </Routes>
              </Suspense>
            </Shell>
          } />
        </Routes>
      </Suspense>
      <Overlays />
    </>
  )
}
