/** Determine an audio blob's duration in seconds. */
export async function readDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob)
  try {
    const viaElement = await new Promise<number>((resolve) => {
      const a = new Audio()
      a.preload = 'metadata'
      const done = (v: number) => {
        a.removeAttribute('src')
        a.load()
        resolve(v)
      }
      a.onloadedmetadata = () => {
        if (Number.isFinite(a.duration) && a.duration > 0) return done(a.duration)
        // Some concatenated MP3s report Infinity until seeked to the end.
        a.currentTime = 1e101
        a.ontimeupdate = () => {
          a.ontimeupdate = null
          done(Number.isFinite(a.duration) ? a.duration : 0)
        }
      }
      a.onerror = () => done(0)
      setTimeout(() => done(0), 8000)
      a.src = url
    })
    if (viaElement > 0) return viaElement
  } finally {
    URL.revokeObjectURL(url)
  }
  try {
    const ctx = new AudioContext()
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    void ctx.close()
    return buf.duration
  } catch {
    return 0
  }
}
