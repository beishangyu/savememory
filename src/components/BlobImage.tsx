import { useEffect, useState } from 'react'
import { readAsDataUrl } from '../lib/image'

interface BlobImageProps {
  blob: Blob
  alt: string
  className?: string
}

/** Renders a stored Blob as an image, without leaking object URLs. */
export function BlobImage({ blob, alt, className }: BlobImageProps) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    let cancelled = false
    void readAsDataUrl(blob)
      .then((dataUrl) => {
        if (!cancelled) setUrl(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setUrl('')
      })
    return () => {
      cancelled = true
    }
  }, [blob])

  if (!url) return null
  return <img className={className} src={url} alt={alt} />
}
