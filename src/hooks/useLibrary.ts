import { useDb } from './useDb'
import { listBooks, narrationCounts } from '@/lib/db'

export function useLibrary() {
  const { data: books, loading } = useDb(listBooks, [])
  const { data: counts } = useDb(narrationCounts, [])
  return { books: books ?? [], counts: counts ?? {}, loading }
}
