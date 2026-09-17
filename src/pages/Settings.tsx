import { useEffect, useMemo, useState } from 'react'
import { loadProject, useEditor } from '../model/store'
import { navigate, onLinkClick } from '../router'
import { AccountButton, SYNC_LABEL } from '../panels/Account'
import { confirmAction } from '../panels/Confirm'
import { ImportModelDialog } from '../panels/ImportModel'
import { Icon } from '../brand/Icons'
import { Lockup } from '../brand/Brand'
import { GoogleMark } from './Login'
import { formatLength, UNIT_LABELS, UNIT_ORDER, type Units } from '../model/units'
import { customModelUrls, getModelBlobs, type CustomModel } from '../furniture/customModels'

/**
 * Settings: the things that are yours rather than the plan's.
 *
 * Units, your account, the furniture you imported and your data are per user, and none of
 * them needs the plan on screen to be judged. They used to be two popups inside the editor
 * — which meant you could not set your units from the projects list, even though the
 * thumbnails there are drawn in them. Drawing aids (snap, auto-lock, the ghost floor) are
 * judged against the drawing and stay on the canvas, in the view pill.
 *
 * Same shell as /projects: two pages that share a chrome read as one app.
 */
export function Settings() {
  return (
    <div className="projects-page settings-page">
      <header className="projects-head">
        <a href="/home" onClick={onLinkClick} aria-label="Cordeau">
          <Lockup size={23} />
        </a>
        <div className="spacer" />
        <a className="button quiet" href="/projects" onClick={onLinkClick}>
          Your plans
        </a>
        <AccountButton />
      </header>
      <main>
        <div className="settings-layout">
          <nav className="settings-nav">
            <h1>Settings</h1>
            <a href="#account">Account</a>
            <a href="#units">Units</a>
            <a href="#furniture">Furniture library</a>
            <a href="#data">Your data</a>
          </nav>
          <div className="settings-cards">
            <AccountCard />
            <UnitsCard />
            <FurnitureCard />
            <DataCard />
          </div>
        </div>
      </main>
    </div>
  )
}

function ago(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 90) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.round(m)} min ago`
  const h = m / 60
  if (h < 24) return `${Math.round(h)} h ago`
  return new Date(at).toLocaleString()
}

function AccountCard() {
  const user = useEditor((s) => s.user)
  const apiAvailable = useEditor((s) => s.apiAvailable)
  const syncStatus = useEditor((s) => s.syncStatus)
  const lastSyncAt = useEditor((s) => s.lastSyncAt)
  const projects = useEditor((s) => s.projects)
  const syncNow = useEditor((s) => s.syncNow)
  const signOut = useEditor((s) => s.signOut)
  const onAccount = projects.filter((p) => p.syncedVersion !== undefined || p.role).length
  if (!user) {
    return (
      <section className="settings-card" id="account">
        <div className="settings-card-head">
          <h2>Account</h2>
          <p>{apiAvailable === false ? 'This build has no account service: your plans stay in this browser.' : 'Sign in to keep your plans on your account and open them on any device.'}</p>
        </div>
      </section>
    )
  }
  return (
    <section className="settings-card" id="account">
      <div className="settings-card-row identity">
        {user.picture ? <img className="avatar large" src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar large">{(user.name || user.email).slice(0, 1).toUpperCase()}</span>}
        <div className="grow">
          <div className="settings-row-title">{user.name || user.email}</div>
          <div className="settings-row-sub">{user.email}</div>
        </div>
        <span className="provider">
          <GoogleMark /> Google
        </span>
      </div>
      <div className="settings-card-row">
        <span className={`dot ${syncStatus}`} />
        <div className="grow">
          <div className="settings-row-title">{SYNC_LABEL[syncStatus]}</div>
          <div className="settings-row-sub">
            {onAccount} plan{onAccount === 1 ? '' : 's'}
            {lastSyncAt ? ` · last sync ${ago(lastSyncAt)}` : ''}
          </div>
        </div>
        <button onClick={() => void syncNow()} disabled={syncStatus === 'syncing'}>
          {syncStatus === 'syncing' ? 'Saving…' : 'Sync now'}
        </button>
      </div>
      <div className="settings-card-row">
        <span className="muted small grow">Your plans stay on your account; sign in again on any device to pick them up.</span>
        <button onClick={() => void signOut().then(() => navigate('/home'))}>Sign out</button>
      </div>
    </section>
  )
}

/** the one preference that changes how every number in the product reads: shown as the same number, four ways */
function UnitsCard() {
  const units = useEditor((s) => s.units)
  const setUnits = useEditor((s) => s.setUnits)
  return (
    <section className="settings-card" id="units">
      <div className="settings-card-head">
        <h2>Units</h2>
        <p>Lengths are stored in metres, so switching never changes a plan — only how it is written.</p>
      </div>
      <div className="unit-options" role="radiogroup" aria-label="Units">
        {UNIT_ORDER.map((u: Units) => (
          <button key={u} className={`unit-option ${units === u ? 'on' : ''}`} role="radio" aria-checked={units === u} onClick={() => setUnits(u)}>
            <span className="radio-dot" />
            <span>
              <span className="settings-row-title">{UNIT_LABELS[u]}</span>
              <span className="settings-row-sub">{formatLength(5.2, u)}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} kB`
  return `${n} B`
}

