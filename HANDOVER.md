# SurgeSpace: handover

Everything a new conversation (or developer) needs to continue SurgeSpace. No secrets are in this file.

## 1. What it is

SurgeSpace is a **water hammer / pressure surge (transient) analysis** app for pipelines and water networks, aimed at
engineers who would otherwise use Bentley HAMMER, AFT Impulse or similar. It runs in the browser and as a desktop app
(Windows from the **Microsoft Store only**, and Mac). The owner's other engineering app is *Engineering Workspace*
(engspace.app); SurgeSpace lives on the same domain but is **kept completely separate** (own licence server, database,
hostname). Never mix the two.

- Repository: `github.com/mohamed-abokhatwa/SurgeSpace` (branch `main`)
- Owner / commit identity: `git -c user.email=mohamed.abokhatwa@hotmail.com -c user.name="Mohamed"`
- Version: **2.0.x** (MSIX builds are `<major>.<minor>.<run>.0`; v1 builds were 1.0.x, the last 1.0.9.0). Tag `v2.0.0` builds 2.0.<run>.0.

## 1a. Version 2 workspace (branch `v2-workspace`)

The single-page app was rebuilt into a full desktop-style workspace. Engine results are unchanged (all 344 baseline
values identical; HAMMER Tnet0 exact).

- **Shell**: menu bar (File, Edit, View, Model, Analysis, Results, Tools, Help), tool ribbon, Model Explorer +
  Operations (left), Properties (right), results dock (Profile, Graphs, Design checks, Data sheets, Cases, Protection
  sizing, Uncertainty, Run log), status bar with live coordinates, units and run state. Light / dark themes.
- **Drawing canvas** (`src/ui/Canvas.tsx`): real map coordinates, world grid, snap, scale bar, north arrow,
  background picture (site plan / aerial). Tools for every element: draw pipes node-to-node with bends (Shift+click),
  click a pipe to split it or insert a pump / valve / device, drag nodes and bends, box select (Shift+drag),
  double-click a pipe to add a bend, right-click menus, undo / redo, duplicate, find.
- **Elements** (`src/app/elements.ts`, own names): Junction, Fixed-Level Source, Varying-Level Source (sine or time
  table), Pipe, Pump, Line Valve, Non-Return Valve, Pressure Reducer, Pressure Sustainer, Flow Limiter, Inline Orifice,
  Air Vessel, Air Valve, Open Standpipe, Feed Tank, Anticipator Valve, Relief Valve, Timed Blow-off, Burst Disc.
- **Operations**: any number per run (`Network.extraEvents`), each with its own pumps / valves and timing.
- **Cases**: named full-copy variants in the project file; run all and compare side by side.
- **Data sheets**: every element type and node / pipe results; sort, filter, edit, paste from Excel, CSV export.
- **Units**: SI / US with flow and pressure unit choice (`src/app/units.ts`); the model is always stored in SI.
- **Run Setup**: liquids catalogue (water 0–100 °C, sea water, brine, fuels) and site elevation feed the engine
  (`applyFluid` in `types.ts` sets density, vapour pressure, viscosity and atmospheric head per solve);
  design limits (max pressure cap), animation frames, element defaults.
- **Catalogues**: pipe materials, liquids, wave speed calculator (Korteweg with restraint, thick-wall correction).
- **Model Health Check** (`src/app/health.ts`) before every run; **Graph builder** for any element variable.
- **Hydro turbine** (`Valve.turbine`, `turbineSpeeds` / `turbineK` in `analysis.ts`): modelled through its wicket
  gates (a valve sized to pass the rated flow at the rated head); runner speed from the power balance after a load
  rejection (windage ~1 % rated); overspeed design check; example "Hydropower plant · load rejection".
- **Contours** (`src/app/contours.ts`): IDW grid masked to the network, marching squares (View → Contours).
- **Report in display units** (`ReportOptions.units`); device detail rows stay in SI.
- **Store builds**: the Windows job also force-pushes the MSIX to the `store-builds` branch, so it can be fetched
  with git when the Actions API is not reachable.
