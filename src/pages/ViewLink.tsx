import { useEffect, useState } from 'react'
import { EditorApp } from '../App'
import { useEditor } from '../model/store'
import { onLinkClick } from '../router'

/** /view/<token>: the editor in read-only mode on a project shared by link; works without an account */
export function ViewLinkPage({ token }: { token: string }) {
  const openViewLink = useEditor((s) => s.openViewLink)
  const closeViewLink = useEditor((s) => s.closeViewLink)
  const ready = useEditor((s) => s.viewLink?.token === token)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setError(null)
    openViewLink(token).catch((e) => setError((e as { status?: number }).status === 404 ? 'This link is not valid any more. Ask the owner for a new one.' : 'Could not load this project. Check your connection and try again.'))
    return () => closeViewLink()
  }, [token, openViewLink, closeViewLink])
  if (error)
    return (
      <div className="loading">
        <div>
          <p>{error}</p>
          <a className="button" href="/home" onClick={onLinkClick}>
            Go to Snapline
          </a>
        </div>
      </div>
    )
  if (!ready) return <div className="loading">Loading…</div>
  return <EditorApp />
}
