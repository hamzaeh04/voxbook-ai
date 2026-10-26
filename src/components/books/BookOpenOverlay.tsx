import { AnimatePresence, motion } from 'framer-motion'
import { useBookOpen } from '@/stores/bookOpen'

/** Cover swings open from its left spine while the book grows to fill the viewport. */
export function BookOpenOverlay() {
  const { opening, end } = useBookOpen()
  return (
    <AnimatePresence>
      {opening && (
        <motion.div
          key={opening.id}
          aria-hidden="true"
          className="pointer-events-none fixed z-[70] overflow-hidden bg-bg"
          style={{ perspective: 1600, left: opening.rect.x, top: opening.rect.y, width: opening.rect.w, height: opening.rect.h, borderRadius: 8 }}
          animate={{ left: 0, top: 0, width: '100vw', height: '100dvh', borderRadius: 0, opacity: [1, 1, 0] }}
          transition={{ duration: 0.75, times: [0, 0.72, 1], ease: [0.32, 0.72, 0.24, 1] }}
          onAnimationComplete={end}
        >
          <div className="absolute inset-0 bg-surface" />
          <motion.div
            className="absolute inset-0"
            style={{
              transformOrigin: 'left center',
              backfaceVisibility: 'hidden',
              background: opening.coverUrl ? `center/cover url(${opening.coverUrl})` : `linear-gradient(155deg, hsl(${opening.hue} 45% 28%), hsl(${(opening.hue + 50) % 360} 50% 14%))`,
            }}
            initial={{ rotateY: 0 }}
            animate={{ rotateY: -112 }}
            transition={{ duration: 0.55, delay: 0.05, ease: [0.4, 0, 0.2, 1] }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
