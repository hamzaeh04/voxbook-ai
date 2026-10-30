import { create } from 'zustand'
import type { NarrationStyle } from '@shared/types'
import { ApiClientError } from '../api'
import { planPerformance } from './plan'
import type { WorkerMessage, WorkerRequest } from './kokoro.worker'

/** Version tag stored with Kokoro narration; bump when the delivery changes so old audio shows as outdated. */
export const KOKORO_ENGINE = 'kokoro:82m-v1.0:performance-v1'

interface KokoroState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  device?: 'webgpu' | 'wasm'
  /** 0..100 while the model downloads (first use only). */
  download?: number
  /** Generation progress of the current chapter. */
  task?: { key: string; done: number; total: number }
  error?: string
}

export const useKokoro = create<KokoroState>(() => ({ status: 'idle' }))

interface Pending {
  key: string
  resolve: (r: { blob: Blob; duration: number }) => void
  reject: (e: Error) => void
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

function getWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const m = e.data
    if (m.type === 'loading') useKokoro.setState({ status: 'loading', device: m.device, download: m.progress ?? useKokoro.getState().download })
    else if (m.type === 'ready') useKokoro.setState({ status: 'ready', device: m.device, download: undefined, error: undefined })
    else if (m.type === 'progress') {
      const p = pending.get(m.id)
      if (p) useKokoro.setState({ task: { key: p.key, done: m.done, total: m.total } })
    } else if (m.type === 'done') {
      const p = pending.get(m.id)
      pending.delete(m.id)
      useKokoro.setState({ task: undefined })
      p?.resolve({ blob: new Blob([m.mp3], { type: 'audio/mpeg' }), duration: m.duration })
    } else if (m.type === 'error') {
      const p = pending.get(m.id)
      pending.delete(m.id)
      useKokoro.setState({ task: undefined })
      if (m.message === 'cancelled') p?.reject(new ApiClientError('aborted', 'Generation cancelled.'))
      else {
        if (useKokoro.getState().status === 'loading') useKokoro.setState({ status: 'error', error: m.message })
        p?.reject(new Error(`On-device voice failed: ${m.message}`))
      }
    }
  }
  worker.onerror = (e) => {
    const message = e.message || 'The on-device voice engine crashed (it may be out of memory).'
    useKokoro.setState({ status: 'error', error: message, task: undefined })
    for (const p of pending.values()) p.reject(new Error(message))
    pending.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/** Generate narration on this device with a Kokoro voice. Emotion = per-sentence pace, loudness and pauses. */
export function generateKokoro(text: string, voiceId: string, style: NarrationStyle, opts: { key: string; signal?: AbortSignal }): Promise<{ blob: Blob; duration: number }> {
  const pieces = planPerformance(text, style)
  if (!pieces.length) return Promise.reject(new Error('Nothing to narrate.'))
  const id = nextId++
  const w = getWorker()
  return new Promise((resolve, reject) => {
    pending.set(id, { key: opts.key, resolve, reject })
    opts.signal?.addEventListener('abort', () => w.postMessage({ type: 'cancel', id } satisfies WorkerRequest), { once: true })
    useKokoro.setState({ task: { key: opts.key, done: 0, total: pieces.length } })
    w.postMessage({ type: 'generate', id, pieces, voice: voiceId.replace(/^kokoro:/, '') } satisfies WorkerRequest)
  })
}
