import { BookOpen } from 'lucide-react'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import type { Book } from '@/lib/types'
import { hashText } from '@/lib/utils'

export const coverHue = (title: string) => parseInt(hashText(title).slice(0, 4), 36) % 360

/** Real cover if the document has one, otherwise a generated typographic cover. */
export function Cover({ book, className = '' }: { book: Pick<Book, 'title' | 'author' | 'cover'>; className?: string }) {
  const url = useObjectUrl(book.cover)
  const hue = coverHue(book.title)
  if (url) return <img src={url} alt={`Cover of ${book.title}`} loading="lazy" decoding="async" draggable={false} className={`h-full w-full object-cover ${className}`} />
  return (
    <div
      className={`flex h-full w-full flex-col justify-between p-4 text-left ${className}`}
      style={{ background: `linear-gradient(155deg, hsl(${hue} 45% 28%), hsl(${(hue + 50) % 360} 50% 14%))` }}
    >
      <BookOpen size={18} className="text-white/60" aria-hidden="true" />
      <div>
        <p className="line-clamp-4 font-serif text-lg font-semibold leading-tight text-white">{book.title}</p>
        <p className="mt-2 line-clamp-2 text-xs text-white/70">{book.author}</p>
      </div>
    </div>
  )
}