- Tests: `tests/workspace.test.ts` (33 tests: multi-operation runs, fluid/site, head schedule, editing operations,
  units, wave speed, health check).

## 2. Features

**Model and data**
- Network editor: nodes, pipes, pumps, valves; tables you can paste into from Excel; map with zoom and selection.
- Import: EPANET `.inp` (including check-valve pipes and PRV / PSV / FCV control valves), Excel/CSV tables,
  long-section profiles (chainage + level, nodes and air valves placed at high/low points), CAD DXF with levels.
- Export: EPANET `.inp`, envelopes as CSV, the detailed report (HTML/PDF), project files (`.surge.json`).
- Built-in examples (rising main with and without protection, gravity main, looped network, El-Hazek, BWSN-1 network).

**Events**
- Pump trip (power failure, inertia run-down), controlled stop (VFD ramp), **pump start** (speed ramp).
- Valve closure / opening by stroke time and law, or by an **operating curve** (time vs stroke, multi-stage closures).

**Engine** (`src/engine/transient.ts`, `steady.ts`)
- Steady state by the global gradient algorithm (as EPANET), including **control valves solved EPANET-style**
  (active / open / closed statuses inside one solve; 7 s on a 3,323-junction network).
- Method of characteristics on **exact geometry**: wave speeds adjusted ≤ 0.5 % (HAMMER's default tolerance 75 %),
  very short pipes as rigid columns.
- Column separation by the discrete gas cavity model (closed form), unsteady friction (Brunone–Vítkovský, Vardy),
  gas start-up equilibrium, pressure-dependent demands, implicit device boundaries solved together per node cluster
  (Newton with a flow-space fallback).

**Protection devices** (`src/engine/devices.ts`, editors in `src/ui/DeviceEditors.tsx`, `ValveEditors.tsx`)
- Hydropneumatic tank: vertical / horizontal / sphere, gas volume or **bladder pre-charge**, dip tube, connection pipe
  inertia, separate in/out losses or check valve with bypass, polytropic gas.
- Air valves: double-acting, three-stage anti-slam, vacuum breaker, release only, manufacturer curves; every orifice
  size and Cd editable; **Treat as junction** (kept on the drawing, left out of the run).
- Open surge tank (overflow, emptying), one-way feed tank, surge anticipation valve, pressure relief valve (by size),
  **rupture disk** and **timed discharge to atmosphere**.
- **Check valves** on pumps, valves and pipes: ideal, delay + closing time, reverse velocity, or the manufacturer's
  dynamic characteristic. **Check-valve slam and air-valve slam** are detected (a·v/g, peak pressure after) and flash
  on the map; listed in Checks, history and the report.
- Valve characteristics: gate (standard table), globe, ball, butterfly, needle (typical), manufacturer curve.
- **PRV / PSV / FCV** control valves, locked at their steady opening or active with a response time.

**Results and design**
- Animated map (surge / pressure / max / min / steady), long-section profile with envelopes, timeline, time histories
  (nodes, pumps, vessels, tanks, check valves, valves, discharges, air), slam table.
- Design checks (pipe class, minimum pressure, cavities, devices, slams), uncertainty envelope (wave speed, stroke,
  inertia, time step), automatic surge vessel sizing and air valve sizing.
- **Detailed report** (Report button / Engine tab): title page, summary, profile, all inputs, results for every node and
  pipe, devices and slams, checks, time histories; print / Save as PDF or download HTML (`src/report/report.ts`).

## 3. Licensing (separate from Engineering Workspace)

- Cloudflare Worker **`surgespace-licence`**, D1 database **`surgespace-licences`**, custom domain
  **surgespace-licences.engspace.app** (admin page, privacy and support pages). Code in `licence-server/`.
- Engineering Workspace uses Worker `engspace-licences` on lic.engspace.app: **never touch it**.
- Ed25519-signed keys; the app checks in daily and a key runs 60 days ahead. Evaluations stored by one-way hash; the
  first "more time" request gets +7 days automatically. Plans: Free (examples + own models ≤ 25 pipes), evaluation
  (14 days), licensed (exports, sizing, uncertainty, report).
- App side: `src/license/` (`publicKey.ts` holds the public key and `LICENCE_API`). A **demo build** for previews is made by
  temporarily blanking `PUBLIC_KEY`, building, then restoring it (never commit the blank key).
- Secrets (`licence-server/.dev.vars`, private key) are never committed.

## 4. Desktop and stores

- Tauri 2 shell (`src-tauri/`, identifier `app.engspace.surgespace`).
- GitHub Actions `.github/workflows/desktop.yml` (manual: Actions → Desktop builds → Run workflow): runs the tests, then
  builds the **MSIX** (artifact `SurgeSpace-MicrosoftStore`) and the Mac universal DMG.
- Microsoft Store: Store ID **9NFRBFGTQBSK**, package identity `EngineeringWorkspace.SurgeSpace`, publisher
  `CN=7383AB48-1669-4729-94F1-696779C5DEAF` (Engineering Workspace). MSIX version must end in `.0`; each upload must be
  higher than the last. Listing text and screenshots: `store/microsoft-store-listing.md`, `store/images/`.
- Mac: notarization uses App Store Connect API-key secrets in GitHub (waiting for the owner's Apple Developer account).

## 5. Accuracy and tests

Run everything: `bash scripts/full-check.sh <baseline.json> <reference folder> <TSNet networks folder>`
(last run: three rounds, identical output).

| Check | Result |
|---|---|
| `tests/engine.test.ts` | 10 closed-form tests (Joukowsky 0.05 %, 2L/a, column separation, junctions) |
| `tests/devices.test.ts` | 49 device tests against theory and balances |
| `tests/valves.test.ts` | 43 tests: valve curves, PRV/PSV/FCV, operating curve, pump start, check valves and slam = a·v/g, air-valve slam, outlets |
| `tests/report.test.ts` | report builds for every example with the right numbers |
| `tests/license.test.ts` | 60 licensing tests |
| `tests/workspace.test.ts` | 33 tests: v2 workspace, engine additions, turbine, contours, US-unit report |
| Examples vs baseline | 344 values identical |
| HAMMER Tnet0 / Tnet3 | exact / mean 1.6 m max, 0.8 m min, 92 % within 3 m |
| EPANET steady (Net3, ky4, Net6) | worst 0.012 m; control valves vs EPANET 0.005 m |
| TSNet Net3 | steady and first waves match |

Details and corrections made: `validation/README.md`.

## 6. Layout

```
src/engine/   types, hydraulics, steady (GGA + control valves), transient (MOC), devices, analysis (checks, sizing),
              prepare (pipe check valves, pump start), inp / importers, cases (examples)
src/ui/       map, profile, history, timeline, grids, device and valve editors, report dialog
src/report/   detailed report (HTML + SVG charts)
src/license/  licensing client, dialog, offline logic
licence-server/  Cloudflare Worker (licences, evaluations, admin)
src-tauri/    desktop shell
validation/   comparisons with HAMMER, EPANET, TSNet
store/        Microsoft Store listing and images
```

Commands: `npm install`, `npm run dev`, `npx tsc -b`, `npx tsx tests/<name>.test.ts`.

## 7. Open items

- Microsoft Store: submit 2.0.<n>.0 (from the `store-builds` branch or the Actions artifact) with the updated listing and the new screenshots (`store/microsoft-store-listing.md`, `store/images/`).
- The GitHub token pasted in chat (Nov 2026) should be revoked and replaced.
- Mac: add the Apple secrets to GitHub, then run Desktop builds for a notarized DMG; decide where to host it.
- Optional: Resend key for licence e-mail alerts.
- The Cloudflare token pasted in an old chat should be revoked and replaced.
- The preview page for testing: https://claude.ai/artifact/NqHhkbwFeYWJ6RBU99zYVW (demo build).
