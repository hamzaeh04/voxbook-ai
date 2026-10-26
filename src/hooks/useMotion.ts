import { useReducedMotion } from 'framer-motion'
import { useSettings } from '@/stores/settings'

function lowPerformance() {
  const nav = navigator as Navigator & { deviceMemory?: number }
  return (nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2
}

/** `reduced`: no decorative motion. `effects3d`: allow CSS 3D transforms (off on low-end devices). */
export function useMotionLevel() {
  const prefersReduced = useReducedMotion()
  const pref = useSettings((s) => s.motion)
  const reduced = pref === 'reduced' || (pref === 'auto' && Boolean(prefersReduced))
  const effects3d = !reduced && (pref === 'full' || !lowPerformance())
  return { reduced, effects3d }
}
