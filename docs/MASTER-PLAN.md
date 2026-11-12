# SurgeSpace master plan (agreed 11 Nov 2026)

Goal: a professional surge analysis product that matches the market-leading tool in engineering depth, is much simpler to use, and uses AI to do work no competitor does. **Scope: every feature of the market leader, nothing missing, plus the AI layer.**

## Agreed decisions

| Decision | Agreed |
|---|---|
| Scope | All phases below, including CAD/GIS plug-ins, live SCADA, water quality, skeletonisation and optimisation |
| Order | Phase 0 → AI release 1 → Phase 1 engine → Phase 3 workspace → Phase 5 integrations → Phase 4 |
| AI | **Bring your own AI account**, as in Engineering Workspace: the user picks a provider, pastes their own key; usage bills to them. Keys encrypted on the device. AI features carry an AI badge; without a key they show a connect card and every local feature keeps working |
| Providers | Anthropic, OpenAI, Google Gemini, Azure OpenAI, Mistral, DeepSeek, xAI, Groq, OpenRouter, Together, local models (Ollama, LM Studio) and any OpenAI-compatible endpoint |
| Data | Nothing is sent anywhere until the user connects an AI account and runs an AI task; only that task's data goes to the provider they chose |
| Customers | Consultants and contractors first (pumps, protection, reports), utilities second (GIS, SCADA, quality) |

## Principles
1. **The engine decides, AI assists.** Every number comes from the solver. AI builds, drives, explains and proposes; it never invents a result.
2. **Define once, use everywhere.** Each element field is described once (name, unit, default, limits, help, basic/advanced).
3. **One command layer.** Menus, canvas, tables, undo, scripts and AI change the model through the same commands, so every AI action is a normal undoable step.
4. **Simple first, depth on demand.**
5. **Prove it.** Every engine feature ships with a benchmark.

## Phases and slices (status)
Legend: [x] done and tested · [~] partly done, or written but not yet tested inside the host program · [ ] not started

### Phase 0 — Foundations
- [x] S0.1 Command registry (typed commands with parameter schemas, used by UI, scripts and AI)
- [x] S0.2 Element field schema (first version: used by AI tools and validation)
- [x] S0.3 Project file versioning and upgrade of old files
- [~] S0.4 Data sheets with every schema field and bulk edit of any schema field on a selection (done); the hand-built property groups stay (they carry previews and calculators); a separate central store was not needed — one project state with undo serves the canvas, panels, copilot and scripts
- [x] S0.5 Automated tests in CI for every engine and a click-through UI smoke test (menus, panels, dialogs, runs, Arabic) with Playwright

### Phase 2 — AI release 1 (brought forward)
- [x] S2.1 AI accounts: 13 providers, encrypted keys, test connection, AI badge and connect card
- [x] S2.2 Copilot panel: builds and edits models through the command registry, runs the engines, reads results; every step listed and undoable
- [x] S2.3 One-click AI tasks: explain results, review model, design protection, review daily operation, write the report narrative
- [x] S2.4 Read my documents: attach PDF or image; values extracted into the model for confirmation
- [x] S2.5 Voice input, conversation saved with the project, streaming replies (Anthropic, OpenAI-compatible, Gemini; falls back to whole answers)

### Phase 6 — Big-app finish and AI from documents (agreed 11 Nov 2026: polish, then visuals, then the documents workflow)
- [x] S6.1 Launch screen, start page (recent projects with pictures, last session, examples), one-minute tour, command palette (Ctrl+K), saved indicator, staged run screen with the envelope growing live
- [x] S6.2 Visuals: results sweep in after a run, vapour cavities on the drawing, drawing and long section linked by a probe, waterfall (3D) view, surge animation exported as a video, daily operation played on the drawing with tank levels
- [x] S6.3 Model from documents: drawings (PDF, images), spreadsheets and DXF read into an evidence register (AI with page boxes and the PDF text layer; spreadsheets by their headers without AI), review against the page, missing data asked for, model built from accepted evidence with a traced basis (report section 3.6), checks against the documents
- [x] S6.4 Air valve plan (AWWA M51 locations; sizes for draining and filling) tested in surge runs, anti-slam where valves slam; copilot command plan_air_valves and task "Plan the air valves"
- [x] S6.6 Plan reading made robust and checked on a real network (KY4: spatial index, bends kept in pipes, junctions where lines end, drawings in feet, TWL texts, pump orientation, network demand); networks from schedules and scanned plans (Net3 exact); pump curves digitised by hand on any graph (checked on a published curve); faster vessel sizing
- [x] S6.5 Networks from plan drawings (DXF pipe layers, symbols to devices, texts to levels and sizes, ends as sources or demands); pump curves from data sheets (tables or graphs, fitted and checked against the duty point); air vessel sized inside the documents workflow with the air valve plan in place

