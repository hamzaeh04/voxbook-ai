export type MicErrorCode = 'denied' | 'unsupported' | 'no_device' | 'failed'

export class MicError extends Error {
  constructor(
    public code: MicErrorCode,
    message: string,
  ) {
    super(message)
  }
}

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export const micSupported = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined'

/**
 * Captures a real person's voice. Permission is requested only when `start()` is
 * called (i.e. the user pressed Record). It never records the app's own playback.
 */
export class MicRecorder {
  private rec?: MediaRecorder
  private stream?: MediaStream
  private chunks: Blob[] = []
  private startedAt = 0

  async start() {
    if (!micSupported()) throw new MicError('unsupported', 'This browser does not support microphone recording.')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      const name = (e as DOMException).name
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('denied', 'Microphone access was denied. Allow it in your browser’s site settings to record.')
      if (name === 'NotFoundError') throw new MicError('no_device', 'No microphone was found.')
      throw new MicError('failed', 'The microphone could not be started.')
    }
    const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.rec.start(250)
    this.startedAt = performance.now()
  }

  get elapsed() {
    return this.rec ? (performance.now() - this.startedAt) / 1000 : 0
  }

  stop(): Promise<{ blob: Blob; mimeType: string; duration: number }> {
    return new Promise((resolve, reject) => {
      const rec = this.rec
      if (!rec) return reject(new MicError('failed', 'Not recording.'))
      const duration = this.elapsed
      rec.onstop = () => {
        this.release()
        const mimeType = rec.mimeType || 'audio/webm'
        resolve({ blob: new Blob(this.chunks, { type: mimeType }), mimeType, duration })
      }
      rec.stop()
    })
  }

  /** Abort without saving; always releases the microphone. */
  cancel() {
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop()
    this.release()
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = undefined
    this.rec = undefined
  }
}
