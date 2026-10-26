import { useEffect, useState } from 'react'

/** Object URL for a Blob that is revoked when the blob changes or the component unmounts. */
export function useObjectUrl(blob?: Blob | null) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}
