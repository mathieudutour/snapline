import { useEffect, useState } from 'react'

/** true while the media query matches (re-renders on change) */
export function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const update = () => setMatches(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [query])
  return matches
}

export const MOBILE_QUERY = '(max-width: 900px)'
export const COARSE_POINTER_QUERY = '(pointer: coarse)'
