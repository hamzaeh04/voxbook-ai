import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface CachedAudio {
  audio: Buffer
  format: 'mp3' | 'wav'
}

/** Disk cache for generated audio, keyed by content hash. Holds audio only, never book text. */
export class AudioCache {
  constructor(private dir: string) {}

  private file(id: string, format: string) {
    return path.join(this.dir, `${id}.${format}`)
  }

  async init() {
    await mkdir(this.dir, { recursive: true })
  }

  async put(id: string, entry: CachedAudio) {
    await this.init()
    await writeFile(this.file(id, entry.format), entry.audio)
  }

  async get(id: string): Promise<CachedAudio | null> {
    if (!/^[a-f0-9]{64}$/.test(id)) return null
    for (const format of ['mp3', 'wav'] as const) {
      try {
        return { audio: await readFile(this.file(id, format)), format }
      } catch {
        /* try next */
      }
    }
    return null
  }

  /** Delete audio older than the retention window. Returns number removed. */
  async purge(retentionHours: number): Promise<number> {
    let removed = 0
    try {
      const cutoff = Date.now() - retentionHours * 3600_000
      for (const name of await readdir(this.dir)) {
        const p = path.join(this.dir, name)
        if ((await stat(p)).mtimeMs < cutoff) {
          await unlink(p)
          removed++
        }
      }
    } catch {
      /* directory may not exist yet */
    }
    return removed
  }
}
