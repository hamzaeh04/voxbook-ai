import { AudioLines, AudioWaveform, Bookmark, ChevronsLeft, ChevronsRight, Clock, History, Library, LayoutDashboard, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useStorage } from '@/hooks/useStorage'
import { cn, formatBytes } from '@/lib/utils'
import { useSettings } from '@/stores/settings'
import { Progress } from '../ui/misc'

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/library', label: 'My Library', icon: Library },
  { to: '/recent', label: 'Recently Read', icon: Clock },
  { to: '/bookmarks', label: 'Bookmarks', icon: Bookmark },
  { to: '/recordings', label: 'Saved Recordings', icon: AudioLines },
  { to: '/voices', label: 'Voice Studio', icon: AudioWaveform },
  { to: '/history', label: 'Reading History', icon: History },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 px-1">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="9" className="fill-raised" />
        <path d="M8 11v10M12 8v16M16 12v8M20 9v14M24 13v6" className="stroke-amber" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      </svg>
      {!collapsed && (
        <div className="leading-tight">
          <p className="text-[15px] font-bold tracking-tight">VoxBook <span className="text-amber">AI</span></p>
          <p className="text-[10px] italic text-muted">Your books. Your voice. Your world.</p>
        </div>
      )}
    </div>
  )
}

export function SidebarContent({ collapsed, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const name = useSettings((s) => s.profileName)
  const storage = useStorage()
  return (
    <div className="flex h-full flex-col gap-6 p-3">
      <div className="pt-2"><Logo collapsed={collapsed} /></div>
      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={({ isActive }) =>
              cn(
                'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors',
                collapsed && 'justify-center px-0',
                isActive ? 'bg-amber/15 text-amber' : 'text-muted hover:bg-raised hover:text-fg',
              )
            }
          >
            <Icon size={19} aria-hidden="true" className="shrink-0" />
            <span className={cn(collapsed && 'sr-only')}>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="space-y-3 border-t border-line pt-3">
        {storage && !collapsed && (
          <div>
            <div className="mb-1.5 flex justify-between text-xs text-muted">
              <span>Storage</span>
              <span>{formatBytes(storage.usage)} / {formatBytes(storage.quota)}</span>
            </div>
            <Progress value={storage.ratio} label="Browser storage used" className={cn(storage.ratio > 0.85 && '[&>div]:bg-danger')} />
            {storage.ratio > 0.85 && <p className="mt-1.5 text-xs text-danger" role="status">Storage almost full. Remove books or recordings.</p>}
          </div>
        )}
        <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-violet/20 text-sm font-bold text-violet" aria-hidden="true">{name.slice(0, 1).toUpperCase() || 'R'}</div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{name}</p>
              <p className="text-xs text-muted">Local profile</p>
            </div>
          )}
          {!collapsed && (
            <NavLink to="/settings" onClick={onNavigate} aria-label="Settings shortcut" className="grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg">
              <Settings size={17} />
            </NavLink>
          )}
        </div>
      </div>
    </div>
  )
}

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <aside className={cn('relative hidden shrink-0 border-r border-line bg-surface transition-[width] duration-200 md:block', collapsed ? 'w-[72px]' : 'w-64')}>
      <SidebarContent collapsed={collapsed} />
      <button
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        className="absolute -right-3 top-7 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-muted hover:text-fg"
      >
        {collapsed ? <ChevronsRight size={14} /> : <ChevronsLeft size={14} />}
      </button>
    </aside>
  )
}
