# SurgeSpace 3.0 — release notes

## For the Store listing ("What's new in this version")

SurgeSpace 3.0 adds daily operation and water quality, a second surge engine, an AI copilot that works with your own
AI account, live plant data, GIS and CAD links, and an Arabic interface.

- Model from documents: drop drawings, long sections, data sheets, spreadsheets or DXF; your AI reads them into
  items you check against the page, SurgeSpace asks for what is missing, builds the model, checks it against the
  documents, plans the air valves (AWWA M51 practice), tests the plan in surge runs and sizes the air vessel.
  Plan drawings (DXF) become networks; pump curves are read from data sheets, tables or graphs.
- A new start page with recent projects, a staged run screen with the envelope growing live, a one-minute tour, a
  command palette (Ctrl+K), results that sweep in, vapour cavities on the drawing, a waterfall (3D) view, and the
  surge animation exported as a video.
- Daily operation (extended period): storage tanks, demand patterns, pump and valve controls, rule-based controls,
  leakage and pressure-driven demand, water age, source tracing and chlorine — checked against EPANET 2.2.
- Two surge engines: the wave engine (method of characteristics with column separation) and a rigid-column engine
  for slow events and surge tank oscillation, now for models of thousands of pipes.
- New devices: four-quadrant pumps, variable-speed drives holding a pressure, motor starters (direct on line,
  star–delta, soft starter), differential and variable-area surge tanks, turbine governors and runner types,
  pressure-breaker and general-purpose valves, viscoelastic plastic pipes.
- Design tools: least-cost protection by genetic algorithm (vessels, air valves, pipe classes or diameters), model
  skeletonisation, calibration to field data, pipe forces for thrust blocks, a New model wizard.
- AI copilot: connect Anthropic, OpenAI, Google, Azure, Mistral, DeepSeek, xAI, Groq, OpenRouter, Together or a free
  local model; replies stream as they are written; every change is an undo step and every number comes from the
  engines.
- Live data: MQTT, OPC UA and Modbus (through the SurgeSpace data bridge), historian files, set the model to the live
  state.
- Exchange: EPANET files with daily-operation data, GeoJSON, DXF, Excel results workbook, drawings to scale; QGIS,
  ArcGIS Pro and AutoCAD plug-ins.
- Cases that inherit from a parent case, Arabic interface and report, faster start-up.

## Engineering changes since 2.0

| Area | Change | Checked by |
|---|---|---|
| Extended period | New engine: tanks, patterns, controls, rules, quality (Lagrangian) | EPANET 2.2 on Net1/2/3 (heads 0.04 m, chlorine 0.003 mg/L) |
| Demands | Emitters (leakage) and pressure-driven demand (EPANET 2.2 model) in every engine | EPANET 2.2 over 24 h (heads 0.008 m, demands 0.005 L/s) |
| Rigid-column engine | New; sparse Newton solve for large models | Jaeger; wave engine; SciPy ODE (0.03 %) |
| Differential surge tank | New, both engines | SciPy ODE: upsurge equal to 0.01 % |
| Motor start | Torque–speed curves and starters, both engines | SciPy ODE: rigid 0.03 %, wave 1.2 % |
| Turbines | Governor; runner characteristics with speed in the loop, both engines | engine agreement; expected trends |
| Valves | PBV, GPV, TCV | EPANET 2.2 (0.003 m) |
| Viscoelastic pipes | Kelvin–Voigt creep, implicit in the cavity model | stability and damping tests |
| Examples | 880 result values held in a baseline | unchanged from 2.x results |
| Air valve plan | Locations (AWWA M51), sizes for draining (Hazen–Williams) and filling, surge test with anti-slam | orifice capacities against published data; plan on the rising-main example; interface test end to end |

## Before publishing

1. Run *Desktop builds* (Actions) from `v3-program` after merging, or push a tag `v3.0.0`.
2. Install the MSIX on a Windows test machine: open an example, run, daily operation, connect an AI account, export.
3. Submit in Partner Center with the text above; keep the "purchases without Store commerce" declaration ticked.
