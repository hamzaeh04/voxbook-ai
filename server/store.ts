import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Minimal key/value object storage behind the shared library. Keys look like `books/<id>/meta.json`. */
export interface ObjectStore {
  readonly kind: 'vercel-blob' | 'filesystem'
  put(key: string, body: Buffer | string, contentType: string): Promise<void>
  get(key: string): Promise<Buffer | null>
  /** All keys under a prefix. */
  list(prefix: string): Promise<string[]>
  delete(keys: string[]): Promise<void>
}

const SAFE_KEY = /^[A-Za-z0-9._/-]+$/
function check(key: string) {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.startsWith('/')) throw new Error(`Invalid storage key: ${key}`)
}

/** Local development: a folder on disk. */
export class FsStore implements ObjectStore {
  readonly kind = 'filesystem'
  constructor(private root: string) {}

  private file(key: string) {
    check(key)
    return path.join(this.root, key)
  }

  async put(key: string, body: Buffer | string) {
    const file = this.file(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, body)
  }

  async get(key: string) {
    try {
      return await readFile(this.file(key))
    } catch {
      return null
    }
  }

  async list(prefix: string) {
    check(prefix)
    const out: string[] = []
    const walk = async (dir: string) => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) await walk(full)
        else out.push(path.relative(this.root, full).split(path.sep).join('/'))
      }
    }
    await walk(path.join(this.root, prefix))
    return out.filter((k) => k.startsWith(prefix)).sort()
  }

  async delete(keys: string[]) {
    await Promise.all(keys.map((k) => rm(this.file(k), { force: true })))
  }
}

/** Vercel: Blob storage (needs BLOB_READ_WRITE_TOKEN, added when a Blob store is connected to the project). */
export class VercelBlobStore implements ObjectStore {
  readonly kind = 'vercel-blob'
  constructor(
    private token: string,
    private access: 'public' | 'private',
  ) {}

  async put(key: string, body: Buffer | string, contentType: string) {
    check(key)
    const { put } = await import('@vercel/blob')
    await put(key, body, { access: this.access, token: this.token, contentType, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 })
  }

  async get(key: string) {
    check(key)
    const { get } = await import('@vercel/blob')
    // useCache: false so an overwritten object (e.g. a renamed book) is never served stale.
    const res = await get(key, { access: this.access, token: this.token, useCache: false })
    if (!res || res.statusCode !== 200 || !res.stream) return null
    return Buffer.from(await new Response(res.stream).arrayBuffer())
  }

  async list(prefix: string) {
    check(prefix)
    const { list } = await import('@vercel/blob')
    const keys: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({ prefix, cursor, limit: 1000, token: this.token })
      keys.push(...page.blobs.map((b) => b.pathname))
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return keys.sort()
  }

  async delete(keys: string[]) {
    if (!keys.length) return
    const { del } = await import('@vercel/blob')
    for (let i = 0; i < keys.length; i += 500) await del(keys.slice(i, i + 500), { token: this.token })
  }
}
