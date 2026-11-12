# SurgeSpace user manual

SurgeSpace analyses water hammer (hydraulic transients) and the daily operation of water systems: pump trips and
starts, valve operations, surge protection, tank levels, pressures through the day and water quality. This manual
follows the order of a typical study.

## 1. The workspace

| Area | What it holds |
|---|---|
| Menu bar | File, Edit, View, Model, Analysis, Results, Tools, AI, Help |
| Ribbon | Project, Edit, Network, Links, Surge protection, AI and Analysis buttons |
| Left pane | **Explorer** (every element by type), **Operations** (what happens in the surge run), **Library** (saved element types) |
| Drawing | The network on a grid, a background picture or a street/satellite map; results coloured on the pipes |
| Right pane | **Properties** of the selected elements, **Copilot** (AI) |
| Results dock | Profile, Graphs, Design checks, Data sheets, Cases, Protection sizing, Uncertainty, Daily operation, Live data, Run log |

Start: SurgeSpace opens on the **start page**: new model, wizard, model from documents, open or import, your recent
projects (with a picture of each), the last session and the examples. File → Start page brings it back; untick
"Show this page when SurgeSpace starts" to go straight to the workspace. Help → Take the tour gives a one-minute
tour of the workspace. **Ctrl+K** opens the command palette: every menu command, element and setting by name.

Language: View → Language (English or العربية; the Arabic interface is right to left, with the menus, panels,
dialogs and report in Arabic). Units: Tools → Units (SI or
US customary; the model is always stored in SI). Every change can be undone (Ctrl+Z).

## 2. Building a model

- **Wizard:** File → New model wizard. Choose a pumped rising main or a gravity main, paste the long section
  (chainage, level), give the water levels, pipe size and material, the flow and the pumps or the valve. The wizard
  sets the wave speed from the material, the pump duty from the lift and friction, air valves at high points and a
  run length from the wave period, then (optionally) runs it and sizes an air vessel. Undo removes it.
- **Model from documents (AI):** start page → Build from drawings with AI, or AI → Model from documents. Five
  steps:
  1. *Documents*: drop the drawings (PDF or images), long sections, pump data sheets, spreadsheets (Excel/CSV) and
     DXF. Spreadsheets with chainage/level, pipe (from, to, length) or pump curve (flow, head) columns are read at
     once without AI; drawings and other files are read by your AI account (Read with AI). Each PDF page is sent as
     images plus its exact text, so numbers on vector drawings are read exactly.
  2. *Review*: every item read (long-section points, reservoirs and tanks, pumps, pipe data, valves, air valves,
     washouts, design data) is listed with its source — file, page and box on the page, or the cell — and a
     confidence. Click an item to see its box on the page; accept, edit or reject it. Accept all with confidence
     ≥ 70 % for a quick pass.
  3. *Missing data*: what the documents do not give is asked for (critical items first). Answer, use the typical
     value (then listed as an assumption), or add the data sheet and the AI reads it.
     A pump curve on a data sheet — a table, or a graph the AI reads point by point — is fitted and used in the
     model, and checked against the stated duty point. Without AI, **Digitise a pump curve** on any page: click two
     labelled points on each axis and give their values (flow in L/s, m³/h, US gpm or m³/s; head in m, ft, bar or
     kPa), then click along the curve.
  4. *Build and check*: choose **Single main from the long section** or, when a plan drawing (DXF) is among the
     documents, **Network from the plan drawing**. For a plan: tick the pipe layers (guessed from the layer names,
     or given by the AI), say what each symbol block is (air valve, line valve, check valve, pump, reservoir, tank,
     washout, hydrant — guessed from the block names, or given by the AI), and Read the plan. Lines become pipes
     (lines ending on another line are joined there), symbols become devices where they sit, texts next to the
     lines give levels (IL, CL, RL; GL less 1.2 m cover) and sizes (DN…), and missing levels are filled in from the
     neighbours. Drawings in feet (US) are recognised from the header or from sizes written in inches; their levels
     are read in feet. Tanks and reservoirs take their water level from a TWL/WL text next to the symbol. Then set
     each open end as a source (with its water level), a demand or a closed end, give the network demand to spread by
     pipe length if the drawing has none, and build. Pumps are turned to lift from the lower source, non-return
     valves to the flow.
     **Network from schedules or a scanned plan**: node schedules (id, x, y, level, demand, type) and link schedules
     (id, type, from, to, length, diameter, roughness, status) are read from Excel/CSV without AI; a scanned plan is
     read by the AI junction by junction and pipe by pipe. Lengths written are used; the others are measured on the
     plan at the scale the written lengths give.
     For a single main: the basis of the model is shown with the source of every value (green from a document, blue
     entered by you, orange assumed). Build the model, then the checks compare it with the documents: flow against
     the design flow, steady pressure along the line (a high point above the grade line is flagged), pressure class
     and velocity. Air valves shown on the drawings are placed at their chainage.
  5. *Protection*: an air valve plan following AWWA M51 practice — high points, decreases in upward slope and
     increases in downward slope, long runs (600 m spacing), the pump discharge and points above the steady grade
     line — each sized so the inflow at 35 kPa vacuum passes the gravity draining flow and the outflow at 14 kPa
     the filling flow. On a network the plan covers the mains from a chosen size (DN250 by default). Test the plan in surge runs: before and after (lowest pressure, largest vapour cavity, air
     valve slams); valves that slam become anti-slam (three-stage). For a pumped system, Size the air vessel finds
     the smallest vessel at the pump discharge that keeps every point above the minimum pressure and within class,
     with the plan in place. Open the model with the plan and the vessel.
  The documents session stays while the app is open. The basis of the model appears in the report (section 3.6).
