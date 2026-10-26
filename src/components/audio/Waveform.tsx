import { useEffect, useRef } from 'react'
import { getEngine } from '@/lib/audioEngine'
import { useMotionLevel } from '@/hooks/useMotion'
import { cn } from '@/lib/utils'

interface Props {
  /** True while audio is playing. The animation loop only runs while active or easing back to idle. */
  active: boolean
  bars?: number
  className?: string
  /** Accessible description; the canvas is decorative otherwise. */
  label?: string
}

const IDLE = 0.05

/**
 * Signature animation 1 — audio-reactive waveform.
 * Reads real frequency data from the shared AnalyserNode. If the browser blocks the
 * analyser, a gentle approximation is drawn instead. Idle = calm baseline, loop stops.
 */
export function Waveform({ active, bars = 36, className, label }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const { reduced } = useMotionLevel()
  const levels = useRef<Float32Array>(new Float32Array(bars).fill(IDLE))

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (levels.current.length !== bars) levels.current = new Float32Array(bars).fill(IDLE)
    let raf = 0
    let w = 0
    let h = 0

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      const r = canvas.getBoundingClientRect()
      w = r.width
      h = r.height
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }

    const draw = () => {
      const css = getComputedStyle(document.documentElement)
      const a = `rgb(${css.getPropertyValue('--amber')})`
      const v = `rgb(${css.getPropertyValue('--violet')})`
      ctx.clearRect(0, 0, w, h)
      const grad = ctx.createLinearGradient(0, 0, w, 0)
      grad.addColorStop(0, a)
      grad.addColorStop(1, v)
      ctx.fillStyle = grad
      const gap = Math.max(2, w / bars / 3.5)
      const bw = Math.max(2, (w - gap * (bars - 1)) / bars)
      for (let i = 0; i < bars; i++) {
        const bh = Math.max(3, levels.current[i] * h)
        const x = i * (bw + gap)
        ctx.beginPath()
        ctx.roundRect(x, (h - bh) / 2, bw, bh, bw / 2)
        ctx.fill()
      }
    }

    const step = (t: number) => {
      const engine = getEngine()
      const data = active ? engine.frequencyData() : null
      let settled = true
      for (let i = 0; i < bars; i++) {
        let target = IDLE
        if (active) {
          if (data) {
            // Use the lower ~75% of bins (speech energy), mirrored so low frequencies sit in the centre.
            const mid = Math.abs(i - bars / 2) / (bars / 2)
            const bin = Math.floor(mid * data.length * 0.75)
            target = Math.max(IDLE, Math.pow(data[bin] / 255, 1.25))
          } else {
            target = 0.18 + 0.32 * Math.abs(Math.sin(t / 260 + i * 0.55)) * Math.abs(Math.sin(t / 900 + i))
          }
        }
        const cur = levels.current[i]
        const next = cur + (target - cur) * (target > cur ? 0.45 : 0.14)
        levels.current[i] = next
        if (Math.abs(next - target) > 0.004) settled = false
      }
      draw()
      if (active || !settled) raf = requestAnimationFrame(step)
    }

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    if (reduced) {
      // No motion: a static shape that reflects the state only.
      levels.current.fill(IDLE)
      if (active) for (let i = 0; i < bars; i++) levels.current[i] = 0.15 + 0.25 * Math.abs(Math.sin(i * 0.6))
      draw()
    } else {
      raf = requestAnimationFrame(step)
    }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [active, bars, reduced])

  return <canvas ref={ref} className={cn('h-10 w-full', className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}
