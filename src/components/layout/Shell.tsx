import { Menu } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { PlayerBar } from '../audio/PlayerBar'
import { BookOpenOverlay } from '../books/BookOpenOverlay'
import { Dialog } from '../ui/Dialog'
import { Toaster } from '../ui/misc'
import { Announcer } from './Announcer'
import { ConsentDialog } from './ConsentDialog'
import { Logo, Sidebar, SidebarContent } from './Sidebar'
import { usePlayback } from '@/stores/playback'

export function Overlays() {
  return (
    <>
      <Toaster />
      <ConsentDialog />
      <Announcer />
      <BookOpenOverlay />
    </>
  )
}

export function Shell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('voxbook-sidebar') === '1' } catch { return false }
  })
  const [drawer, setDrawer] = useState(false)
  const hasTrack = usePlayback((s) => Boolean(s.bookId))
  useEffect(() => {
    try { localStorage.setItem('voxbook-sidebar', collapsed ? '1' : '0') } catch { /* ignore */ }
  }, [collapsed])

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[80] focus:rounded-lg focus:bg-amber focus:px-3 focus:py-2 focus:text-[rgb(var(--on-amber))]">Skip to content</a>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2 md:hidden">
          <button aria-label="Open navigation menu" onClick={() => setDrawer(true)} className="grid h-10 w-10 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg"><Menu size={22} /></button>
          <Logo />
        </header>
        <main id="main" tabIndex={-1} className="scroll-thin min-h-0 flex-1 overflow-y-auto focus:outline-none">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</div>
        </main>
        {hasTrack && <PlayerBar />}
      </div>
      <Dialog open={drawer} onOpenChange={setDrawer} title="Navigation" side="left" hideTitle className="p-0">
        <SidebarContent onNavigate={() => setDrawer(false)} />
      </Dialog>
    </div>
  )
}
