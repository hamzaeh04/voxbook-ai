import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  /** Fires when the user releases the thumb or finishes a keyboard adjustment. */
  onCommit?: (v: number) => void
  label: string
  valueText?: string
  className?: string
  disabled?: boolean
}

export function Slider({ value, min, max, step = 1, onChange, onCommit, label, valueText, className, disabled }: Props) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <input
      type="range"
      className={cn('range', className)}
      style={{ '--p': `${pct}%` } as CSSProperties}
      min={min}
      max={max}
      step={step}
      value={Number.isFinite(value) ? value : min}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={valueText}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={onCommit && ((e) => onCommit(Number(e.currentTarget.value)))}
      onKeyUp={onCommit && ((e) => onCommit(Number(e.currentTarget.value)))}
      onBlur={onCommit && ((e) => onCommit(Number(e.currentTarget.value)))}
    />
  )
}
