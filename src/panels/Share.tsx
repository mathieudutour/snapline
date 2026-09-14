import { useEffect, useState } from 'react'
import { useEditor } from '../model/store'
import { addMember, listMembers, removeMember, type Person, type ProjectMember, type ProjectRole } from '../sync/api'

/**
 * Share a project with other Google accounts by email. Everyone invited can edit; there is no
 * live collaboration, so diverging edits are caught at save time (see ConflictDialog).
 */
export function ShareDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const user = useEditor((s) => s.user)
  const project = useEditor((s) => s.projects.find((p) => p.id === projectId))
  const refreshProjectMeta = useEditor((s) => s.refreshProjectMeta)
  const deleteProject = useEditor((s) => s.deleteProject)
  const [owner, setOwner] = useState<Person | null>(null)
  const [role, setRole] = useState<ProjectRole>('owner')
  const [members, setMembers] = useState<ProjectMember[] | null>(null)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    listMembers(projectId)
      .then((r) => {
        if (!live) return
        setOwner(r.owner)
        setRole(r.role)
        setMembers(r.members)
      })
      .catch(() => live && setError('This project is not saved to your account yet. Wait for the sync and try again.'))
    return () => {
      live = false
    }
  }, [projectId])

  const invite = async () => {
    const value = email.trim()
    if (!value) return
    setBusy(true)
    setError(null)
    try {
      setMembers(await addMember(projectId, value))
      setEmail('')
      void refreshProjectMeta(projectId)
    } catch (e) {
      const status = (e as { status?: number }).status
      setError(status === 400 ? 'Enter the Google account email of the person to invite.' : 'Could not share the project. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (m: ProjectMember) => {
    setBusy(true)
    try {
      await removeMember(projectId, m.email)
      setMembers((list) => (list ?? []).filter((x) => x.email !== m.email))
      void refreshProjectMeta(projectId)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <strong>Share “{project?.name ?? 'project'}”</strong>
          <button className="x" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="props">
          {role === 'owner' ? (
            <>
              <p className="muted small">People you invite sign in with Google using that email and then see this project in their list. They can edit everything; changes are exchanged when each of you saves, not live.</p>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault()
                  void invite()
                }}
              >
                <input className="grow" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} autoFocus />
                <button className="button primary" type="submit" disabled={busy || !email.trim()}>
                  Invite
                </button>
              </form>
            </>
          ) : (
            <p className="muted small">
              Shared with you by <b>{owner ? owner.name || owner.email : '…'}</b>. You can edit everything; changes are exchanged when each of you saves, not live.
            </p>
          )}
          <ul className="member-list">
            {owner && (
              <li>
                <span className="avatar small">{(owner.name || owner.email).slice(0, 1).toUpperCase()}</span>
                <span className="grow">
                  {owner.name || owner.email}
                  {owner.name && <span className="muted small"> {owner.email}</span>}
                </span>
                <span className="muted small">Owner</span>
              </li>
            )}
            {members?.map((m) => (
              <li key={m.email}>
                <span className="avatar small">{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
                <span className="grow">
                  {m.name || m.email}
                  {m.name && <span className="muted small"> {m.email}</span>}
                  {!m.name && <span className="muted small"> · not signed in yet</span>}
                </span>
                {role === 'owner' ? (
                  <button className="icon-btn" title="Remove" disabled={busy} onClick={() => void remove(m)}>
                    ✕
                  </button>
                ) : (
                  user?.email.toLowerCase() === m.email && <span className="muted small">You</span>
                )}
              </li>
            ))}
            {members && members.length === 0 && <li className="muted small">Not shared with anyone yet.</li>}
          </ul>
          {error && <p className="warn small">{error}</p>}
          {role === 'editor' && (
            <div className="row end">
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`Leave “${project?.name}”? It stays with its owner; you can be invited again later.`)) {
                    deleteProject(projectId)
                    onClose()
                  }
                }}
              >
                Leave project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
