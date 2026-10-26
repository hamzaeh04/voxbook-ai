import type { ProviderInfo, VoiceInfo } from '@shared/types'
import { buildBookRecords } from '@/lib/documents'
import { resetDbForTests, saveImportedBook } from '@/lib/db'
import { useVoices } from '@/stores/voices'

export const voiceA: VoiceInfo = { id: 'mock:deep', provider: 'mock', providerVoiceId: 'deep', displayName: 'Deep', description: '', language: 'en', characteristics: [], persona: 'heavy-male', supportedSettings: { style: true, pitch: false, speed: false } }
export const voiceB: VoiceInfo = { ...voiceA, id: 'mock:warm', displayName: 'Warm', persona: 'warm-female' }

export const provider: ProviderInfo = { id: 'mock', label: 'Mock', external: false, configured: true, isMock: true, audioFormat: 'wav', maxCharsPerRequest: 1000, retentionNote: '', authRequired: false }

export async function freshLibrary(pages = ['Page one text.', 'Page two text.', 'Page three text.'], title = 'My Great Book!') {
  await resetDbForTests()
  useVoices.setState({ provider, voices: [voiceA, voiceB], status: 'ready' })
  const { book, pages: records } = buildBookRecords('book1', { name: 'x.txt', size: 1 }, 'txt', { title, pages })
  await saveImportedBook(book, records)
  return book
}

export const audio = (tag: string, type = 'audio/wav') => ({ blob: new Blob([tag], { type }), narrationId: `srv-${tag}`, format: (type.includes('mpeg') ? 'mp3' : 'wav') as 'mp3' | 'wav', cached: false })