- **Draw:** place a Fixed-Level Source (R), pick Pipe (P) and click from point to point; Shift+click adds bends.
  Click a pipe with a pump, valve or device tool to insert it there.
- **Import:** File → Import (EPANET .inp with tanks, patterns, controls and rules; spreadsheets of nodes and pipes; a
  long section; DXF), File → Import GIS layer (GeoJSON from QGIS, ArcGIS or any GIS — field names are matched).
- **From a description:** ask the Copilot, for example "Build a 5 km DN600 rising main from the sump at 95 m to a tank
  at 147 m with a high point of 146 m at 2.6 km, two pumps 250 L/s at 74 m". Attach a PDF data sheet or drawing to
  have its values read.
- **Map and terrain:** View → Map and terrain. Choose the coordinate system (UTM zone), place a street, satellite or
  topographic map under the model, and take node elevations or pipe long sections from terrain data (10–30 m
  accuracy: use survey levels for design).
- **Library:** save a pump, valve, air valve, vessel or pipe type once and apply it to any selection; generic air
  valves and typical pipe types are included; export the library as a file to share it.
- **Model Health Check** (Analysis menu or ribbon) lists problems with the element they concern; most have a fix
  button, and Fix all applies every suggested fix in one undo step.

## 3. Elements

| Element | Key data |
|---|---|
| Fixed-level source | Water level; optionally a head schedule (tide, upstream station) or, for daily operation, a storage tank (levels, diameter) |
| Junction | Elevation, demand (with a pattern for daily operation), emitter (leakage, sprinkler, hydrant: Q = C·p^γ), protection devices |
| Pipe | Length, internal diameter, roughness (ε or C), wave speed (calculator in Tools → Catalogues), pressure class, long section, non-return valve, viscoelastic creep (PE/PVC) |
| Pump | Head curve (shut-off, duty, run-out), efficiency, speed, inertia (Thorley estimate offered), non-return valve, variable-speed drive holding a pressure, four-quadrant behaviour (generic or Suter data), motor start (direct on line, star–delta or soft starter, with a torque–speed curve) |
| Valve | Diameter, loss, opening, characteristic (gate, globe, ball, butterfly, needle or manufacturer curve), check valve; control types PRV, PSV, FCV; pressure-breaker and general-purpose valves |
| Turbine | Rated head and flow, efficiency, speed, inertia (load rejection and acceptance), speed governor, runner characteristic (Francis, Kaplan, Pelton or a table: flow and efficiency change with speed) |
| Protection devices | Air vessel (shape, bladder, dip tube, inlet bypass), air valves (double, three-stage anti-slam, vacuum breaker, release-only, manufacturer curves), surge tank (plain, variable area or differential with riser and ports), feed tank, anticipator valve, relief valve, blow-off, burst disc |

## 4. Surge analysis

While the analysis runs, the run screen shows its stages (steady state, surge run, design checks) and the pressure
envelope growing along the main line; Cancel stops it. After the run the results sweep along the pipes; vapour
cavities show as bubbles on the drawing; moving the mouse over the long section marks the same point on the
drawing and the other way round. Profile → Waterfall (3D) stacks the pressure along the route over time. File →
Export surge animation (video) records about 20 seconds of the animation as a WebM film. In Daily operation, Play
the day colours the drawing hour by hour with the tank levels.


1. **Operations** (left pane): pump trip, controlled stop or start, valve closure or opening (linear, by exponent or
   by a stroke curve), turbine load rejection or acceptance. Several operations can run in one case.
2. **Run Setup** (Analysis): simulation time, friction, surge engine, liquid and site elevation, accuracy, design
   limits, units, element defaults.
   - *Wave engine* (default): method of characteristics with column separation (discrete gas cavity model) and
     unsteady friction. Use it for every fast event.
   - *Rigid-column engine*: incompressible water columns. Use it for slow operations, surge tank and vessel mass
     oscillation, long runs and quick screening. It handles models of thousands of pipes.
   - *Demand model*: demand-driven (demands always met) or pressure-driven (EPANET 2.2: a junction gets its full demand
     above the required pressure and none below the minimum), for the steady state and daily operation.
