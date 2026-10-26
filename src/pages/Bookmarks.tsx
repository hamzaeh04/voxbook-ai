import { Bookmark, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/misc'
import { useDb } from '@/hooks/useDb'
import { listBookmarkedPages, listBooks, updatePage } from '@/lib/db'
import { markupToPlain, unitOf } from '@/lib/utils'

export default function Bookmarks() {
  const { data } = useDb(async () => ({ pages: await listBookmarkedPages(), books: await listBooks() }), [])
  const rows = (data?.pages ?? [])
    .map((p) => ({ p, book: data!.books.find((b) => b.id === p.bookId) }))
    .filter((r) => r.book)
    .sort((a, b) => a.book!.title.localeCompare(b.book!.title) || a.p.pageNumber - b.p.pageNumber)
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Bookmarks</h1>
        <p className="text-sm text-muted">Pages you marked while reading.</p>
      </header>
      {data && rows.length === 0 ? (
        <EmptyState icon={<Bookmark size={26} />} title="No bookmarks yet" body="Use the bookmark button in the reader to save a page for later." />
      ) : (
        <ul className="space-y-2.5">
          {rows.map(({ p, book }) => (
            <li key={p.id} className="card flex items-start gap-3 p-4">
              <Link to={`/read/${book!.id}?page=${p.pageNumber}`} className="min-w-0 flex-1 hover:text-amber">
                <p className="font-semibold">{book!.title} <span className="font-normal text-muted">· {unitOf(book).one} {p.pageNumber}{p.title ? `: ${p.title}` : ''}</span></p>
                <p className="mt-1 line-clamp-2 font-serif text-sm text-muted">{markupToPlain(p.extractedText).slice(0, 220) || 'No text'}</p>
              </Link>
              <Button size="icon-sm" variant="ghost" aria-label={`Remove bookmark on ${unitOf(book).one} ${p.pageNumber} of ${book!.title}`} onClick={() => void updatePage(p.id, { bookmarked: false })}><Trash2 size={16} /></Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
