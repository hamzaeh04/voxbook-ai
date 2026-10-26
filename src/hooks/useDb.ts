import { useEffect, useRef, useState } from 'react'
import { subscribeDb } from '@/lib/db'

/** Live query: re-runs `query` on mount, when deps change and after any DB write. */
export function useDb<T>(query: () => Promise<T>, deps: unknown[] = [], initial?: T) {
  const [data, setData] = useState<T | undefined>(initial)
  const [loading, setLoading] = useState(true)
  const queryRef = useRef(query)
  queryRef.current = query

  useEffect(() => {
    let alive = true
    let seq = 0
    const run = () => {
      const mine = ++seq
      queryRef.current().then(
        (v) => {
          if (alive && mine === seq) {
            setData(v)
            setLoading(false)
          }
        },
        (e) => {
          console.error('[db] query failed', e)
          if (alive) setLoading(false)
        },
      )
    }
    run()
    const unsub = subscribeDb(run)
    return () => {
      alive = false
      unsub()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { data, loading }
}
