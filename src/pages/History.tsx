import { BookOpen, Headphones, History as HistoryIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/misc'
import { useDb } from '@/hooks/useDb'
import { clearHistory, listHistory } from '@/lib/db'

export default function History() {
  const { data } = useDb(() => listHistory(300), [])
  const days = new Map<string, NonNullable<typeof data>>()
  for (const h of data ?? []) {
    const k = new Date(h.at).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    days.set(k, [...(days.get(k) ?? []), h])
  }
  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reading History</h1>
          <p className="text-sm text-muted">Pages you read or listened to. Stored only on this device.</p>
        </div>
        {!!data?.length && <Button variant="ghost" onClick={() => void clearHistory()}>Clear history</Button>}
      </header>
      {data && !data.length ? (
        <EmptyState icon={<HistoryIcon size={26} />} title="No history yet" body="Chapters and pages appear here after you spend a few seconds reading or listening." />
      ) : (
        [...days].map(([day, entries]) => (
          <section key={day} aria-label={day}>
            <h2 className="mb-2 text-sm font-semibold text-muted">{day}</h2>
            <ul className="card divide-y divide-line">
              {entries.map((h) => (
                <li key={h.id}>
                  <Link to={`/read/${h.bookId}?page=${h.pageNumber}`} className="flex items-center gap-3 px-4 py-3 hover:bg-raised">
                    {h.kind === 'listen' ? <Headphones size={17} className="text-violet" aria-label="Listened" /> : <BookOpen size={17} className="text-amber" aria-label="Read" />}
                    <span className="min-w-0 flex-1 truncate text-sm">{h.bookTitle} <span className="text-muted">· #{h.pageNumber}</span></span>
                    <time className="text-xs text-muted" dateTime={new Date(h.at).toISOString()}>{new Date(h.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}
