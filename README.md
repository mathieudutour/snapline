# Cordeau

A web app for drawing floor plans where your measurements are **remembered as constraints**.
Named after the *cordeau*, the chalk line masons snap on the floor to lay out walls.
A project holds several floors and an optional roof, and you can keep several projects in the browser.

Most simple floor-plan tools let you type a wall length, apply it once, and forget it: the next time
you nudge a corner the value silently drifts and you have to re-check everything. Cordeau treats every
value you type as a rule. A small geometric constraint solver keeps those rules true while you keep
editing, and tells you when two rules cannot both hold.

## Features

- **Walls, doors and windows** drawn on a 2D plan with snapping to corners, walls, alignments and a 5 cm grid.
- **Furniture** from a catalogue of 117 models (beds, sofas, kitchen units, bathroom fixtures, office, lights) shown as top-view symbols in 2D and real models in 3D. Pieces dropped against a wall stay locked to it.
- **Constraints that stick**
  - wall length (lock it in the inspector, or ⌥ + click a dimension label and type a value)
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

## Deploying

Pushes to `main` run `.github/workflows/deploy.yml`: typecheck, tests and build, then a deploy to Cloudflare Workers with static assets, a D1 database for accounts and projects, a Durable Object per shared project for live sessions (created by the deploy itself), and an R2 bucket for imported models.

