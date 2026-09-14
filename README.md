# Snapline

A web app for drawing floor plans where your measurements are **remembered as constraints**.

Most simple floor-plan tools let you type a wall length, apply it once, and forget it: the next time
you nudge a corner the value silently drifts and you have to re-check everything. Snapline treats every
value you type as a rule. A small geometric constraint solver keeps those rules true while you keep
editing, and tells you when two rules cannot both hold.

## Features

- **Walls, doors and windows** drawn on a 2D plan with snapping to corners, walls, alignments and a 5 cm grid.
- **Constraints that stick**
  - wall length (click any dimension label and type a value)
  - horizontal / vertical (added automatically when you draw straight walls)
  - parallel, perpendicular, equal length and explicit angle between two walls
  - anchored corners and distance between two corners
  - door / window position: distance from either end of the wall, or centred
- **Conflict detection**: when constraints cannot all be satisfied the solver finds the closest
  compromise, highlights the conflicting constraints in red, and offers a one-click undo.
- **Rooms** are detected automatically from closed wall loops, with their floor area.
- **3D view** with mitred wall corners, cut-out doors and windows, and open door leaves.
- **First-person walkthrough** with mouse look, WASD movement and wall collisions (doors are walkable).
- Undo / redo, autosave in the browser, JSON import / export, metres or centimetres.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # solver, geometry and collision tests
npm run build      # production bundle in dist/
```

## How to use

| Action | How |
| --- | --- |
| Draw walls | `W`, then click corner after corner. Enter / Esc / right-click ends the chain. Close a loop to create a room. |
| Set a length | Click the dimension label of a wall, type a value, Enter. The value is locked (padlock icon). Untick "Lock as constraint" to resize once without locking. |
| Move things | `V`, then drag corners, walls or openings. Constraints are respected while you drag. |
| Join walls | Drop a corner onto another corner or onto a wall. |
| Doors / windows | `D` / `N`, then click on a wall. Select an opening to lock its distance from either wall end. |
| Relate two walls | Shift-click two walls, then choose parallel / perpendicular / equal / angle in the side panel. |
| Anchor a corner | Select a corner and click "Anchor in place" so the plan does not drift. |
| 3D / walkthrough | Use the tabs at the top. In the walkthrough click to capture the mouse, move with WASD or arrows, Shift to run, Esc to release. |

## How the solver works

Every corner contributes two variables (x, y) and every opening one (its offset along the wall).
Each constraint contributes a residual function that is zero when the constraint holds. The plan is
solved with a small Levenberg–Marquardt least-squares solver (`src/model/solver.ts`) in two phases:

1. Pull towards what the user asked for (the cursor while dragging, or a new constraint value), with a
   weak pull of every other point towards where it currently is so the nearest layout wins.
2. Drop the drag pull and polish onto the exact constraint manifold.

Constraints whose residual is still above tolerance after phase 2 are reported as conflicting.

## Project layout

```
src/model      plan types, geometry (mitres, room detection), solver, constraints, store
src/editor     2D SVG editor, snapping, dimension labels
src/panels     toolbar and side panel
src/three      3D scene builder, orbit view, walkthrough and collisions
```
