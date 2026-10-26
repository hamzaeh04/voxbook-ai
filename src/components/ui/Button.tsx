import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'violet'
type Size = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm'

const variants: Record<Variant, string> = {
  primary: 'bg-amber text-[rgb(var(--on-amber))] hover:brightness-110 font-semibold',
  secondary: 'bg-raised text-fg border border-line hover:bg-line/60',
  ghost: 'text-muted hover:text-fg hover:bg-raised',
  danger: 'bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25',
  violet: 'bg-violet text-white hover:brightness-110 font-semibold',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
  icon: 'h-11 w-11 min-w-11',
  'icon-sm': 'h-9 w-9 min-w-9',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant = 'secondary', size = 'md', type = 'button', ...props }, ref) => (
  <button
    ref={ref}
    type={type}
    className={cn(
      'inline-flex items-center justify-center rounded-xl transition-colors duration-150 select-none disabled:opacity-45 disabled:pointer-events-none',
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  />
))
Button.displayName = 'Button'