1. Create a Cloudflare API token with the Workers Scripts, Workers KV/D1 and R2 edit permissions, and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub Actions secrets.
2. Create a D1 database called `snapline` and put its id in `wrangler.jsonc` (the Cloudflare resources keep their original names; only the product is called Cordeau). The workflow applies the migrations in `worker/migrations`.
3. Create a Google OAuth client (web application) and add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as secrets. Register `https://<your worker>.workers.dev/auth/google/callback` as an authorised redirect URI.
4. Rate limits and caps are built in: sign-in, view links, invitations and live connections are held to 30 requests a minute per client, other API calls to 300, and an account can hold at most 200 projects and 100 imported models, a project at most 50 members. The limits use the Workers rate limiting binding declared in `wrangler.jsonc`; without it (local tests) they are off.
5. Enable R2 once in the Cloudflare dashboard (R2 → Get started; it asks for a payment method but the free tier covers this app). The workflow creates the `snapline-models` bucket itself. Until R2 is enabled the workflow deploys without the bucket binding and imported models stay in the browser they were imported in.

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
| Set a length | Select a wall and type its length in the inspector (the padlock next to it locks or unlocks it), or hold ⌥ (Option / Alt) and click the dimension label on the plan, type a value, Enter. The value is locked (padlock icon); untick "Lock as constraint" to resize once without locking. A plain click on a label just selects its wall. On a touchscreen, tapping a label opens the editor. Dimensions are measured face to face on the side they are drawn (outside of rooms), the way a tape measure reads them; door and window offsets are measured from the wall faces on the room side. |
| Move things | Drag corners, walls or openings, or nudge the selection with the arrow keys (Shift for 10×). Constraints are respected. |
| Select | Click, Shift+click to add, drag on empty space for a marquee, Ctrl/⌘+A for everything, or click rows in the Layers panel. Clicking a room's floor selects the room. |
| Edit several at once | When the selection is all walls, all doors/windows, all furniture or all rooms, the inspector shows their shared properties (thickness, height, finish, width, sill, elevation, rotation…). A field reading "Mixed" keeps each item's value until you type one; a change applies to every selected item as a single undo step. |
| Rooms | Click a room's floor (or its row in the Layers panel) to select it: the inspector shows its name, area, floor and wall finishes, and a button to select its walls. Double-clicking the floor renames it too. |
| Navigate | Scroll to pan, Ctrl/⌘+scroll or pinch to zoom, Space+drag to pan, `+`/`-`, Shift+0 (100%), Shift+1 (fit), Shift+2 (fit selection). The zoom readout in the inspector header fits the plan. |
| Join walls | Drop a corner onto another corner or onto a wall. |
| Doors / windows | `D` / `N`, then click on a wall. Select an opening to lock its distance from either wall end. |
| Furniture | `F` or the Furniture rail tab opens the catalogue in the left panel; click a piece, then click on the plan. `R` rotates. Dropping a piece against a wall snaps its back to the wall and locks the gap. |
| Stairs, floor openings, balconies | The Structures category of the catalogue. They are placed and moved like furniture (`R` rotates, dropping against a wall snaps to it). Stairs climb to the floor above (height set from the floor height and slab) and cut a stairwell in the slab above; a floor opening cuts the slab of its own floor; a balcony is a slab flush with the floor with a railing on its free sides. |
| Your own models | "Import…" in the catalogue takes a `.glb` or `.gltf` file, measures it (pick the file's units if the size looks wrong) and renders its plan symbol and thumbnail in the browser. Imported models live under "My models", are kept in the browser, and are copied to your account when signed in. Only import models you are allowed to use. |
| Underlay (trace a plan) | With nothing selected, Underlay → Import image or PDF (first page). Drag the image into place while unlocked, set its rotation and opacity, then Set scale: click two points a known distance apart and type the distance. Lock it and draw walls on top. The image is kept in the browser and copied to the account when signed in, so collaborators see it too. |
| Comments | `C` then click on the plan pins a comment; click a pin to read, reply, resolve or delete. Comments are part of the project, so collaborators see them (live too) and the Layers panel lists the open ones. |
| Measure between walls | Select a wall, hold ⌥ (Option / Alt) and hover another wall: the clear distance between their facing sides appears in red, like Figma. Parallel walls are measured across their overlap (or in front of the hovered wall with a dashed extension); other pairs show the shortest distance. |
| Relate two walls | Shift-click two walls, then choose parallel / perpendicular / equal / angle in the inspector. |
| Anchor a corner | Select a corner and click "Anchor in place" so the plan does not drift. |
| Floors | Floors list in the left panel: click to switch, `+` to add, hover a floor for duplicate / remove, double-click to rename; PageUp / PageDown switch floors. With nothing selected the inspector edits the floor's name and height. |
| Roof | With nothing selected, pick the roof type, pitch, ridge direction, overhang and colour in the inspector. |
| Export | Project menu → Export…: the plan as a PDF to scale (1:50, 1:100, 1:200 or fitted, A4/A3/Letter, one page per floor with a title block and a 1 m scale bar), as a PNG at a chosen resolution, the building as a glTF binary (.glb: walls with openings, floors, ceilings, roof, structures, furniture as boxes), or the project file to re-import. |
| Projects | The project name at the top of the left panel opens a menu (rename, import, export, delete); the Projects rail tab lists all projects. |
| Preferences | The Prefs rail tab: metric (m or cm) or imperial (feet and inches), grid snap, auto-lock, ghost of the floor below. |
| Sharing | Project menu → Share… invites people by the email of their Google account as editors or read-only viewers (the owner can change the role later); they see the project in their list. Owners remove people or delete the project; invited people can leave it. |
| View link | In the share dialog, "Anyone with the link can view" gives a `/view/…` link that opens the plan read-only, live, without an account (2D, 3D and walkthrough included). Turn it off to revoke the link. |
| Live collaboration | A shared project opens a live session: everyone in it sees the others' cursors, selections and edits as they happen (avatars in the inspector header show who is there). Edits travel as per-entity operations, so people can work on different parts of the plan at once; when two people change the same wall, the last change wins. Undo only undoes your own steps. |
| Diverging edits | Edits made while disconnected are merged on reconnect when nobody else saved in between. Otherwise (or when saving without a live session) a dialog asks whether to overwrite their version, keep both (your edits become a copy of your own), or discard yours. Projects you have not edited pick up other people's changes automatically (every 30 s and when the tab regains focus). |
| Finishes | Select a room to set its floor (oak, walnut, tiles, carpet, concrete…) and wall paint or tiles; with nothing selected, the Finishes section lists every room and sets the exterior wall and roof materials. Selecting a wall lets you override its finish. Textures are drawn procedurally and tile at real sizes; the 2D plan tints rooms by their floor. |
| Site and sun | With nothing selected, the Site section takes the building's latitude and longitude ("Use my location" fills them in) and the compass bearing of the top of the plan; a north arrow then shows on the 2D canvas. In 3D and walkthrough, pick the season (June solstice, equinox, December solstice) and drag the time of day to see where the real sun stands and how the shadows move; night dims the scene. |
| 3D / walkthrough | Switch with 2D / 3D / Walk in the inspector header. In 3D tick "Cut above" to look inside; the walkthrough runs on the floor selected in the Floors list. |

## Agents (WebMCP)

The editor registers a set of plan-building tools with the browser's WebMCP API (`navigator.modelContext`), so a browser agent or an extension that speaks WebMCP can build or edit the open project on the user's behalf: `get_plan`, `new_project`, `draw_room`, `draw_walls`, `add_opening`, `search_catalog`, `place_furniture`, `set_wall_length`, `name_room`, `delete`, `floor`, `set_roof`, `set_site`, `show`, `undo`. Coordinates are metres, x to the right and y down the plan. The same tools are available to scripts as `window.cordeau.tools.list()` and `window.cordeau.tools.call(name, input)`. Read-only projects refuse edits.

## Phones and tablets

On screens narrower than 900 px the side panels become drawers: the Layers and Furniture buttons open the left one, Inspect opens the right one. On the plan, one finger pans, two fingers pinch to zoom, a tap selects; the 3D view orbits with one finger and pans or zooms with two. The walkthrough needs a mouse and keyboard and is hidden on touch devices.

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
src/sync       API client, project sync and the live-collaboration connection
worker         Cloudflare Worker: Google sign-in, sessions, projects, sharing and models API, live rooms (Durable Object), D1 migrations, R2 files
public/furniture  generated GLB models, thumbnails, plan symbols and credits
scripts        catalogue import and icon rendering
```
