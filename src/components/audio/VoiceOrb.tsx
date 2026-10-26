import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { getEngine } from '@/lib/audioEngine'
import { useMotionLevel } from '@/hooks/useMotion'
import { cn } from '@/lib/utils'

export type OrbState = 'idle' | 'generating' | 'playing' | 'success' | 'error'

const LABEL: Record<OrbState, string> = {
  idle: 'Voice orb, idle',
  generating: 'Generating narration',
  playing: 'Narration playing',
  success: 'Narration ready',
  error: 'Narration failed',
}

/**
 * Signature animation 3 — voice generation orb.
 * idle: slow breathing · generating: controlled faster pulse + sweeping ring ·
 * playing: scale follows live audio amplitude (rAF writes a CSS var, no React re-renders) ·
 * success: ring draws and a check strokes in · error: red tint with an alert icon.
 */
export function VoiceOrb({ state, size = 120, className }: { state: OrbState; size?: number; className?: string }) {
  const { reduced } = useMotionLevel()
  const ampRef = useRef<HTMLDivElement>(null)

  // Amplitude driver: only runs while playing.
  useEffect(() => {
    const el = ampRef.current
    if (!el || state !== 'playing' || reduced) {
      el?.style.setProperty('--amp', '0')
      return
    }
    let raf = 0
    let smooth = 0
    const tick = () => {
      smooth += (getEngine().level() - smooth) * 0.25
      el.style.setProperty('--amp', smooth.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      el.style.setProperty('--amp', '0')
    }
  }, [state, reduced])

  const breathe = reduced ? {} : state === 'generating' ? { scale: [1, 1.1, 1], transition: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' as const } } : state === 'idle' ? { scale: [1, 1.04, 1], transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' as const } } : { scale: 1 }
  const danger = state === 'error'
  const c1 = danger ? 'rgb(var(--danger))' : 'rgb(var(--amber))'
  const c2 = danger ? 'rgb(var(--danger) / .7)' : 'rgb(var(--violet))'
  const c3 = danger ? 'rgb(var(--danger) / .5)' : 'rgb(var(--indigo))'

  return (
    <div
      role={state === 'error' ? 'alert' : 'img'}
      aria-label={LABEL[state]}
      className={cn('relative grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      {/* amplitude wrapper: scale reads --amp written by rAF */}
      <div ref={ampRef} className="absolute inset-0" style={{ transform: 'scale(calc(1 + var(--amp, 0) * 0.35))', transition: reduced ? undefined : 'transform 60ms linear' }}>
        <motion.div className="absolute inset-0" animate={breathe}>
          <motion.div
            className="orb-layer"
            style={{ background: `radial-gradient(circle at 30% 30%, ${c1}, transparent 60%)`, filter: 'blur(2px)' }}
            animate={reduced ? undefined : { rotate: 360 }}
            transition={{ duration: state === 'generating' ? 4 : 18, repeat: Infinity, ease: 'linear' }}
          />
          <motion.div
            className="orb-layer"
            style={{ background: `radial-gradient(circle at 70% 65%, ${c2}, transparent 62%)`, mixBlendMode: 'screen', filter: 'blur(3px)' }}
            animate={reduced ? undefined : { rotate: -360 }}
            transition={{ duration: state === 'generating' ? 5 : 24, repeat: Infinity, ease: 'linear' }}
          />
          <div className="orb-layer" style={{ background: `radial-gradient(circle at 50% 50%, ${c3} 0%, transparent 70%)`, opacity: 0.7 }} />
          <div className="orb-layer" style={{ boxShadow: `inset 0 0 ${size * 0.18}px rgb(255 255 255 / 0.18), 0 0 ${size * 0.35}px ${c2}` , opacity: 0.8 }} />
        </motion.div>
      </div>

      <svg className="absolute inset-0 overflow-visible" viewBox="0 0 100 100" aria-hidden="true">
        {state === 'generating' && (
          <motion.circle cx="50" cy="50" r="47" fill="none" stroke="rgb(var(--fg))" strokeOpacity="0.7" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="40 260"
            style={{ transformOrigin: '50px 50px' }} animate={reduced ? undefined : { rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }} />
        )}
        {state === 'success' && (
          <>
            <motion.circle cx="50" cy="50" r="47" fill="none" stroke="rgb(var(--ok))" strokeWidth="2" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6 }} />
            <motion.path d="M34 52 L46 63 L67 39" fill="none" stroke="rgb(var(--ok))" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: reduced ? 0 : 0.35 }} />
          </>
        )}
      </svg>
      {danger && <AlertTriangle className="relative text-white drop-shadow" size={size * 0.34} aria-hidden="true" />}
    </div>
  )
}
