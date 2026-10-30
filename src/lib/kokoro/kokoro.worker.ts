/// <reference lib="webworker" />
/**
 * Kokoro text-to-speech, running entirely in this browser (Web Worker). The model (~90 MB on CPU,
 * ~310 MB for GPU) downloads once from Hugging Face and is cached by the browser.
 */
import { KokoroTTS } from 'kokoro-js'
import { Mp3Encoder } from '@breezystack/lamejs'
import type { Piece } from './plan'

export type WorkerRequest = { type: 'generate'; id: number; pieces: Piece[]; voice: string } | { type: 'cancel'; id: number }

export type WorkerMessage =
  | { type: 'loading'; progress?: number; file?: string; device: Device }
  | { type: 'ready'; device: Device }
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'done'; id: number; mp3: ArrayBuffer; duration: number }
  | { type: 'error'; id: number; message: string }

type Device = 'webgpu' | 'wasm'

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'
const SAMPLE_RATE = 24_000
const MP3_KBPS = 48

const post = (m: WorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

let tts: Promise<KokoroTTS> | null = null
let device: Device = 'wasm'
const cancelled = new Set<number>()

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
    return Boolean(gpu && (await gpu.requestAdapter()))
  } catch {
    return false
  }
}

function load(): Promise<KokoroTTS> {
  tts ??= (async () => {
    device = (await hasWebGpu()) ? 'webgpu' : 'wasm'
    post({ type: 'loading', device })
    const progress_callback = (p: { status?: string; file?: string; progress?: number }) => {
      if (p.status === 'progress' && p.file?.endsWith('.onnx')) post({ type: 'loading', progress: p.progress, file: p.file, device })
    }
    // GPU runs the full-precision model; CPU uses the smaller 8-bit one, which is much faster there.
    const model = await KokoroTTS.from_pretrained(MODEL, { dtype: device === 'webgpu' ? 'fp32' : 'q8', device, progress_callback })
    post({ type: 'ready', device })
    return model
  })().catch((e) => {
    tts = null
    throw e
  })
  return tts
}

function encodeMp3(samples: Float32Array): ArrayBuffer {
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, MP3_KBPS)
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767)))
  const chunks: Uint8Array[] = []
  for (let i = 0; i < pcm.length; i += 1152 * 64) {
    const out = encoder.encodeBuffer(pcm.subarray(i, i + 1152 * 64))
    if (out.length) chunks.push(new Uint8Array(out))
  }
  const tail = encoder.flush()
  if (tail.length) chunks.push(new Uint8Array(tail))
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const mp3 = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) mp3.set(c, offset), (offset += c.length)
  return mp3.buffer
}

async function generate(id: number, pieces: Piece[], voice: string) {
  const model = await load()
  const segments: Float32Array[] = []
  let length = 0
  for (const [i, piece] of pieces.entries()) {
    if (cancelled.has(id)) throw new Error('cancelled')
    const audio = await model.generate(piece.text, { voice: voice as never, speed: piece.speed })
    const samples = audio.audio as Float32Array
    const shaped = new Float32Array(samples.length)
    for (let s = 0; s < samples.length; s++) shaped[s] = samples[s] * piece.gain
    const silence = new Float32Array(Math.round((piece.pauseMs / 1000) * SAMPLE_RATE))
    segments.push(shaped, silence)
    length += shaped.length + silence.length
    post({ type: 'progress', id, done: i + 1, total: pieces.length })
  }
  const all = new Float32Array(length)
  let offset = 0
  for (const seg of segments) all.set(seg, offset), (offset += seg.length)
  // Loud moods can push samples past full scale: bring the whole chapter down rather than clip.
  let peak = 0
  for (let s = 0; s < all.length; s++) peak = Math.max(peak, Math.abs(all[s]))
  if (peak > 0.97) for (let s = 0; s < all.length; s++) all[s] *= 0.97 / peak
  const mp3 = encodeMp3(all)
  post({ type: 'done', id, mp3, duration: all.length / SAMPLE_RATE }, [mp3])
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'cancel') return void cancelled.add(msg.id)
  generate(msg.id, msg.pieces, msg.voice)
    .catch((err: unknown) => post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) }))
    .finally(() => cancelled.delete(msg.id))
}
