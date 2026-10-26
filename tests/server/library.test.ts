import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { loadConfig } from '../../server/config.js'
import { createMockProvider } from '../../server/providers/mock.js'

const tmp = () => mkdtempSync(path.join(tmpdir(), 'vox-lib-'))
const setup = (env: Record<string, string> = {}) =>
  createApp(loadConfig({ TTS_PROVIDER: 'mock', CACHE_DIR: tmp(), LIBRARY_DIR: tmp(), ...env } as NodeJS.ProcessEnv), createMockProvider()).app

const ID = '7cd83aec-cd16-4934-b7a5-3105c62ea6da'
const meta = { title: 'The Book of Enoch', author: 'R. H. Charles', format: 'epub', unit: 'chapter', totalPages: 2, createdAt: 1, hasCover: true, chapterBundles: 1 }
const manifest = (version: string, parts = 2) => ({ voiceId: 'edge:en-US-GuyNeural', voiceName: 'Guy', style: 'expressive', engine: 'v2', format: 'mp3', duration: 12.5, size: 6, createdAt: 2, textHash: 'abc', parts, version })

describe('shared library', () => {
  it('stores a book (one chapter bundle), cover and narration for every visitor, then deletes it with a tombstone', async () => {
    const app = setup()
    expect((await request(app).get('/api/library').expect(200)).body).toMatchObject({ enabled: true, books: [], deleted: [] })

    await request(app).put(`/api/library/books/${ID}/bundles/0`).send({ chapters: [{ n: 1, title: 'I. Opening', text: 'Chapter one text.' }, { n: 2, title: 'II. Next', text: 'Chapter two text.' }] }).expect(200)
    await request(app).put(`/api/library/books/${ID}/cover`).set('Content-Type', 'image/jpeg').send(Buffer.from('JPEG')).expect(200)
    await request(app).put(`/api/library/books/${ID}`).send(meta).expect(200)

    const list = await request(app).get('/api/library').expect(200)
    expect(list.body.books).toEqual([expect.objectContaining({ id: ID, title: 'The Book of Enoch', totalPages: 2, unit: 'chapter', chapterBundles: 1 })])
    expect((await request(app).get(`/api/library/books/${ID}/bundles/0`).expect(200)).body.chapters[1]).toEqual({ n: 2, title: 'II. Next', text: 'Chapter two text.' })
    expect((await request(app).get(`/api/library/books/${ID}/cover`).expect(200)).body.toString()).toBe('JPEG')

    // audio: parts first, then the manifest publishes it
    await request(app).get(`/api/library/books/${ID}/narrations/1`).expect(404)
    await request(app).put(`/api/library/books/${ID}/narrations/1/parts/0?version=aaaaaa1`).set('Content-Type', 'application/octet-stream').send(Buffer.from('ID3')).expect(200)
    await request(app).put(`/api/library/books/${ID}/narrations/1/parts/1?version=aaaaaa1`).set('Content-Type', 'application/octet-stream').send(Buffer.from('xyz')).expect(200)
    await request(app).put(`/api/library/books/${ID}/narrations/1`).send(manifest('aaaaaa1')).expect(200)
    expect((await request(app).get(`/api/library/books/${ID}/narrations/1`).expect(200)).body).toMatchObject({ pageNumber: 1, version: 'aaaaaa1', parts: 2, voiceName: 'Guy' })
    const binary = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))) }
    expect((await request(app).get(`/api/library/books/${ID}/narrations/1/parts/0?version=aaaaaa1`).buffer(true).parse(binary).expect(200)).body.toString()).toBe('ID3')

    // regenerating replaces the old version's parts
    await request(app).put(`/api/library/books/${ID}/narrations/1/parts/0?version=bbbbbb2`).set('Content-Type', 'application/octet-stream').send(Buffer.from('NEW')).expect(200)
    await request(app).put(`/api/library/books/${ID}/narrations/1`).send(manifest('bbbbbb2', 1)).expect(200)
    await request(app).get(`/api/library/books/${ID}/narrations/1/parts/0?version=aaaaaa1`).expect(404)

    await request(app).delete(`/api/library/books/${ID}`).expect(200)
    const after = (await request(app).get('/api/library').expect(200)).body
    expect(after.books).toEqual([])
    expect(after.deleted).toEqual([ID]) // tombstone: other browsers remove their copies
    await request(app).get(`/api/library/books/${ID}/bundles/0`).expect(404)
  })

  it('refuses to publish narration whose parts have not all been uploaded', async () => {
    const app = setup()
    await request(app).put(`/api/library/books/${ID}/narrations/1/parts/0?version=cccccc3`).set('Content-Type', 'application/octet-stream').send(Buffer.from('a')).expect(200)
    const res = await request(app).put(`/api/library/books/${ID}/narrations/1`).send(manifest('cccccc3', 3)).expect(400)
    expect(res.body.error.message).toMatch(/1 of 3/)
  })

  it('validates ids, metadata and keys', async () => {
    const app = setup()
    await request(app).put('/api/library/books/not-a-uuid').send(meta).expect(400)
    await request(app).put(`/api/library/books/${ID}`).send({ ...meta, format: 'exe' }).expect(400)
    await request(app).put(`/api/library/books/${ID}`).send({ ...meta, chapterBundles: undefined }).expect(400)
    await request(app).put(`/api/library/books/${ID}/bundles/0`).send({ chapters: [{ n: 0, text: 'x' }] }).expect(400)
    await request(app).get(`/api/library/books/${ID}/narrations/1/parts/0?version=../../etc`).expect(400)
  })

  it('reports clearly when no shared storage is configured on a serverless host', async () => {
    const app = setup({ VERCEL: '1' })
    const res = await request(app).get('/api/library').expect(200)
    expect(res.body).toMatchObject({ enabled: false, books: [] })
    expect(res.body.reason).toMatch(/BLOB_READ_WRITE_TOKEN/)
    expect((await request(app).put(`/api/library/books/${ID}`).send(meta).expect(503)).body.error.code).toBe('not_configured')
  })
})

describe('blob token discovery', () => {
  it('accepts the default name and a custom-prefixed name, ignoring unrelated tokens', () => {
    expect(loadConfig({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abc_123' } as NodeJS.ProcessEnv).library.blobToken).toBe('vercel_blob_rw_abc_123')
    expect(loadConfig({ BOOKS_READ_WRITE_TOKEN: 'vercel_blob_rw_xyz_9' } as NodeJS.ProcessEnv).library.blobToken).toBe('vercel_blob_rw_xyz_9')
    expect(loadConfig({ OTHER_READ_WRITE_TOKEN: 'not-a-blob-token' } as NodeJS.ProcessEnv).library.blobToken).toBeUndefined()
  })
})
