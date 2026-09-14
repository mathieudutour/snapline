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

| Action | How |
| --- | --- |
| Tools | `V` select, `W` wall, `D` door, `N` window, `H` hand. Esc returns to Select. |
| Draw walls | `W`, then click corner after corner. Enter, Esc or right-click ends the chain. Close a loop to create a room. Shift constrains to 45°, Ctrl/⌘ disables snapping. |
| Set a length | Click the dimension label of a wall, type a value, Enter. The value is locked (padlock icon). Untick "Lock as constraint" to resize once without locking. |
| Move things | Drag corners, walls or openings, or nudge the selection with the arrow keys (Shift for 10×). Constraints are respected. |
| Select | Click, Shift+click to add, drag on empty space for a marquee, Ctrl/⌘+A for everything. |
| Navigate | Scroll to pan, Ctrl/⌘+scroll or pinch to zoom, Space+drag to pan, `+`/`-`, Shift+0 (100%), Shift+1 (fit), Shift+2 (fit selection). |
| Join walls | Drop a corner onto another corner or onto a wall. |
| Doors / windows | `D` / `N`, then click on a wall. Select an opening to lock its distance from either wall end. |
| Furniture | `F`, pick a piece in the panel, click to place. `R` rotates. Dropping a piece against a wall snaps its back to the wall and locks the gap. Drag the handle to rotate, or set sides and gaps in the panel. |
| Relate two walls | Shift-click two walls, then choose parallel / perpendicular / equal / angle in the side panel. |
| Anchor a corner | Select a corner and click "Anchor in place" so the plan does not drift. |
| Floors | Use the strip at the top left of the canvas: switch, add, duplicate, rename (double-click) or remove floors; PageUp / PageDown switch floors. With nothing selected the side panel edits the floor's name and height. |
| Roof | With nothing selected, pick the roof type, pitch, ridge direction, overhang and colour in the side panel. |
| Projects | Click the project name in the toolbar to switch, create, rename, import, export or delete projects. Old single-plan saves are migrated automatically. |
| 3D / walkthrough | Use the tabs at the top. All floors and the roof are shown; tick "Cut above current floor" to look inside. In the walkthrough click to capture the mouse, move with WASD or arrows, Shift to run, Esc to release. The walkthrough runs on the floor selected in the strip. |

## Accounts and sync (Cloudflare)

The app works entirely in the browser, but it can also run on Cloudflare Workers with Google sign-in so
projects are saved to an account and available on other devices. The Worker in `worker/` serves the built
app, handles the Google OAuth flow itself (authorization code with PKCE, ID token verified against
Google's published keys) and keeps users, sessions and projects in a D1 database. Sessions are random
tokens stored hashed, sent as an `HttpOnly`, `SameSite=Lax` cookie; mutations require a matching `Origin`.

Nothing else is stored: no passwords, no emails sent. On the Workers free plan this costs nothing at hobby
scale; the paid plan is $5/month.

### Deploy, step by step

You need a Cloudflare account (free plan is enough), a Google Cloud project, and this repository on GitHub.

**1. Create the database (once)**

```sh
npm install
npx wrangler login                 # opens the browser
npx wrangler d1 create snapline    # prints a database_id
```

Paste the printed `database_id` into `wrangler.jsonc` and commit it. The id is an identifier, not a secret.

**2. Create the Google OAuth client (once)**

In the Google Cloud Console go to APIs & Services → Credentials → Create credentials → OAuth client ID,
type "Web application". You will add the redirect URI after the first deploy (step 5). If the consent
screen is not configured yet, configure it as "External" and add your own account as a test user, or
publish it.

Keep the client id and client secret at hand.

**3. Create a Cloudflare API token (once)**

Cloudflare dashboard → My Profile → API Tokens → Create Token → use the "Edit Cloudflare Workers"
template, then add the permission `Account → D1 → Edit`. Also note your Account ID (Workers & Pages
overview, right-hand column).

**4. Add the GitHub secrets (once)**

Repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account id |
| `GOOGLE_CLIENT_ID` | from step 2 |
| `GOOGLE_CLIENT_SECRET` | from step 2 |

**5. Push to `main`**

`.github/workflows/deploy.yml` runs typecheck, tests and the build on every push and pull request. On a
push to `main` it also applies `worker/schema.sql` to D1 (safe to re-run), uploads the Google secrets to
the Worker, deploys, and hits `/api/me` on the new deployment as a smoke test. The URL appears on the
workflow run and under Environments → production.

The first deploy gives you `https://snapline.<your-subdomain>.workers.dev`. Go back to the Google OAuth
client and add `https://snapline.<your-subdomain>.workers.dev/auth/google/callback` as an authorised
redirect URI. Sign-in works from then on; no redeploy needed.

**6. Optional: custom domain**

Cloudflare dashboard → Workers & Pages → snapline → Settings → Domains & Routes → add your domain. Then
add `https://<your-domain>/auth/google/callback` to the Google client as well.

**Deploying by hand instead**

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run db:migrate
npm run deploy
```

### Local development with sign-in

```sh
cp .dev.vars.example .dev.vars   # fill in the Google client id and secret
npm run db:migrate:local
npm run build && npm run dev:worker   # http://localhost:8787 serves the built app + API
```

Or run `npm run dev` (Vite with hot reload) alongside `npm run dev:worker`: Vite proxies `/api` and
`/auth` to the Worker. Without a Worker the app simply stays in local-only mode.

### How sync works

Projects are always saved in the browser. When signed in, every change is also pushed to the account a
second later, and on start-up the local and remote project lists are merged: a project missing on one
side is copied over, and when both have it the more recently updated copy wins.

## How the solver works

Every corner contributes two variables (x, y) and every opening one (its offset along the wall).
Each constraint contributes a residual function that is zero when the constraint holds. The plan is
solved with a small Levenberg–Marquardt least-squares solver (`src/model/solver.ts`) in two phases:

1. Pull towards what the user asked for (the cursor while dragging, or a new constraint value), with a
   weak pull of every other point towards where it currently is so the nearest layout wins.
2. Drop the drag pull and polish onto the exact constraint manifold.

Constraints whose residual is still above tolerance after phase 2 are reported as conflicting.

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
