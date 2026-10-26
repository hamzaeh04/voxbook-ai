/**
 * Single shared <audio> element plus a lazily created Web Audio graph
 * (MediaElementSource -> AnalyserNode -> destination) used by the waveform and orb.
 * Everything is created on first play (a user gesture) and torn down on dispose.
 */
export class AudioEngine {
  readonly el: HTMLAudioElement
  private ctx?: AudioContext
  private analyser?: AnalyserNode
  private source?: MediaElementAudioSourceNode
  private url?: string
  private freq?: Uint8Array<ArrayBuffer>
  /** True while a Voice Studio preview owns the element; page-playback listeners ignore events. */
  previewing = false

  constructor() {
    this.el = new Audio()
    this.el.preload = 'auto'
    this.el.preservesPitch = true
  }

  private ensureGraph() {
    if (this.ctx) return
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctx()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 128
      this.analyser.smoothingTimeConstant = 0.78
      this.source = this.ctx.createMediaElementSource(this.el)
      this.source.connect(this.analyser)
      this.analyser.connect(this.ctx.destination)
      this.freq = new Uint8Array(this.analyser.frequencyBinCount)
    } catch {
      // Analyser unavailable: audio still plays through the element; visuals fall back to idle/approximate.
      this.ctx = undefined
      this.analyser = undefined
    }
  }

  load(blob: Blob) {
    this.revoke()
    this.url = URL.createObjectURL(blob)
    this.el.src = this.url
    this.el.load()
  }

  get hasSource() {
    return Boolean(this.url)
  }

  async play() {
    this.ensureGraph()
    if (this.ctx?.state === 'suspended') await this.ctx.resume().catch(() => undefined)
    await this.el.play()
  }

  pause() {
    this.el.pause()
  }

  stop() {
    this.el.pause()
    if (this.url) this.el.currentTime = 0
  }

  seek(t: number) {
    if (Number.isFinite(t)) this.el.currentTime = Math.max(0, t)
  }

  unload() {
    this.el.pause()
    this.revoke()
    this.el.removeAttribute('src')
    this.el.load()
  }

  private revoke() {
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = undefined
  }

  /** True when real frequency data is available (the graph exists and audio is flowing). */
  get reactive() {
    return Boolean(this.analyser) && !this.el.paused
  }

  /** Fills and returns frequency bins (0-255), or null when no analyser exists. */
  frequencyData(): Uint8Array | null {
    if (!this.analyser || !this.freq) return null
    this.analyser.getByteFrequencyData(this.freq)
    return this.freq
  }

  /** Average amplitude 0..1 of the current frame. */
  level(): number {
    const d = this.frequencyData()
    if (!d) return 0
    let sum = 0
    for (let i = 0; i < d.length; i++) sum += d[i]
    return sum / d.length / 255
  }

  dispose() {
    this.unload()
    void this.ctx?.close()
    this.ctx = undefined
    this.analyser = undefined
  }
}

let engine: AudioEngine | null = null
export const getEngine = () => (engine ??= new AudioEngine())
