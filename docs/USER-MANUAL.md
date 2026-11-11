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

Language: View → Language (English or العربية; the Arabic interface is right to left, with the menus, panels,
dialogs and report in Arabic). Units: Tools → Units (SI or
US customary; the model is always stored in SI). Every change can be undone (Ctrl+Z).

## 2. Building a model

- **Wizard:** File → New model wizard. Choose a pumped rising main or a gravity main, paste the long section
  (chainage, level), give the water levels, pipe size and material, the flow and the pumps or the valve. The wizard
  sets the wave speed from the material, the pump duty from the lift and friction, air valves at high points and a
  run length from the wave period, then (optionally) runs it and sizes an air vessel. Undo removes it.
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
protection, review daily operation, scope the surge cases, draft the report narrative. Speak instead of typing
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
| S, H, F | Select, pan, zoom to fit |
| Space, ← → | Play / pause, step through the animation |
