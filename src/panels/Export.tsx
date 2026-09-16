import { useMemo, useState } from 'react'
import { useEditor } from '../model/store'
import { capturePlan, download, makeGlb, makePdf, pxPerMetre, rasterize, safeName, type Paper, type PdfPage } from '../export/planExport'
import { Icon, type IconName } from '../brand/Icons'
import { findRooms, planBounds, wallPolygon } from '../model/geometry'
import { Mark } from '../brand/Brand'

type Kind = 'png' | 'pdf' | 'glb' | 'json'
const SCALES: { label: string; value: number | 'fit' }[] = [
  { label: 'Fit to page', value: 'fit' },
  { label: '1:50', value: 50 },
  { label: '1:100', value: 100 },
  { label: '1:200', value: 200 },
]
const KINDS: { id: Kind; label: string; icon: IconName; hint: string }[] = [
  { id: 'pdf', label: 'PDF', icon: 'filePdf', hint: 'To scale, one page per floor, with a title block.' },
  { id: 'png', label: 'PNG', icon: 'fileImage', hint: 'A raster image of the plan at a chosen scale and resolution.' },
  { id: 'glb', label: 'glTF', icon: 'fileModel', hint: 'Walls, floors, roof and structures; furniture as boxes. Opens in Blender, SketchUp, three.js…' },
  { id: 'json', label: 'Project', icon: 'fileProject', hint: 'Everything in the project, to import into Cordeau again.' },
]
/** millimetres, portrait */
const PAPER_MM: Record<Paper, [number, number]> = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] }

