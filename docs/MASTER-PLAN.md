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

### Phase 0 — Foundations
- [x] S0.1 Command registry (typed commands with parameter schemas, used by UI, scripts and AI)
- [x] S0.2 Element field schema (first version: used by AI tools and validation)
- [x] S0.3 Project file versioning and upgrade of old files
- [ ] S0.4 Central state store; properties and data sheets generated from the schema
- [ ] S0.5 Automated click-through tests in CI; benchmark harness on every change

### Phase 2 — AI release 1 (brought forward)
- [x] S2.1 AI accounts: provider registry, encrypted keys, test connection, AI badge and connect card
- [x] S2.2 Copilot panel: builds and edits models through the command registry, runs the engine, reads results; every step listed and undoable
- [x] S2.3 One-click AI tasks: explain results, review model, design protection, write the report narrative
- [x] S2.4 Read my documents: attach PDF or image (datasheet, long section, table); values extracted into the model for confirmation
- [ ] S2.5 Voice input; streaming replies; conversation history saved with the project

### Phase 1 — Engine to professional grade
- [ ] S1.1 Four-quadrant pump characteristics (by specific speed and user data); reverse flow and rotation; pumps without check valves
- [ ] S1.2 Motor start-up torque curves; variable-speed drives with PID control
- [ ] S1.3 Storage tanks with real levels; demand patterns; controls; extended-period hydraulics; surge run from any time of day
- [ ] S1.4 Throttle, general-purpose and pressure-breaker valves; slow-closing / non-slam air valves; throttled, differential and variable-area surge tanks
- [ ] S1.5 Pipe forces for anchor and support design
- [ ] S1.6 Turbines: four-quadrant characteristics, governor, load rejection/acceptance
- [ ] S1.7 Viscoelastic pipe model (PE, PVC)
- [ ] S1.8 10,000+ pipe networks in the background; parallel case runs
- [ ] S1.9 Validation Book generated from the benchmarks

### Phase 3 — Professional workspace depth
- [ ] S3.1 Cases as differences from a parent; results overlaid between cases
- [ ] S3.2 Underlays: CAD, GIS layers, street/satellite map; elevations from terrain data
- [ ] S3.3 GIS / Excel import with field mapping; export to GIS, Excel, CAD
- [ ] S3.4 Selection sets, queries, annotations, colour themes, printing to scale
- [ ] S3.5 Libraries: pumps, valves, air valves, pipe classes (shareable)
- [ ] S3.6 Guided mode and wizards; "fix it" buttons on warnings

### Phase 5 — Integrations and utility features
- [ ] S5.1 AutoCAD plug-in (.NET): draw / sync the network, results back as layers
- [ ] S5.2 MicroStation plug-in
- [ ] S5.3 ArcGIS Pro add-in (and QGIS plug-in): sync network and results with the GIS
- [ ] S5.4 Live SCADA: OPC UA, MQTT, Modbus TCP and historian CSV; live pressures on the drawing; boundary conditions from SCADA
- [ ] S5.5 Water quality: age, source trace, chlorine decay (extended-period)
- [ ] S5.6 Network skeletonisation
- [ ] S5.7 Optimisation: protection device sizing and pipe/class selection by genetic algorithm

### Phase 4 — AI release 2 and documentation
- [ ] S4.1 Calibration from field pressure-logger data
- [ ] S4.2 Scenario scoping by AI
- [ ] S4.3 Scripting console and open API
- [ ] S4.4 User manual, theory manual, tutorials, samples
- [ ] S4.5 Arabic interface and reports; shared cloud projects

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

## Working method
Each slice: one feature with tests and benchmarks, on a branch, with a preview. No Store release until a phase's done criteria are met.
