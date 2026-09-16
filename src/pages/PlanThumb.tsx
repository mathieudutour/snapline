import { useMemo } from 'react'
import { loadProject } from '../model/store'
import { findRooms, planBounds, wallPolygon } from '../model/geometry'
import { floorArea } from '../model/rooms'
import { formatArea, type Units } from '../model/units'
import { Icon } from '../brand/Icons'

const W = 240
const H = 118
const PAD = 14

/**
 * A project card's thumbnail: the plan itself, in poché, with its area.
 *
 * Plans are the most recognisable thing in the product and they were the one thing the
 * project list did not show — a name, a timestamp and two grey glyphs. This draws the
 * ground floor of the stored project at whatever scale fits the card.
 */
export function PlanThumb({ projectId, units }: { projectId: string; units: Units }) {
  const drawing = useMemo(() => {
    const project = loadProject(projectId)
    // only cached projects can be drawn: one that has never been opened on this device has no plan here yet
    if (!project) return null
    const plan = project.floors[0]?.plan
    if (!plan) return null
    const bounds = planBounds(plan)
    if (!bounds) return null
    const w = Math.max(bounds.max.x - bounds.min.x, 0.001)
    const h = Math.max(bounds.max.y - bounds.min.y, 0.001)
    const scale = Math.min((W - PAD * 2) / w, (H - PAD * 2) / h)
    const dx = (W - w * scale) / 2 - bounds.min.x * scale
    const dy = (H - h * scale) / 2 - bounds.min.y * scale
    const rooms = findRooms(plan)
    return {
      transform: `translate(${dx} ${dy}) scale(${scale})`,
      rooms: rooms.map((r) => ({ id: r.id, points: r.polygon.map((p) => `${p.x},${p.y}`).join(' ') })),
      walls: Object.values(plan.walls).map((wall) => ({ id: wall.id, points: wallPolygon(plan, wall).map((p) => `${p.x},${p.y}`).join(' ') })),
      // every floor counts towards the area shown on the card
      area: project.floors.reduce((sum, f) => sum + floorArea(findRooms(f.plan)), 0),
    }
  }, [projectId])

  if (!drawing || drawing.walls.length === 0) {
    return (
      <div className="project-thumb">
        <div className="empty" title="Open this plan once on this device to see it here">
          <Icon name="wall" size={26} strokeWidth={1.4} />
        </div>
      </div>
    )
  }
  return (
    <div className="project-thumb">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <g transform={drawing.transform}>
          {drawing.rooms.map((r) => (
            <polygon key={r.id} points={r.points} fill="#f6f1e7" />
          ))}
          {drawing.walls.map((w) => (
            <polygon key={w.id} points={w.points} fill="#2b2f34" />
          ))}
        </g>
      </svg>
      {drawing.area > 0 && <span className="area">{formatArea(drawing.area, units)}</span>}
    </div>
  )
}