3. **Run** (F5). Results: the map coloured by maximum, minimum or steady pressure, or animated; the long-section
   profile with envelopes, vapour pressure and pipe class; graphs at any element; result tables; design checks with
   the element at fault; the run log.
4. **Protection:** size an air vessel or air valves automatically (Protection sizing), let the genetic algorithm find
   the least-cost set of devices — optionally choosing the pipe pressure classes or diameters at the same time
   (Analysis → Optimise protection and pipe classes / diameters) — or ask the Copilot to design the protection.
5. **Uncertainty:** re-runs with wave speed ±10 %, stroke ±20 %, inertia ±15 % and a finer step at column separation,
   and reports the worst case.
6. **Cases:** keep variants side by side (with/without a vessel, closure times, one or two pumps…). Run all cases
   compares them in one table; the cases run in parallel on the spare processor cores. A **child case** keeps only
   its own changes: a correction made later in its parent (a pipe length, a pump curve, the run setup) flows into it
   unless the child changed that same property. Detach turns it into an independent copy.

## 5. Daily operation (extended period) and water quality

Results dock → Daily operation.
- **Tanks:** turn fixed-level sources into storage tanks (levels above the bottom, diameter).
- **Patterns:** demand multipliers per step (a typical residential day is offered); assign them to junctions or set
  a default pattern.
- **Controls:** switch pumps, pipes and valves at a time, every day at a clock time, or when a tank level or a node
  pressure passes a value; rule-based controls (IF / AND / OR / THEN / ELSE / PRIORITY) in EPANET syntax.
- **Quality:** water age, trace from a source, or a reacting chemical (chlorine: bulk and wall decay; boosters).
- **Results:** tank levels, pump flows, pressures and quality at selected nodes, energy per pump, events; the map
  coloured by pressure, demand or quality at any hour; **Surge run from this hour** creates a case with the levels,
  demands and pump states of that hour.

## 6. Live and field data

Results dock → Live data.
- **Live:** an MQTT broker over WebSocket, or the SurgeSpace data bridge (`bridge/`) for OPC UA servers and Modbus
  TCP devices. Read only: SurgeSpace never writes to the plant.
- **Tag mapping:** link each tag to an element and quantity, with scale and offset to SI.
- **Set model to live state:** source and tank levels, pumps running and speeds from the latest values.
- **Historian CSV:** compare the daily-operation model with field records (bias, RMS, correlation), use a measured
  level as a source's head during a surge run, and calibrate roughness (all pipes or per material) and demand.

## 7. Reports and exchange

- **Data sheets** list every element type, and “· all fields” sheets show every field of pipes, pumps and valves
  (drives, starters, four-quadrant, creep, set points); with several elements selected, Properties → Set any field
  on the selection changes one field on all of them.
- **Detailed report** (File or ribbon): title page, AI-assisted narrative (optional), summary, input data, results
  by node and pipe, pipe forces, protection devices and slams, checks, time histories; English or Arabic; print to
  PDF or save as HTML.
- **Export:** EPANET .inp (with daily-operation data), GeoJSON with results, DXF with result layers, Excel workbook
  with all tables and time histories, envelope CSV.
- **Plug-ins** (`plugins/`): QGIS, ArcGIS Pro (Python toolbox), AutoCAD/BricsCAD (AutoLISP); MicroStation through DXF.

## 8. AI copilot

AI → AI accounts: connect your own account (Anthropic, OpenAI, Google, Azure, Mistral, DeepSeek, xAI, Groq,
OpenRouter, Together, or a free model on your computer with Ollama or LM Studio). Keys are encrypted on the device.
Nothing is sent until you ask. Replies appear as they are written. The copilot works only through SurgeSpace commands, so every change is an undo step
and every number comes from the engines. One-click tasks: explain the results, review the model, design the
protection, plan the air valves (plan_air_valves: locations, sizes and a surge test), review daily operation,
scope the surge cases, draft the report narrative. Speak instead of typing
where the system offers speech recognition.

## 9. Automation

Tools → Script console: JavaScript with `await ss.<command>({…})` for every command (see `docs/API.md`), `log()` and
`table()`. Example: a study of closure times in four lines.

## 10. Keyboard

| Key | Action |
|---|---|
| Ctrl+N / O / S | New, open, save |
| F5 or Ctrl+Enter | Run |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Ctrl+A, Ctrl+D, Del | Select all, duplicate, delete |
| Ctrl+F | Find element |
| Ctrl+K | Command palette |
| S, H, F | Select, pan, zoom to fit |
| Space, ← → | Play / pause, step through the animation |
