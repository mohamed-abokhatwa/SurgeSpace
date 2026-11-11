# SurgeSpace: handover

Everything a new conversation (or developer) needs to continue SurgeSpace. No secrets are in this file.

## 1. What it is

SurgeSpace is a **water hammer / pressure surge (transient) analysis** app for pipelines and water networks, aimed at
engineers who would otherwise use the established commercial transient tools. It runs in the browser and as a desktop app
(Windows from the **Microsoft Store only**, and Mac). The owner's other engineering app is *Engineering Workspace*
(engspace.app); SurgeSpace lives on the same domain but is **kept completely separate** (own licence server, database,
hostname). Never mix the two.

- Repository: `github.com/mohamed-abokhatwa/SurgeSpace` (branch `main`)
- Owner / commit identity: `git -c user.email=mohamed.abokhatwa@hotmail.com -c user.name="Mohamed"`
- Version: **2.0.x** (MSIX builds are `<major>.<minor>.<run>.0`; v1 builds were 1.0.x, the last 1.0.9.0). Tag `v2.0.0` builds 2.0.<run>.0.

## 1a. Version 2 workspace (branch `v2-workspace`)

The single-page app was rebuilt into a full desktop-style workspace. Engine results are unchanged (all 344 baseline
values identical; Tnet0 benchmark exact).

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

## 1b. Version 3 program (branch `v3-program`)
Plan and status: `docs/MASTER-PLAN.md` (agreed 11 Nov 2026). Slice 1 delivered the command layer, field schema, project
file versions and AI release 1 (bring-your-own AI account with 13 providers, copilot, one-click tasks, document reading,
report narrative). AI keys never leave the device except to the provider the user chose. Slice 2 added the extended-period
and water-quality engines (validated against EPANET 2.2), the rigid-column engine, four-quadrant pumps, variable-speed
drives, pipe forces, skeletonisation, protection optimisation, live SCADA data (MQTT; OPC UA and Modbus through `bridge/`),
GIS/CAD exchange and plug-ins (`plugins/`). Later slices added: differential surge tanks, motor start-up torque curves,
turbine runner characteristics, pipe class / diameter optimisation, child cases stored as differences, streaming copilot
replies, the New model wizard, Arabic panel contents, schema-driven data sheets and bulk edit, a Playwright click-through
test, the QGIS plug-in tested inside QGIS 3.34, and the DXF audited by ezdxf (all in CI). Status: `docs/MASTER-PLAN.md`.
Hardening: tests on every push, a results baseline for the examples, emitters and pressure-driven demand (validated
against EPANET 2.2), a sparse rigid-column solver for large models, independent ODE checks, and an end-to-end test of
the real desktop app (`tests/desktop-e2e.mjs`). Version 3.0.0; release notes in `docs/RELEASE-NOTES-3.0.md`.
Demo/preview builds: `npm run build:demo` (licence rules inside the app) — never edit the public key out of the source.
Open: ArcGIS Pro and AutoCAD plug-ins need testing inside those programs; shared cloud projects need a hosted service;
an Arabic-speaking engineer should review the Arabic terms; the copilot has been tested against simulated providers
and a local server, not live accounts; the v3 Store release has not been made (`v3-program` not yet merged or tagged).

## 1c. Big-app finish and AI from documents (v3-program, 11 Nov 2026)
- **Start-up and workspace**: launch screen in `index.html` (inline, kept at least 0.7 s, `src/app/boot.ts`), start page
  (`src/ui/StartPage.tsx`; recent projects in IndexedDB via `src/app/recent.ts`), tour (`src/ui/Tour.tsx`), command
  palette Ctrl+K (`src/ui/Palette.tsx`), run screen fed by progress from the engine workers (`src/ui/RunScreen.tsx`).
- **Visuals**: results sweep, vapour bubbles, drawing–profile probe (`Canvas.tsx`, `ProfileView.tsx`), waterfall
  (`Waterfall.tsx`), video export (File menu, MediaRecorder), Play the day in Daily operation.
- **Model from documents**: `src/app/intake.ts` (reading files: pdf.js renders pages and their text layer, images,
  Excel/CSV, DXF layers/blocks/texts; header rules for spreadsheets; evidence and gaps; basis with trace; build via the
  wizard; checks against the documents), `src/ai/intakeAI.ts` (one tool, `record_evidence`, per page: whole page plus
  four quadrants and the exact PDF text), `src/ui/IntakeWorkspace.tsx` (Documents → Review → Missing data → Build and
  check → Protection). The basis is stored as `Network.sources` and printed in the report (3.6).
- **Air valve plan**: `src/app/airValvePlan.ts` (AWWA M51 locations, sizes for draining and filling, apply by
  splitting pipes, surge test with anti-slam conversion), worker job `avPlan`, copilot command `plan_air_valves`.
- Tests: `tests/intake.test.ts`, `tests/avplan.test.ts`, `tests/ui-intake.mjs` (interface end to end with a stand-in
  AI server; fixture `tests/fixtures/long-section.pdf` from `make-long-section.py`), desktop end to end extended
  (launch screen under the CSP, PDF through pdf.js in the desktop app, page read by the AI through the native client).
- Next ideas: multi-line networks from plan drawings (DXF geometry plus symbols), pump curves read from graphs,
  vessel optimisation inside the documents workflow.

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
- Method of characteristics on **exact geometry**: wave speeds adjusted ≤ 0.5 % ,
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
- App side: `src/license/` (`publicKey.ts` holds the public key and `LICENCE_API`). A **demo build** for previews: `npm run build:demo`
  (sets `VITE_LICENCE_DEMO=1`, output `dist-demo`); never blank or commit a blank `PUBLIC_KEY`.
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
| Benchmarks Tnet0 / Tnet3 | exact / mean 1.6 m max, 0.8 m min, 92 % within 3 m |
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
validation/   comparisons with published benchmarks, EPANET, TSNet
store/        Microsoft Store listing and images
```

Commands: `npm install`, `npm run dev`, `npx tsc -b`, `npx tsx tests/<name>.test.ts`.

## 7. Open items

- Microsoft Store: 2.0.10.0 failed certification on 9 Nov 2026 (policy 10.8.2: licences sold outside the Store need the "purchases without Store commerce" declaration in Properties). Fixed by ticking that declaration; all mentions of the competitor product name were removed from the app, listing and repo; resubmitted as 2.0.11.0.
- The GitHub token pasted in chat (Nov 2026) should be revoked and replaced.
- Mac: add the Apple secrets to GitHub, then run Desktop builds for a notarized DMG; decide where to host it.
- Optional: Resend key for licence e-mail alerts.
- The Cloudflare token pasted in an old chat should be revoked and replaced.
- The preview page for testing: https://claude.ai/artifact/NqHhkbwFeYWJ6RBU99zYVW (demo build: `npm run build:demo`, publish `dist-demo`).
