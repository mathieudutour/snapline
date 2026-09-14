import { useEffect, useState } from 'react'
import { useEditor } from '../model/store'
import { addMember, listMembers, removeMember, setViewLink, viewLinkUrl, type MemberRole, type Person, type ProjectMember, type ProjectRole } from '../sync/api'

const ROLE_LABEL: Record<MemberRole, string> = { editor: 'Can edit', viewer: 'Can view' }

/**
 * Share a project: invite Google accounts by email as editors or read-only viewers, or turn on a
 * link that lets anyone view it. Everyone in the project sees the others' cursors and edits live.
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
  const [inviteRole, setInviteRole] = useState<MemberRole>('editor')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const linkToken = project?.viewToken ?? null

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
      setMembers(await addMember(projectId, value, inviteRole))
      setEmail('')
      void refreshProjectMeta(projectId)
    } catch (e) {
      const status = (e as { status?: number }).status
      setError(status === 400 ? 'Enter the Google account email of the person to invite.' : 'Could not share the project. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const changeRole = async (m: ProjectMember, next: MemberRole) => {
    setBusy(true)
    try {
      setMembers(await addMember(projectId, m.email, next))
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
  const toggleLink = async (on: boolean) => {
    setBusy(true)
    setError(null)
    try {
      await setViewLink(projectId, on)
      await refreshProjectMeta(projectId)
    } catch {
      setError('Could not change the link. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!linkToken) return
    try {
      await navigator.clipboard.writeText(viewLinkUrl(linkToken))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked: the field is selectable
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
              <p className="muted small">People you invite sign in with Google using that email and then see this project in their list. Editors change the plan live with you; viewers only look. Edits made while offline are merged when you reconnect.</p>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault()
                  void invite()
                }}
              >
                <input className="grow" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} autoFocus />
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as MemberRole)} disabled={busy} title="What they can do">
                  <option value="editor">{ROLE_LABEL.editor}</option>
                  <option value="viewer">{ROLE_LABEL.viewer}</option>
                </select>
                <button className="button primary" type="submit" disabled={busy || !email.trim()}>
                  Invite
                </button>
              </form>
            </>
          ) : (
            <p className="muted small">
              Shared with you by <b>{owner ? owner.name || owner.email : '…'}</b>.{' '}
              {role === 'viewer' ? 'You can look at the plan and follow the edits live, but not change it.' : "Everyone edits the same plan live: you see each other's cursors and changes as they happen."}
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
                  <>
                    <select className="small" value={m.role} onChange={(e) => void changeRole(m, e.target.value as MemberRole)} disabled={busy}>
                      <option value="editor">{ROLE_LABEL.editor}</option>
                      <option value="viewer">{ROLE_LABEL.viewer}</option>
                    </select>
                    <button className="icon-btn" title="Remove" disabled={busy} onClick={() => void remove(m)}>
                      ✕
                    </button>
                  </>
                ) : (
                  <span className="muted small">
                    {ROLE_LABEL[m.role]}
                    {user?.email.toLowerCase() === m.email ? ' · you' : ''}
                  </span>
                )}
              </li>
            ))}
            {members && members.length === 0 && <li className="muted small">Not shared with anyone yet.</li>}
          </ul>
          {role === 'owner' && (
            <div className="link-share">
              <label className="toggle block">
                <input type="checkbox" checked={!!linkToken} disabled={busy} onChange={(e) => void toggleLink(e.target.checked)} /> Anyone with the link can view
              </label>
              {linkToken && (
                <div className="row">
                  <input className="grow" readOnly value={viewLinkUrl(linkToken)} onFocus={(e) => e.target.select()} />
                  <button onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button>
                </div>
              )}
              <p className="muted small">People with the link follow the plan live without an account and cannot change it. Turn the link off to revoke it.</p>
            </div>
          )}
          {error && <p className="warn small">{error}</p>}
          {role !== 'owner' && (
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
