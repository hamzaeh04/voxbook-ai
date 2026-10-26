import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  className?: string
  /** Slide in from the left as a navigation drawer. */
  side?: 'center' | 'left'
  hideTitle?: boolean
}

export function Dialog({ open, onOpenChange, title, description, children, footer, className, side = 'center', hideTitle }: Props) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <D.Content
          className={cn(
            'fixed z-50 border border-line bg-surface shadow-card focus:outline-none',
            side === 'center' && 'left-1/2 top-1/2 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl p-6 max-h-[90dvh] overflow-y-auto',
            side === 'left' && 'left-0 top-0 h-full w-72 max-w-[85vw] rounded-r-2xl overflow-y-auto',
            className,
          )}
        >
          <div className={cn(hideTitle && 'sr-only')}>
            <D.Title className="text-lg font-semibold">{title}</D.Title>
            <D.Description className={cn('mt-1 text-sm text-muted', !description && 'sr-only')}>{description ?? title}</D.Description>
          </div>
          {children}
          {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
          {side === 'center' && (
            <D.Close aria-label="Close dialog" className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-raised hover:text-fg">
              <X size={18} />
            </D.Close>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
