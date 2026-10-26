import { describe, expect, it } from 'vitest'
import { buildSsml, emotionalSegments, moodOf } from '../../server/emotion'
import { groupSegments } from '../../server/providers/edge'

describe('emotion engine', () => {
  it.each([
    ['And the earth mourned, and the children of men wept.', 'somber'],
    ['Rise up, and go forth!', 'excited'],
    ['Who shall stand in the day of judgement?', 'questioning'],
    ['They trembled with fear.', 'fearful'],
    ['But the righteous shall rejoice in the light.', 'joyful'],
    ['His wrath shall consume them!', 'angry'],
    ['“Come here,” she said.', 'dialogue'],
    ['The road went north.', 'neutral'],
  ])('%s → %s', (sentence, mood) => expect(moodOf(sentence)).toBe(mood))

  it('merges consecutive sentences with the same delivery and scales intensity', () => {
    const segs = emotionalSegments('The road went north. The hills were green. Run! Who is there?', 1)
    expect(segs.map((s) => s.mood)).toEqual(['neutral', 'excited', 'questioning'])
    expect(segs[0].text).toBe('The road went north. The hills were green.')
    const dramatic = emotionalSegments('Run!', 1.6)[0].prosody
    expect(dramatic.pitch).toBeGreaterThan(emotionalSegments('Run!', 1)[0].prosody.pitch)
  })

  it('treats short unpunctuated paragraphs as headings', () => {
    expect(emotionalSegments('CHAPTER ONE\n\nIt began.', 1)[0].mood).toBe('heading')
  })

  it('produces SSML with only sibling <prosody> elements and escaped text', () => {
    const ssml = buildSsml('en-US-GuyNeural', emotionalSegments('Tom & Jerry <ran>! Then they rested.', 1))
    expect(ssml).toContain('Tom &amp; Jerry &lt;ran&gt;!')
    expect(ssml).not.toMatch(/<prosody[^>]*>[^<]*<prosody/) // never nested
    expect(ssml).not.toContain('<break')
    expect(ssml).not.toContain('express-as')
  })

  it('groups segments into service-sized requests (≤ 2 prosody elements, ≤ 2000 chars), preserving order', () => {
    const text = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? `Sentence ${i} is calm. ` : i % 3 === 1 ? `Sentence ${i} runs fast! ` : `Is sentence ${i} a question? `)).join('')
    const groups = groupSegments(emotionalSegments(text, 1))
    expect(groups.every((g) => g.length <= 2 && g.reduce((n, s) => n + s.text.length, 0) <= 2000)).toBe(true)
    expect(groups.flat().map((s) => s.text).join(' ').replace(/\s+/g, ' ')).toBe(text.trim())
    const long = groupSegments([{ text: 'A calm line. '.repeat(400), mood: 'neutral', prosody: { rate: 0, pitch: 0, volume: 0 } }])
    expect(long.length).toBeGreaterThan(2)
    expect(long.every((g) => g[0].text.length <= 2000)).toBe(true)
  })
})

describe('voice identity', () => {
  it('never shifts pitch more than a few percent, at any intensity, so it stays one speaker', async () => {
    const { MAX_PITCH_SHIFT } = await import('../../server/emotion')
    const text = 'They wept in sorrow. Rise up and fight! Who goes there? We rejoice with joy! His wrath burns! “Come,” she said.'
    for (const intensity of [1, 1.6]) {
      for (const s of emotionalSegments(text, intensity)) expect(Math.abs(s.prosody.pitch)).toBeLessThanOrEqual(MAX_PITCH_SHIFT)
    }
  })

  it('smooths a lone neutral sentence between two of the same mood', () => {
    const segs = emotionalSegments('They wept in sorrow. The road went north. The dead were mourned.', 1)
    expect(segs).toHaveLength(1)
    expect(segs[0].mood).toBe('somber')
  })
})
