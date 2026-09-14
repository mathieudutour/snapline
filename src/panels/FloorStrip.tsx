import { useEditor } from '../model/store'

export function FloorStrip() {
  const project = useEditor((s) => s.project)
  const activeFloorId = useEditor((s) => s.activeFloorId)
  const mode = useEditor((s) => s.mode)
  const setActiveFloor = useEditor((s) => s.setActiveFloor)
  const addFloor = useEditor((s) => s.addFloor)
  const duplicateFloor = useEditor((s) => s.duplicateFloor)
  const removeFloor = useEditor((s) => s.removeFloor)
  const renameFloor = useEditor((s) => s.renameFloor)
  const showFloorBelow = useEditor((s) => s.showFloorBelow)
  const setShowFloorBelow = useEditor((s) => s.setShowFloorBelow)
  const idx = project.floors.findIndex((f) => f.id === activeFloorId)
  const rename = (id: string, current: string) => {
    const name = prompt('Floor name', current)
    if (name && name.trim()) renameFloor(id, name.trim())
  }
  return (
    <div className="floor-strip">
      <div className="seg">
        {project.floors.map((f) => (
          <button key={f.id} className={f.id === activeFloorId ? 'active' : ''} onClick={() => setActiveFloor(f.id)} onDoubleClick={() => rename(f.id, f.name)} title="Double-click to rename · PageUp / PageDown to switch">
            {f.name}
          </button>
        ))}
      </div>
      <div className="seg">
        <button onClick={addFloor} title="Add an empty floor on top">
          + Floor
        </button>
        <button onClick={() => duplicateFloor(activeFloorId)} title="Duplicate this floor above itself">
          ⧉
        </button>
        <button onClick={() => rename(activeFloorId, project.floors[idx]?.name ?? '')} title="Rename this floor">
          ✎
        </button>
        <button
          disabled={project.floors.length <= 1}
          onClick={() => {
            if (confirm(`Remove "${project.floors[idx]?.name}" and everything on it?`)) removeFloor(activeFloorId)
          }}
          title="Remove this floor"
        >
          ✕
        </button>
      </div>
      {mode === 'plan' && idx > 0 && (
        <label className="toggle">
          <input type="checkbox" checked={showFloorBelow} onChange={(e) => setShowFloorBelow(e.target.checked)} /> Show floor below
        </label>
      )}
    </div>
  )
}