/** the frame is captured from the editor's SVG, so the plan view must be open for image exports */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const activeFloorId = useEditor((s) => s.activeFloorId)
  const units = useEditor((s) => s.units)
  const mode = useEditor((s) => s.mode)
  const [kind, setKind] = useState<Kind>('pdf')
  const [scale, setScale] = useState<number | 'fit'>(100)
  const [paper, setPaper] = useState<Paper>('A4')
  const [dpi, setDpi] = useState(150)
  const [allFloors, setAllFloors] = useState(false)
  const [underlay, setUnderlay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = safeName(project.name)

  /** capture each requested floor by switching to it (the editor re-renders synchronously per floor) */
  const captures = async () => {
    const st = useEditor.getState()
    if (st.mode !== 'plan') throw new Error('Switch to the 2D view to export the plan.')
    const floors = allFloors ? project.floors : project.floors.filter((f) => f.id === activeFloorId)
    const startFloor = st.activeFloorId
    st.clearSelection() // no selection highlight in the drawing
    const pages: PdfPage[] = []
    for (const f of floors) {
      if (useEditor.getState().activeFloorId !== f.id) {
        useEditor.getState().setActiveFloor(f.id)
        await new Promise((r) => setTimeout(r, 120))
      }
      const svg = document.getElementById('plan-svg') as SVGSVGElement | null
      if (!svg) throw new Error('The plan view is not open.')
      const capture = await capturePlan(svg, useEditor.getState().plan, { underlay })
      if (capture) pages.push({ capture, floorName: f.name, plan: useEditor.getState().plan })
    }
    if (useEditor.getState().activeFloorId !== startFloor) useEditor.getState().setActiveFloor(startFloor)
    if (!pages.length) throw new Error('Nothing to export yet: draw some walls first.')
    return pages
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'json') {
        download(new Blob([JSON.stringify({ version: 2, ...project }, null, 2)], { type: 'application/json' }), `${name}.cordeau.json`)
      } else if (kind === 'glb') {
        download(await makeGlb(project), `${name}.glb`)
      } else if (kind === 'png') {
        const pages = await captures()
        const s = scale === 'fit' ? 100 : scale
        for (const p of pages) {
          const { blob } = await rasterize(p.capture, pxPerMetre(s, dpi))
          download(blob, `${name}-${safeName(p.floorName)}-1-${s}.png`)
        }
      } else {
        const pages = await captures()
        download(await makePdf(pages, { paper, scale, projectName: project.name, units }), `${name}.pdf`)
      }
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  const planKind = kind === 'png' || kind === 'pdf'
  const pageCount = allFloors ? project.floors.length : 1
  const current = KINDS.find((k) => k.id === kind)!
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <strong>Export</strong>
          <button className="x" onClick={onClose} title="Close">
            <Icon name="close" size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="props">
          <div className="export-kinds">
            {KINDS.map((k) => (
              <button key={k.id} className={`export-kind ${kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)} title={k.hint}>
                <Icon name={k.icon} size={18} strokeWidth={1.8} />
                {k.label}
              </button>
            ))}
          </div>
          <div className="export-body">
            {/* what you are about to get: scale, paper and floor count are hard to imagine as dropdowns */}
            <div className="export-preview">
              {planKind ? <PagePreview paper={kind === 'pdf' ? paper : 'A4'} scale={scale} /> : <FilePreview icon={current.icon} />}
              <div className="caption">
                {planKind
                  ? `${kind === 'pdf' ? paper : 'image'} · ${scale === 'fit' ? 'fit to page' : `1:${scale}`}${pageCount > 1 ? ` · ${pageCount} pages` : ''}`
                  : `${name}.${kind === 'glb' ? 'glb' : 'cordeau.json'}`}
              </div>
            </div>
            <div className="export-options">
              {planKind ? (
                <>
                  <label className="field">
                    <span>Scale</span>
                    <select value={String(scale)} onChange={(e) => setScale(e.target.value === 'fit' ? 'fit' : Number(e.target.value))}>
                      {SCALES.filter((s) => kind === 'pdf' || s.value !== 'fit').map((s) => (
                        <option key={String(s.value)} value={String(s.value)}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {kind === 'pdf' && (
                    <label className="field">
                      <span>Paper</span>
                      <select value={paper} onChange={(e) => setPaper(e.target.value as Paper)}>
                        <option value="A4">A4</option>
                        <option value="A3">A3</option>
                        <option value="Letter">Letter</option>
                      </select>
                    </label>
                  )}
                  {kind === 'png' && (
                    <label className="field">
                      <span>Resolution</span>
                      <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))}>
                        <option value={96}>96 dpi (screen)</option>
                        <option value={150}>150 dpi</option>
                        <option value={300}>300 dpi (print)</option>
                      </select>
                    </label>
                  )}
                  {project.floors.length > 1 && (
                    <label className="toggle block">
                      <span>All floors ({project.floors.length})</span>
                      <input className="switch" type="checkbox" checked={allFloors} onChange={(e) => setAllFloors(e.target.checked)} />
                    </label>
                  )}
                  {project.floors.some((f) => f.underlay) && (
                    <label className="toggle block">
                      <span>Include the underlay image</span>
                      <input className="switch" type="checkbox" checked={underlay} onChange={(e) => setUnderlay(e.target.checked)} />
                    </label>
                  )}
                  {mode !== 'plan' && <p className="warn small">Switch to the 2D view to export the plan.</p>}
                </>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>
                  {current.hint}
                </p>
              )}
            </div>
          </div>
          {error && <p className="warn small">{error}</p>}
          <div className="row end">
            <button onClick={onClose}>Cancel</button>
            {/* the primary button names the artefact, so you know what lands in Downloads */}
            <button className="primary" disabled={busy || (planKind && mode !== 'plan')} onClick={() => void run()}>
              {busy ? 'Exporting…' : `Export ${current.label}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** a page at the chosen paper, with the plan drawn on it at the chosen scale and a title block */
function PagePreview({ paper, scale }: { paper: Paper; scale: number | 'fit' }) {
  const plan = useEditor((s) => s.plan)
  const [mmW, mmH] = PAPER_MM[paper]
  const boxH = 140
  const boxW = Math.round((boxH * mmW) / mmH)
  const page = useMemo(() => {
    const bounds = planBounds(plan)
    if (!bounds) return null
    // the drawing area is the page less a 12 mm margin and a 16 mm title block at the foot
    const areaMm = { x: 12, y: 12, w: mmW - 24, h: mmH - 24 - 16 }
    const w = Math.max(bounds.max.x - bounds.min.x, 0.001)
    const h = Math.max(bounds.max.y - bounds.min.y, 0.001)
    // at 1:100, one metre is 10 mm on the paper; "fit" uses whatever fills the drawing area
    const mmPerM = scale === 'fit' ? Math.min(areaMm.w / w, areaMm.h / h) : 1000 / scale
    const px = boxW / mmW // preview pixels per millimetre
    const s = mmPerM * px
    const dx = (areaMm.x + areaMm.w / 2) * px - ((bounds.min.x + bounds.max.x) / 2) * s
    const dy = (areaMm.y + areaMm.h / 2) * px - ((bounds.min.y + bounds.max.y) / 2) * s
    return {
      clip: { x: areaMm.x * px, y: areaMm.y * px, w: areaMm.w * px, h: areaMm.h * px },
      transform: `translate(${dx} ${dy}) scale(${s})`,
      rooms: findRooms(plan).map((r) => ({ id: r.id, points: r.polygon.map((p) => `${p.x},${p.y}`).join(' ') })),
      walls: Object.values(plan.walls).map((wall) => ({ id: wall.id, points: wallPolygon(plan, wall).map((p) => `${p.x},${p.y}`).join(' ') })),
      overflows: scale !== 'fit' && (w * mmPerM > areaMm.w || h * mmPerM > areaMm.h),
      titleY: (mmH - 12 - 16) * px,
      px,
    }
  }, [plan, mmW, mmH, boxW, scale])

  return (
    <svg width={boxW} height={boxH} viewBox={`0 0 ${boxW} ${boxH}`}>
      <rect width={boxW} height={boxH} fill="#fff" stroke="#e4e5e9" />
      {page && (
        <>
          <clipPath id="export-page-clip">
            <rect x={page.clip.x} y={page.clip.y} width={page.clip.w} height={page.clip.h} />
          </clipPath>
          <g clipPath="url(#export-page-clip)">
            <g transform={page.transform}>
              {page.rooms.map((r) => (
                <polygon key={r.id} points={r.points} fill="#f6f1e7" />
              ))}
              {page.walls.map((w) => (
                <polygon key={w.id} points={w.points} fill="#2b2f34" />
              ))}
            </g>
          </g>
          {/* title block */}
          <line x1={page.clip.x} y1={page.titleY} x2={page.clip.x + page.clip.w} y2={page.titleY} stroke="#b9bcc2" strokeWidth={0.7} />
          <rect x={page.clip.x} y={page.titleY + 4} width={page.clip.w * 0.55} height={5} rx={1} fill="#e9eaec" />
          <rect x={page.clip.x} y={page.titleY + 12} width={page.clip.w * 0.35} height={4} rx={1} fill="#eef0f2" />
          {page.overflows && (
            <text x={boxW / 2} y={boxH / 2} fontSize={8} textAnchor="middle" fill="#d7263d" fontFamily="ui-monospace, Menlo, monospace">
              does not fit
            </text>
          )}
        </>
      )}
      {!page && (
        <text x={boxW / 2} y={boxH / 2} fontSize={8} textAnchor="middle" fill="#8b9099" fontFamily="ui-monospace, Menlo, monospace">
          nothing drawn yet
        </text>
      )}
    </svg>
  )
}

function FilePreview({ icon }: { icon: IconName }) {
  return (
    <div style={{ height: 140, display: 'grid', placeItems: 'center', gap: 10, color: '#8b9099' }}>
      <Icon name={icon} size={44} strokeWidth={1.2} />
      <Mark size={20} cut="full" />
    </div>
  )
}