/** the furniture you imported: every model, what it weighs, and which plans use it — a home it never had */
function FurnitureCard() {
  const models = useEditor((s) => s.customModels)
  const deleteCustomModel = useEditor((s) => s.deleteCustomModel)
  const projects = useEditor((s) => s.projects)
  const current = useEditor((s) => s.project)
  const [importing, setImporting] = useState(false)
  const [sizes, setSizes] = useState<Record<string, number>>({})
  useEffect(() => {
    let live = true
    void Promise.all(
      models.map(async (m) => {
        const blobs = await getModelBlobs(m.key).catch(() => undefined)
        return [m.key, blobs ? blobs.glb.byteLength + blobs.plan.size + blobs.thumb.size : 0] as const
      }),
    ).then((pairs) => live && setSizes(Object.fromEntries(pairs)))
    return () => {
      live = false
    }
  }, [models])
  // which plans place each model: every plan on this device, the open one from memory
  const usage = useMemo(() => {
    const count = new Map<string, number>()
    for (const meta of projects) {
      const p = meta.id === current.id ? current : loadProject(meta.id)
      if (!p) continue
      const keys = new Set(p.floors.flatMap((f) => Object.values(f.plan.furniture).map((x) => x.catalogKey)))
      for (const k of keys) count.set(k, (count.get(k) ?? 0) + 1)
    }
    return count
  }, [projects, current])
  const total = models.reduce((n, m) => n + (sizes[m.key] ?? 0), 0)
  const remove = async (m: CustomModel) => {
    const used = usage.get(m.key) ?? 0
    const ok = await confirmAction({
      title: `Delete “${m.name}”?`,
      body: used > 0 ? `It is placed in ${used} plan${used === 1 ? '' : 's'}; those pieces keep their size but lose their model.` : 'It is not placed in any plan.',
      confirmLabel: 'Delete model',
    })
    if (ok) void deleteCustomModel(m.key)
  }
  return (
    <section className="settings-card" id="furniture">
      <div className="settings-card-head with-action">
        <div className="grow">
          <h2>Furniture you've imported</h2>
          <p>Your own glTF models, available in every plan on your account.</p>
        </div>
        <button className="primary" onClick={() => setImporting(true)}>
          Import a model…
        </button>
      </div>
      {models.length === 0 && <div className="settings-card-row muted small">Nothing imported yet. A .glb or .gltf file becomes a piece you can place like any other.</div>}
      {models.map((m) => {
        const used = usage.get(m.key) ?? 0
        const urls = customModelUrls(m.key)
        return (
          <div key={m.key} className="settings-card-row model-row">
            {urls?.thumb ? <img className="model-thumb" src={urls.thumb} alt="" /> : <span className="model-thumb" />}
            <div className="grow">
              <div className="settings-row-title">{m.name}</div>
              <div className="settings-row-sub">
                {m.width.toFixed(2)} × {m.depth.toFixed(2)} × {m.height.toFixed(2)} m{sizes[m.key] ? ` · ${formatBytes(sizes[m.key])}` : ''}
              </div>
            </div>
            <span className={`settings-row-sub ${used ? '' : 'faint'}`}>{used ? `in ${used} plan${used === 1 ? '' : 's'}` : 'unused'}</span>
            <button className="icon-btn" title="Delete this model" onClick={() => void remove(m)}>
              <Icon name="trash" size={14} strokeWidth={1.9} title="Delete" />
            </button>
          </div>
        )
      })}
      {models.length > 0 && (
        <div className="settings-card-foot">
          {models.length} model{models.length === 1 ? '' : 's'}
          {total ? ` · ${formatBytes(total)}` : ''}
        </div>
      )}
      {importing && <ImportModelDialog onClose={() => setImporting(false)} onImported={() => setImporting(false)} />}
    </section>
  )
}

/** what anything holding your data owes you: a way out, and a way to end it */
function DataCard() {
  const user = useEditor((s) => s.user)
  const projects = useEditor((s) => s.projects)
  const exportAll = useEditor((s) => s.exportAllProjects)
  const deleteAccount = useEditor((s) => s.deleteAccount)
  const setNotice = useEditor((s) => s.setNotice)
  const [deleting, setDeleting] = useState(false)
  const download = () => {
    const blob = exportAll()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cordeau-plans-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  const remove = async () => {
    const ok = await confirmAction({
      title: 'Delete your account?',
      body: 'The plans you own, their rules, and your imported models are deleted from your account. Plans shared with you stay with their owners. This cannot be undone — export everything first if you want to keep it.',
      confirmLabel: 'Delete my account',
    })
    if (!ok) return
    setDeleting(true)
    try {
      await deleteAccount()
      navigate('/home')
    } catch {
      setNotice('Your account could not be deleted. Check your connection and try again.')
    } finally {
      setDeleting(false)
    }
  }
  return (
    <section className="settings-card" id="data">
      <div className="settings-card-head">
        <h2>Your data</h2>
      </div>
      <div className="settings-card-row">
        <div className="grow">
          <div className="settings-row-title">Export everything</div>
          <div className="settings-row-sub">One JSON file per plan, in a zip. Each one can be imported back from the project menu.</div>
        </div>
        <button onClick={download} disabled={projects.length === 0}>
          Export all plans
        </button>
      </div>
      {user && (
        <div className="settings-card-row">
          <div className="grow">
            <div className="settings-row-title danger">Delete your account</div>
            <div className="settings-row-sub">Plans you own, their rules and your imported models. Cannot be undone.</div>
          </div>
          <button className="danger-outline" onClick={() => void remove()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete…'}
          </button>
        </div>
      )}
    </section>
  )
}
