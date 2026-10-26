/** Split text into chunks <= max chars, preferring paragraph then sentence boundaries. */
export function splitForTts(text: string, max: number): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (clean.length <= max) return clean ? [clean] : []
  const chunks: string[] = []
  let current = ''
  const push = () => {
    if (current.trim()) chunks.push(current.trim())
    current = ''
  }
  const pieces = clean.split(/\n{2,}/).flatMap((para) => {
    if (para.length <= max) return [para]
    // sentence split, keeping terminators
    const sentences = para.match(/[^.!?。！？]+[.!?。！？]+["')\]]*\s*|[^.!?。！？]+$/g) ?? [para]
    return sentences.flatMap((s) => (s.length <= max ? [s] : s.match(new RegExp(`.{1,${max}}`, 'gs')) ?? [s]))
  })
  for (const piece of pieces) {
    const joined = current ? `${current}\n\n${piece}` : piece
    if (joined.length > max) {
      push()
      current = piece
    } else current = joined
  }
  push()
  return chunks
}
