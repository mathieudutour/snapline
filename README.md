# Snapline

A web app for drawing floor plans where your measurements are **remembered as constraints**.
A project holds several floors and an optional roof, and you can keep several projects in the browser.

Most simple floor-plan tools let you type a wall length, apply it once, and forget it: the next time
you nudge a corner the value silently drifts and you have to re-check everything. Snapline treats every
value you type as a rule. A small geometric constraint solver keeps those rules true while you keep
editing, and tells you when two rules cannot both hold.

## Features

- **Walls, doors and windows** drawn on a 2D plan with snapping to corners, walls, alignments and a 5 cm grid.
- **Furniture** from a catalogue of 117 models (beds, sofas, kitchen units, bathroom fixtures, office, lights) shown as top-view symbols in 2D and real models in 3D. Pieces dropped against a wall stay locked to it.
- **Constraints that stick**
  - wall length (click any dimension label and type a value)
  - horizontal / vertical (added automatically when you draw straight walls)
  - parallel, perpendicular, equal length and explicit angle between two walls
  - anchored corners and distance between two corners
  - door / window position: distance from either end of the wall, or centred
  - furniture: a side of a piece parallel to a wall at a given gap (0 for "against the wall"), or anchored in place
- **Conflict detection**: when constraints cannot all be satisfied the solver finds the closest
  compromise, highlights the conflicting constraints in red, and offers a one-click undo.
- **Rooms** are detected automatically from closed wall loops, with their floor area.
- **3D view** with mitred wall corners, cut-out doors and windows, and open door leaves.
- **First-person walkthrough** with mouse look, WASD movement and wall collisions (doors are walkable).
- **Projects, floors and roofs**: a project has any number of stacked floors (each with its own plan and
  floor height) and an optional flat, gable or hip roof with pitch and overhang, fitted to the top floor's
  outline. While drawing an upper floor the floor below shows as a ghost and its corners snap.
  Several projects can be kept in the browser and switched from the toolbar.
- Undo / redo (whole project), autosave in the browser, JSON import / export, metres or centimetres.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # solver, geometry and collision tests
npm run build      # production bundle in dist/
```

## How to use

The interaction model follows Figma: single-key tools, scroll to pan, Ctrl/⌘ + scroll to zoom,
Esc to go back to the Select tool. Press `?` in the app for the full list.

The editor is laid out like Figma: an icon rail on the left (layers, furniture, projects, preferences),
a left panel with the floors and a hierarchy of rooms, walls, openings, furniture and constraints, the
canvas in the middle with a floating toolbar at the bottom, and an inspector for the selection on the right.

| Action | How |
| --- | --- |
| Tools | Bottom toolbar or single keys: `V` select, `W` wall, `D` door, `N` window, `F` furniture, `H` hand. Esc returns to Select. |
| Draw walls | `W`, then click corner after corner. Enter, Esc or right-click ends the chain. Close a loop to create a room. Shift constrains to 45°, Ctrl/⌘ disables snapping. |
| Set a length | Click the dimension label of a wall, type a value, Enter. The value is locked (padlock icon). Untick "Lock as constraint" to resize once without locking. Dimensions are measured face to face on the side they are drawn (outside of rooms), the way a tape measure reads them; door and window offsets are measured from the wall faces on the room side. |
| Move things | Drag corners, walls or openings, or nudge the selection with the arrow keys (Shift for 10×). Constraints are respected. |
| Select | Click, Shift+click to add, drag on empty space for a marquee, Ctrl/⌘+A for everything, or click rows in the Layers panel. |
| Navigate | Scroll to pan, Ctrl/⌘+scroll or pinch to zoom, Space+drag to pan, `+`/`-`, Shift+0 (100%), Shift+1 (fit), Shift+2 (fit selection). The zoom readout in the inspector header fits the plan. |
| Join walls | Drop a corner onto another corner or onto a wall. |
| Doors / windows | `D` / `N`, then click on a wall. Select an opening to lock its distance from either wall end. |
| Furniture | `F` or the Furniture rail tab opens the catalogue in the left panel; click a piece, then click on the plan. `R` rotates. Dropping a piece against a wall snaps its back to the wall and locks the gap. |
| Relate two walls | Shift-click two walls, then choose parallel / perpendicular / equal / angle in the inspector. |
| Anchor a corner | Select a corner and click "Anchor in place" so the plan does not drift. |
| Floors | Floors list in the left panel: click to switch, `+` to add, hover a floor for duplicate / remove, double-click to rename; PageUp / PageDown switch floors. With nothing selected the inspector edits the floor's name and height. |
| Roof | With nothing selected, pick the roof type, pitch, ridge direction, overhang and colour in the inspector. |
| Projects | The project name at the top of the left panel opens a menu (rename, import, export, delete); the Projects rail tab lists all projects. |
| Preferences | The Prefs rail tab: metric (m or cm) or imperial (feet and inches), grid snap, auto-lock, ghost of the floor below. |
| 3D / walkthrough | Switch with 2D / 3D / Walk in the inspector header. In 3D tick "Cut above" to look inside; the walkthrough runs on the floor selected in the Floors list. |

## Furniture catalogue

The models come from the free libraries distributed with [Sweet Home 3D](https://www.sweethome3d.com/)
(Blend Swap CC0 and CC-BY sets, Scopia and Kator Legaz under CC-BY, community contributions and
Luca Presidente under the Free Art License). Per-model authors and licences are listed in
`public/furniture/CREDITS.md` and shown in the app.

The catalogue is generated, not hand-made:

```sh
# 1. unpack the .sh3f libraries (zip files) into a folder, one sub-folder per library
# 2. convert the curated selection in scripts/furniture-selection.json to GLB + thumbnails + catalog.json
node scripts/import-furniture.mjs /path/to/unpacked-libraries
# 3. render top-view symbols for the 2D plan with headless Chromium
node scripts/render-plan-icons.mjs
```

Each OBJ is normalised so its bounding box matches the catalogue size, simplified when heavy, quantised,
and its textures resized and converted to WebP, giving about 115 KB per model on average.

## Project layout

```
src/model      plan types, geometry (mitres, room detection), solver, constraints, store
               project.ts: floors, roof footprint and outline detection, migration
src/editor     2D SVG editor, snapping, dimension labels
src/panels     toolbar and side panel
src/three      3D scene builder, orbit view, walkthrough and collisions
src/furniture  catalogue metadata and asset URLs
src/sync       API client for the account and project sync
worker         Cloudflare Worker: Google sign-in, sessions, projects API, D1 schema
public/furniture  generated GLB models, thumbnails, plan symbols and credits
scripts        catalogue import and icon rendering
```
