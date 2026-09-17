import { useEffect, useState } from 'react'

const listeners = new Set<() => void>()

/**
 * Where a project is edited: /project/<id>/<floorId>?s=<selection>. The URL is the project,
 * the floor you are on and what you have selected, so any of it can be linked to.
 */
export const projectPath = (id: string, floorId?: string, selection?: { kind: string; id: string }[]) => {
  const sel = selection && selection.length > 0 ? `?s=${encodeURIComponent(selection.map((s) => `${s.kind}:${s.id}`).join(','))}` : ''
  return `/project/${id}${floorId ? `/${floorId}` : ''}${sel}`
}

/** the selection encoded in a search string, if any */
export function parseSelection(search: string): { kind: string; id: string }[] {
  const raw = new URLSearchParams(search).get('s')
  if (!raw) return []
  return raw
    .split(',')
    .map((part) => {
      const at = part.indexOf(':')
      return at > 0 ? { kind: part.slice(0, at), id: part.slice(at + 1) } : null
    })
    .filter((x): x is { kind: string; id: string } => !!x && !!x.id)
}

export function navigate(path: string, replace = false) {
  if (path === location.pathname + location.search) return
  if (replace) history.replaceState(null, '', path)
  else history.pushState(null, '', path)
  for (const l of listeners) l()
}

/** current pathname, re-rendering on navigation */
export function useRoute(): string {
  return useLocation().path
}

/** current pathname and search, re-rendering on navigation */
export function useLocation(): { path: string; search: string } {
  const [loc, setLoc] = useState({ path: location.pathname, search: location.search })
  useEffect(() => {
    const update = () => setLoc({ path: location.pathname, search: location.search })
    listeners.add(update)
    window.addEventListener('popstate', update)
    return () => {
      listeners.delete(update)
      window.removeEventListener('popstate', update)
    }
  }, [])
  return loc
}

/** intercept plain left clicks on internal links so they don't reload the app */
export function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  const href = e.currentTarget.getAttribute('href')
  if (!href || !href.startsWith('/') || href.startsWith('/auth/') || href.startsWith('/api/')) return
  e.preventDefault()
  navigate(href)
}
