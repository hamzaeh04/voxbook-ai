import { useEffect, useState } from 'react'
import { subscribeDb } from '@/lib/db'

export interface StorageInfo {
  usage: number
  quota: number
  ratio: number
}

export function useStorage(): StorageInfo | null {
  const [info, setInfo] = useState<StorageInfo | null>(null)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const e = await navigator.storage?.estimate?.()
        if (e?.quota) setInfo({ usage: e.usage ?? 0, quota: e.quota, ratio: (e.usage ?? 0) / e.quota })
      } catch {
        /* unsupported */
      }
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(read, 800)
    }
    void read()
    const unsub = subscribeDb(schedule)
    return () => (clearTimeout(timer), unsub())
  }, [])
  return info
}