### Phase 1 — Engines to professional grade
- [x] Engine choice: wave engine (method of characteristics, column separation) and rigid-column engine (mass oscillation, slow events) — checked against Jaeger's surge-tank formula and against each other
- [x] S1.1 Four-quadrant pumps: generic characteristic from the pump curve, or the manufacturer's Suter data; reverse flow and reverse rotation
- [x] S1.2 Variable-speed drives with PI pressure control; motor start-up from torque–speed curves (direct on line, star–delta, soft starter) in both engines
- [x] S1.3 Extended-period simulation: storage tanks, demand and head patterns, simple and rule-based controls, surge run from any hour — matches EPANET 2.2 on Net1/Net2/Net3 and a rules network (heads within 0.04 m)
- [x] S1.4 Throttle, general-purpose and pressure-breaker valves (done, validated against EPANET); non-slam (three-stage) air valves; throttled tanks (in-/out-flow losses); variable-area surge tanks in both engines (done); differential (Johnson) surge tanks in both engines (done)
- [x] S1.5 Pipe forces for anchor and support design (checked against ρ·a·V·A)
- [x] S1.6 Turbines: speed governor (PI on speed, rate-limited gates); runner characteristics (Francis low/high specific speed, Kaplan, Pelton or a table) with the speed in the loop
- [x] S1.7 Viscoelastic pipe model (PE, PVC): Kelvin–Voigt creep, stable implicit coupling; damping and period lengthening checked (indicative HDPE values; calibrate per pipe)
- [x] S1.8 10,000-pipe networks (steady 2 s, surge in seconds at the default reach budget; `validation/large-network.ts`); cases run in parallel on spare cores
- [x] S1.9 Validation: EPANET, TSNet, benchmark and textbook checks run in CI; summary in `docs/THEORY-AND-VALIDATION.md`

### Phase 3 — Professional workspace depth
- [x] S3.1 Results of other cases overlaid on the profile; child cases stored as differences from a parent (inherit later parent changes; detach; files keep only the differences)
- [x] S3.2 Street / satellite / topographic basemaps from web tiles (UTM or Web Mercator, exact resampling); node elevations and long sections from terrain data
- [x] S3.3 GIS import with field mapping (GeoJSON); export to GIS (GeoJSON), CAD (DXF) and Excel (.xlsx results workbook)
- [x] S3.4 Queries and selection sets, colour-by themes, notes on the drawing, drawing to scale (SVG A3/A1 with title block)
- [x] S3.5 Libraries: pumps, valves, air valves, vessels, pipe types (generic air valves and pipe types included; export/import to share)
- [x] S3.6 Fix-it buttons and Fix all on health-check findings; New model wizard (pumped or gravity main from a long section, then run and size a vessel)

### Phase 5 — Integrations and utility features
- [~] S5.1 AutoCAD / BricsCAD plug-in (AutoLISP: SSEXPORT, SSRESULTS) — written, not yet tested inside AutoCAD
- [x] S5.2 MicroStation — through DXF (no plug-in needed); the DXF is read back by SurgeSpace and audited without errors by an independent reader (ezdxf) in CI
- [~] S5.3 QGIS plug-in — tested inside QGIS 3.34 (headless, in CI): export, import by SurgeSpace, results as graduated layers (done); ArcGIS Pro toolbox — written and syntax-checked, needs ArcGIS Pro (arcpy) to test
- [x] S5.4 Live SCADA: MQTT over WebSocket (tested against a real broker), OPC UA and Modbus TCP through the SurgeSpace data bridge (tested against local servers), historian CSV, tag mapping, set the model to the live state, compare the model with field data
- [x] S5.5 Water quality: age, source trace, chlorine (bulk and wall) — matches EPANET 2.2 (chlorine within 0.003 mg/L on Net1)
- [x] S5.6 Network skeletonisation (series merge with profile points kept; optional dead-end trimming)
- [x] S5.7 Optimisation: least-cost protection (vessels, air valves) with pipe pressure class or diameter selection, by genetic algorithm over full surge runs

### Phase 4 — AI release 2 and documentation
- [x] S4.1 Calibration: model vs field data statistics and automatic calibration of roughness (all pipes or per material) and demand
- [x] S4.2 Scenario scoping by AI (copilot task; creates the cases with create_case and set_operations)
- [x] S4.3 Script console (JavaScript over every command) and the command API reference (`docs/API.md`)
- [x] S4.4 User manual, theory and validation manual, tutorials (`docs/`); new sample Town supply
- [~] S4.5 Arabic report (done), Arabic interface for menus, ribbon and tabs with right-to-left layout and panel and dialog contents (done; long help sentences stay English); shared cloud projects (not yet: needs a hosted service and accounts)

