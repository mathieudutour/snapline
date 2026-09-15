import { useState } from 'react'
import { useEditor } from '../model/store'
import { capturePlan, download, makeGlb, makePdf, pxPerMetre, rasterize, safeName, type Paper, type PdfPage } from '../export/planExport'

type Kind = 'png' | 'pdf' | 'glb' | 'json'
const SCALES: { label: string; value: number | 'fit' }[] = [
  { label: 'Fit to page', value: 'fit' },
  { label: '1:50', value: 50 },
  { label: '1:100', value: 100 },
  { label: '1:200', value: 200 },
]

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
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <strong>Export “{project.name}”</strong>
          <button className="x" onClick={onClose} title="Close">
            ×
          </button>
        </div>
        <div className="props">
          <div className="export-kinds">
            {(
              [
                ['pdf', 'Plan as PDF', 'To scale, one page per floor, with a title block.'],
                ['png', 'Plan as PNG', 'A raster image of the plan at a chosen scale and resolution.'],
                ['glb', '3D model (glTF)', 'Walls, floors, roof and structures; furniture as boxes. Opens in Blender, SketchUp, three.js…'],
                ['json', 'Project file', 'Everything in the project, to import into Cordeau again.'],
              ] as [Kind, string, string][]
            ).map(([k, title, hint]) => (
              <label key={k} className={`export-kind ${kind === k ? 'on' : ''}`}>
                <input type="radio" name="kind" checked={kind === k} onChange={() => setKind(k)} />
                <span>
                  <strong>{title}</strong>
                  <span className="muted small">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          {planKind && (
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
                  <input type="checkbox" checked={allFloors} onChange={(e) => setAllFloors(e.target.checked)} /> All floors ({project.floors.length})
                </label>
              )}
              {project.floors.some((f) => f.underlay) && (
                <label className="toggle block">
                  <input type="checkbox" checked={underlay} onChange={(e) => setUnderlay(e.target.checked)} /> Include the underlay image
                </label>
              )}
              {mode !== 'plan' && <p className="warn small">Switch to the 2D view to export the plan.</p>}
            </>
          )}
          {error && <p className="warn small">{error}</p>}
          <div className="row end">
            <button onClick={onClose}>Cancel</button>
            <button className="button primary" disabled={busy || (planKind && mode !== 'plan')} onClick={() => void run()}>
              {busy ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
