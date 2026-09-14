import { useEffect, useState } from 'react'

const listeners = new Set<() => void>()

export function navigate(path: string, replace = false) {
  if (path === location.pathname + location.search) return
  if (replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  for (const l of listeners) l()
}

/** current pathname, re-rendering on navigation */
export function useRoute(): string {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const update = () => setPath(location.pathname)
    listeners.add(update)
    window.addEventListener('popstate', update)
    return () => {
      listeners.delete(update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return path
}

/** intercept plain left clicks on internal links so they don't reload the app */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const href = e.currentTarget.getAttribute('href')
  if (!href || !href.startsWith('/') || href.startsWith('/auth/') || href.startsWith('/api/')) return
  e.preventDefault()
  navigate(href)
}
