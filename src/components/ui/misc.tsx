import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useToasts } from '@/stores/toasts'

export function Progress({ value, className, label }: { value?: number; className?: string; label: string }) {
  const determinate = typeof value === 'number'
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(value * 100) : undefined}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div
        className={cn('h-full rounded-full bg-amber transition-[width] duration-300', !determinate && 'w-1/3 animate-pulse')}
        style={determinate ? { width: `${Math.max(0, Math.min(1, value)) * 100}%` } : undefined}
      />
    </div>
  )
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'amber' | 'violet' | 'ok' | 'danger'; className?: string }) {
  const tones = {
    neutral: 'bg-raised text-muted border-line',
    amber: 'bg-amber/15 text-amber border-amber/30',
    violet: 'bg-violet/15 text-violet border-violet/30',
    ok: 'bg-ok/15 text-ok border-ok/30',
    danger: 'bg-danger/15 text-danger border-danger/30',
  }
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full border transition-colors', checked ? 'border-amber bg-amber' : 'border-line bg-raised')}
    >
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full transition-all', checked ? 'left-[22px] bg-[rgb(var(--on-amber))]' : 'left-1 bg-muted')} />
    </button>
  )
}

export function Select({ value, onChange, options, label, className }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string; className?: string }) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-10 rounded-xl border border-line bg-raised px-3 text-sm text-fg', className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-raised text-amber">{icon}</div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Notice({ tone = 'info', title, children, action }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: string; children?: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'error' || tone === 'warning' ? AlertTriangle : tone === 'success' ? CheckCircle2 : Info
  const color = { info: 'text-indigo border-indigo/30 bg-indigo/10', warning: 'text-amber border-amber/30 bg-amber/10', error: 'text-danger border-danger/30 bg-danger/10', success: 'text-ok border-ok/30 bg-ok/10' }[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-xl border p-3.5 text-sm', color)}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-fg/85">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-[60] flex w-[min(92vw,380px)] flex-col gap-2 md:bottom-6">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface p-3.5 text-sm shadow-card',
            t.kind === 'error' ? 'border-danger/40' : t.kind === 'success' ? 'border-ok/40' : t.kind === 'warning' ? 'border-amber/40' : 'border-line',
          )}
        >
          <p className="flex-1">{t.message}</p>
          {t.action && (
            <button className="font-semibold text-amber hover:underline" onClick={() => (t.action!.run(), dismiss(t.id))}>
              {t.action.label}
            </button>
          )}
          <button aria-label="Dismiss notification" className="text-muted hover:text-fg" onClick={() => dismiss(t.id)}>
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}