## Slice log
- **Slice 1 (branch `v3-program`, 11 Nov 2026): Phase 0 S0.1–S0.3 + AI release 1 S2.1–S2.4.**
  - `src/app/commands.ts` — 24 commands with JSON schemas (get_model, build_line, add_pump_station, add_device, set_operations, run_analysis, get_results, size_air_vessel, …). Errors come back as plain messages; each change is one undo step.
  - `src/app/schema.ts` — field definitions for nodes, pipes, pumps, valves and devices (units, limits, help).
  - `src/app/project.ts` — file version 3; files from 1.x and 2.x open; newer files refused with a clear message. Open, Save, Recover and autosave use it.
  - `src/ai/providers.ts` — 13 providers over three wire formats (Anthropic, OpenAI-compatible, Gemini); tool use, PDFs and images; model list from the account; test connection.
  - `src/ai/accounts.ts` — keys encrypted with a non-exportable device key (AES-GCM in IndexedDB); consent stored.
  - `src/ai/agent.ts` — copilot loop (plans with the model, acts only through commands), one-click tasks (explain, review, protect, report), document reading prompt.
  - `src/ui/AIPanel.tsx` — AI accounts dialog; Copilot tab in the right pane (steps with results, stop, attach PDF/image/CSV, token count, "use in report"); AI menu and ribbon group.
  - Report: optional narrative (Markdown) before the summary, marked when drafted by AI; "Draft with AI" in the report dialog.
  - Desktop: AI requests use the native HTTP client (tauri-plugin-http) so providers without browser CORS and local servers work.
  - Tests: `tests/ai.test.ts` (41 checks: commands, file versions, all three wire formats with tool calls, error messages, agent loop, markdown, report narrative). All other suites pass; all examples identical to the baseline.

- **Slice 2 (branch `v3-program`, 11 Nov 2026): engines and integrations.** Extended-period simulation and water quality (`src/engine/eps.ts`, validated against EPANET 2.2 with WNTR references in `validation/data`); rigid-column engine (`src/engine/rigid.ts`); four-quadrant pumps and variable-speed drives; pipe forces; skeletonisation (`src/engine/skeleton.ts`); protection optimisation (`src/engine/optimise.ts`); live data (`src/app/live.ts`, `src/app/scada.ts`, `bridge/`); GIS/CAD exchange (`src/app/exchange.ts`) and plug-ins (`plugins/`); Daily operation and Live data tabs; new commands for the copilot; new example "Town supply". Tests: eps 25, fourq 10, rigid 8, phase5 23, forces 2, vsd 4 (all in CI).

- **Slice 3 (11 Nov 2026):** rule-based controls; PBV/GPV/TCV; viscoelastic pipes; parallel cases and a 10,000-pipe check; basemaps and terrain; Excel export; health fix-it buttons; element library; calibration; script console and API reference; AI scoping and create_case; voice input and saved conversation; Arabic report and interface; user and theory manuals.

- **Slice 4 (11 Nov 2026):** queries and selection sets, case overlays on the profile, turbine speed governor, variable-area surge tanks, notes on the drawing, drawing to scale, tutorials.

- **Hardening (11 Nov 2026):** tests on every push (`npm test` runs every test file; UI, large-model, QGIS and
  desktop jobs), a results baseline for every example, faster start (main bundle 984 → 628 kB), emitters and
  pressure-driven demand (EPANET 2.2, validated), rigid-column engine for large models (sparse Newton) with turbine
  characteristics and governor, independent ODE checks of the differential tank and motor start, the real desktop
  app driven end to end (WebDriver) including the copilot over the native HTTP client, demo builds by setting
  (`npm run build:demo`), version 3.0.0 and release notes (`docs/RELEASE-NOTES-3.0.md`).

- **Big-app finish and AI from documents (11 Nov 2026):** launch screen and start page (`index.html`,
  `src/ui/StartPage.tsx`, `src/app/recent.ts`), run screen with progress from the engine workers
  (`src/ui/RunScreen.tsx`), tour and palette (`src/ui/Tour.tsx`, `src/ui/Palette.tsx`); visuals in `Canvas.tsx`,
  `ProfileView.tsx`, `Waterfall.tsx`, video export and Play the day; model from documents (`src/app/intake.ts`,
  `src/ai/intakeAI.ts`, `src/ui/IntakeWorkspace.tsx`, pdf.js loaded only when a PDF is opened); air valve plan
  (`src/app/airValvePlan.ts`, worker job `avPlan`). Tests: `tests/intake.test.ts` (19), `tests/avplan.test.ts` (14),
  `tests/ui-intake.mjs` (18, interface end to end with a stand-in AI server), smoke test 33, desktop end to end.
  Then networks from plan drawings (`src/app/planNetwork.ts`, `tests/plan.test.ts` 15, `tests/ui-plan.mjs` 13 with
  the fixture `tests/fixtures/plan.dxf`), pump curves from data sheets (`fitPumpCurve`), vessel sizing in the
  protection step.

## Working method
Each slice: one feature with tests and benchmarks, on a branch, with a preview. No Store release until a phase's done criteria are met.
