import { useState } from 'react'
import { personLabel, useEditor, type ConflictChoice } from '../model/store'

/**
 * Shown when the account copy of a project moved on while this device had unsaved edits.
 * There is no live collaboration, so the user picks which version wins (or keeps both).
 */
export function ConflictDialog() {
  const conflict = useEditor((s) => s.conflicts[0])
  const hidden = useEditor((s) => s.conflictHidden)
  const setHidden = useEditor((s) => s.setConflictHidden)
  const resolve = useEditor((s) => s.resolveConflict)
  const user = useEditor((s) => s.user)
  const [busy, setBusy] = useState<ConflictChoice | null>(null)
  if (!conflict || hidden) return null
  const who = conflict.updatedBy && user && conflict.updatedBy.email === user.email ? 'you, on another device' : personLabel(conflict.updatedBy)
  const when = new Date(conflict.remoteUpdatedAt).toLocaleString()
  const pick = async (choice: ConflictChoice) => {
    setBusy(choice)
    try {
      await resolve(conflict.projectId, choice)
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="modal-backdrop">
      <div className="modal conflict" role="dialog" aria-modal="true">
        <div className="panel-head">
          <strong>“{conflict.name}” changed elsewhere</strong>
        </div>
        <div className="props">
          <p>
            A newer version was saved by <b>{who}</b> on {when}, while this device still had unsaved changes. The plans have diverged and there is no automatic merge, so choose what to keep:
          </p>
          <div className="conflict-options">
            <button className="conflict-option" disabled={!!busy} onClick={() => pick('overwrite')}>
              <strong>{busy === 'overwrite' ? 'Saving…' : 'Overwrite with my version'}</strong>
              <span className="muted small">Their changes since your last sync are lost. Everyone gets your version.</span>
            </button>
            <button className="conflict-option" disabled={!!busy} onClick={() => pick('duplicate')}>
              <strong>{busy === 'duplicate' ? 'Duplicating…' : 'Keep both: duplicate my version'}</strong>
              <span className="muted small">Your version becomes a new project of your own (“{conflict.name} (my copy)”). The shared project takes their version.</span>
            </button>
            <button className="conflict-option" disabled={!!busy} onClick={() => pick('theirs')}>
              <strong>{busy === 'theirs' ? 'Loading…' : 'Discard mine, use their version'}</strong>
              <span className="muted small">Your unsaved changes on this device are lost.</span>
            </button>
          </div>
          <div className="row end">
            <button disabled={!!busy} onClick={() => setHidden(true)} title="Keep editing locally; nothing is saved to the account until you decide">
              Decide later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** transient message at the bottom of the screen */
export function Notice() {
  const notice = useEditor((s) => s.notice)
  const setNotice = useEditor((s) => s.setNotice)
  if (!notice) return null
  return (
    <div className="notice" onAnimationEnd={() => setNotice(null)}>
      {notice}
    </div>
  )
}
