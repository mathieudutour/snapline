import { useEffect, useRef, useState } from 'react'
import { useEditor, type SyncStatus } from '../model/store'
import { signInUrl } from '../sync/api'
import { GoogleMark } from '../pages/Login'

const SYNC_LABEL: Record<SyncStatus, string> = { offline: 'Local only', idle: 'Signed in', syncing: 'Saving…', synced: 'Saved to your account', error: 'Sync failed, retrying on next change' }

export function AccountButton() {
  const user = useEditor((s) => s.user)
  const apiAvailable = useEditor((s) => s.apiAvailable)
  const syncStatus = useEditor((s) => s.syncStatus)
  const signOut = useEditor((s) => s.signOut)
  const syncNow = useEditor((s) => s.syncNow)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  if (user === undefined || apiAvailable === false) return null
  if (!user) {
    return (
      <a className="button signin" href={signInUrl('/')} title="Sign in to save projects to your account">
        <GoogleMark /> Sign in
      </a>
    )
  }
  return (
    <div className="popover-anchor" ref={ref}>
      <button className={`account ${syncStatus}`} onClick={() => setOpen((o) => !o)} title={SYNC_LABEL[syncStatus]}>
        {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
        <span className={`dot ${syncStatus}`} />
      </button>
      {open && (
        <div className="menu right">
          <div className="menu-title">{user.email}</div>
          <div className="menu-item muted">{SYNC_LABEL[syncStatus]}</div>
          <button className="menu-item" onClick={() => (syncNow(), setOpen(false))}>
            Sync now
          </button>
          <div className="menu-sep" />
          <button className="menu-item" onClick={() => (signOut(), setOpen(false))}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
