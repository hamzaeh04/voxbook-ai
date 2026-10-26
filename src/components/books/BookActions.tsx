import { BookOpen, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BatchPanel } from '../reader/BatchPanel'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { deleteBook, updateBook } from '@/lib/db'
import type { Book } from '@/lib/types'
import { pickVoice, useVoices } from '@/stores/voices'
import { useSettings } from '@/stores/settings'
import { toast } from '@/stores/toasts'
import { unloadPlayback } from '@/lib/playback'
import { usePlayback } from '@/stores/playback'

/** Per-book management dialog: continue, rename/edit, narration jobs & export, delete with confirmation. */
export function BookActions({ book, onClose }: { book?: Book; onClose: () => void }) {
  const navigate = useNavigate()
  const voices = useVoices((s) => s.voices)
  const globalVoice = useSettings((s) => s.preferredVoiceId)
  const [mode, setMode] = useState<'menu' | 'edit' | 'delete'>('menu')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  useEffect(() => {
    setMode('menu')
    setTitle(book?.title ?? '')
    setAuthor(book?.author ?? '')
  }, [book?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!book) return <Dialog open={false} onOpenChange={onClose} title="Book" />

  const voice = pickVoice(voices, book.preferredVoiceId ?? globalVoice)
  const remove = async () => {
    if (usePlayback.getState().bookId === book.id) unloadPlayback()
    await deleteBook(book.id)
    toast.success(`Removed “${book.title}” and its recordings.`)
    onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={mode === 'delete' ? 'Remove this book?' : mode === 'edit' ? 'Edit details' : book.title} description={mode === 'menu' ? book.author : undefined}>
      {mode === 'menu' && (
        <div className="mt-5 space-y-5">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => navigate(`/read/${book.id}`)}><BookOpen size={16} /> {book.readingProgress > 0 ? `Continue (${book.unit === 'chapter' ? 'chapter' : 'page'} ${book.lastReadPage})` : 'Open'}</Button>
            <Button onClick={() => setMode('edit')}><Pencil size={15} /> Rename / edit</Button>
            <Button variant="danger" onClick={() => setMode('delete')}><Trash2 size={15} /> Remove</Button>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Narration jobs</h3>
            <BatchPanel bookId={book.id} totalPages={book.totalPages} voice={voice} unit={book.unit} />
          </div>
        </div>
      )}
      {mode === 'edit' && (
        <form className="mt-5 space-y-4" onSubmit={async (e) => { e.preventDefault(); await updateBook(book.id, { title: title.trim() || book.title, author: author.trim() || book.author }); toast.success('Details updated.'); onClose() }}>
          <label className="block text-sm">Title<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="mt-1 h-10 w-full rounded-xl border border-line bg-raised px-3" /></label>
          <label className="block text-sm">Author<input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} className="mt-1 h-10 w-full rounded-xl border border-line bg-raised px-3" /></label>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMode('menu')}>Back</Button><Button type="submit" variant="primary">Save</Button></div>
        </form>
      )}
      {mode === 'delete' && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted">“{book.title}”, its reading progress, bookmarks and every saved page recording will be permanently deleted from this device. Exported files are not affected.</p>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setMode('menu')}>Keep book</Button><Button variant="danger" onClick={() => void remove()}>Delete permanently</Button></div>
        </div>
      )}
    </Dialog>
  )
}
