import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import { getNarration, listNarrations, putNarration } from '@/lib/db'
import { buildBookZip, narrationFile } from '@/lib/export'
import type { Narration } from '@/lib/types'
import { narrationFileName, safeFileStem } from '@/lib/utils'
import { freshLibrary } from './helpers'

const narration = (page: number, format: 'mp3' | 'wav', body: string): Narration => ({
  id: `book1:${page}`, bookId: 'book1', pageId: `book1:${page}`, pageNumber: page, voiceId: 'mock:deep', voiceName: 'Deep',
  voiceSettings: { style: 'neutral' }, audioBlob: new Blob([body]), audioFormat: format, duration: 3, size: body.length, createdAt: 1_700_000_000_000 + page, status: 'ready', textHash: 'h',
})

describe('file naming', () => {
  it('uses Book_Title_Page_001.ext with the real format', () => {
    expect(narrationFileName('My Great Book!', 1, 'mp3', 12)).toBe('My_Great_Book_Page_001.mp3')
    expect(narrationFileName('Café: Ünïcode', 42, 'wav', 12)).toBe('Cafe_Unicode_Page_042.wav')
    expect(narrationFileName('Long', 7, 'mp3', 12345)).toBe('Long_Page_00007.mp3')
    expect(safeFileStem('///')).toBe('Book')
  })
})

describe('ZIP export', () => {
  beforeEach(async () => {
    await freshLibrary(['one', 'two', 'three', 'four'])
  })

  it('contains one correctly named file per recorded page, original bytes and a manifest', async () => {
    await putNarration(narration(1, 'wav', 'WAV-1'))
    await putNarration(narration(3, 'wav', 'WAV-3'))
    const { blob, count, fileName } = await buildBookZip('book1')
    expect(count).toBe(2)
    expect(fileName).toBe('My_Great_Book_Narration.zip')
    const zip = await JSZip.loadAsync(await new Response(blob).arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['My_Great_Book_Page_001.wav', 'My_Great_Book_Page_003.wav', 'manifest.json'])
    expect(await zip.file('My_Great_Book_Page_003.wav')!.async('string')).toBe('WAV-3')
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
    expect(manifest.recordings.map((r: { page: number; file: string }) => [r.page, r.file])).toEqual([[1, 'My_Great_Book_Page_001.wav'], [3, 'My_Great_Book_Page_003.wav']])
  })

  it('never relabels audio: extension follows the stored format (mp3 stays mp3, wav stays wav)', async () => {
    await putNarration(narration(1, 'mp3', 'ID3'))
    await putNarration(narration(2, 'wav', 'RIFF'))
    const zip = await JSZip.loadAsync(await new Response((await buildBookZip('book1')).blob).arrayBuffer())
    expect(zip.file('My_Great_Book_Page_001.mp3')).toBeTruthy()
    expect(zip.file('My_Great_Book_Page_002.wav')).toBeTruthy()
    expect(zip.file('My_Great_Book_Page_002.mp3')).toBeNull()
  })

  it('can export a subset of pages', async () => {
    for (const p of [1, 2, 3]) await putNarration(narration(p, 'mp3', `a${p}`))
    const { count, blob } = await buildBookZip('book1', { pages: [2] })
    expect(count).toBe(1)
    const zip = await JSZip.loadAsync(await new Response(blob).arrayBuffer())
    expect(Object.keys(zip.files)).toContain('My_Great_Book_Page_002.mp3')
    expect(Object.keys(zip.files)).not.toContain('My_Great_Book_Page_001.mp3')
  })

  it('fails clearly when nothing has been recorded', async () => {
    await expect(buildBookZip('book1')).rejects.toThrow(/no completed page recordings/i)
  })

  it('resuming an interrupted batch only needs the missing pages', async () => {
    const { pagesNeedingAudio } = await import('@/lib/batch')
    await putNarration({ ...narration(1, 'wav', 'x'), textHash: (await import('@/lib/utils')).hashText('one') })
    const todo = await pagesNeedingAudio('book1', 'mock:deep', { style: 'neutral' })
    expect(todo.map((t) => t.pageNumber)).toEqual([2, 3, 4])
    // a different voice invalidates everything
    expect((await pagesNeedingAudio('book1', 'mock:warm', { style: 'neutral' })).map((t) => t.pageNumber)).toEqual([1, 2, 3, 4])
    expect(narrationFile({ title: 'T', totalPages: 4 }, { pageNumber: 2, audioFormat: 'mp3' })).toBe('T_Page_002.mp3')
    expect(await getNarration('book1', 1)).toBeTruthy()
    expect(await listNarrations('book1')).toHaveLength(1)
  })
})
