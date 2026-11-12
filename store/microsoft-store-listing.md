# SurgeSpace: Microsoft Store listing

Store ID **9NFRBFGTQBSK** · Package identity `EngineeringWorkspace.SurgeSpace` · Publisher Engineering Workspace

Copy each block into Partner Center → SurgeSpace → Submission → the matching page.

---

## 1. Pricing and availability

| Field | Value |
|---|---|
| Markets | All markets |
| Visibility | Public audience; discoverable in the Store |
| Pricing | **Free** (licences are sold directly by Engineering Workspace) |
| Free trial | No trial (the app has its own 14-day evaluation) |
| Sale | None |
| Release | As soon as it passes certification (or a date you choose) |

## 2. Properties

| Field | Value |
|---|---|
| Category | **Productivity** |
| Subcategory | (none) |
| Privacy policy URL | https://surgespace-licences.engspace.app/privacy |
| Website | https://engspace.app |
| Support contact info | https://surgespace-licences.engspace.app/support (or support@engspace.app) |
| Game settings / Display mode | Not applicable |
| Product declarations | **Tick "This app allows users to make purchases, but does not use the Microsoft Store commerce system"** (required since Nov 2026: licences are sold on engspace.app; policy 10.8.2). Tick "tested to meet accessibility guidelines" only if you have checked it. Leave the others as they are |
| System requirements, minimum | Windows 10 version 1809 or later, 64-bit; 8 GB RAM; DirectX 9 graphics; 1366×768 display; keyboard and mouse |
| System requirements, recommended | Windows 11, 16 GB RAM, 1920×1080 display |

## 3. Age ratings (IARC questionnaire)

- Category: **Productivity / utility** ("All other app types").
- Violence, sexual content, drugs, gambling, profanity: **No** to all.
- Does the app let users interact or exchange content with other users? **No.**
- Does the app share the user's location with others? **No.**
- Does it allow purchases of digital goods? **No.** (Licences are bought outside the app.)
- Does it collect personal information? **Yes, optional:** licence and contact details that the user chooses to send. This is covered by the privacy policy.
- Unrestricted internet access (web browser)? **No.**

Expected rating: **3+ / Everyone**.

## 4. Packages

Upload **`SurgeSpace_3.0.<n>.0.msix`** (the newest one; Partner Center needs a higher version than the last upload,
2.0.11.0). It is built by GitHub Actions → Desktop builds (tag `v3.0.0`), saved as the artifact
**SurgeSpace-MicrosoftStore** and copied to the `store-builds` branch.

- Device family: **Windows 10/11 Desktop** only.
- Remove the older 2.0.x package from the submission so only 3.0 is offered.
- The package declares *runFullTrust* (a standard desktop app) and *internetClient* (licence checks and the AI
  account the user connects). If certification asks why, use the note in section 7.

## 5. Store listing: English (United States)

**Product name**
SurgeSpace

**Short title** (optional)
SurgeSpace: surge analysis

**Short description** (shown on the listing; up to 200 characters)
Water hammer and surge analysis for pipelines, pumping stations, hydropower and water networks, with daily operation and an AI copilot that builds models from your drawings.

**Description** (up to 10,000 characters)

SurgeSpace is a complete transient (water hammer) and network analysis workspace for engineers who design and operate pipelines, pumping stations, hydropower schemes and water distribution networks.

Draw the system, import it, or let the AI build it from your drawings. Define what happens (pumps trip, valves close, a turbine rejects its load) and SurgeSpace shows the pressure waves travelling through every pipe, the worst pressures, the vapour cavities and slams, and the protection that fixes them. Then run the system through the day: tank levels, pump switching, pressures and water quality.

NEW IN 3.0: BUILD THE MODEL FROM YOUR DOCUMENTS
• Drop your drawings (PDF or images), long sections, pump data sheets, Excel schedules and CAD plans (DXF).
• Your own AI account reads them; every value is shown where it came from on the page, for you to accept, edit or reject.
• Spreadsheets of nodes, pipes, long sections and pump curves are read without AI. Pump curves on any graph can be digitised by hand.
• What the documents do not give is asked for; typical values are listed as assumptions in the report.
• Plan drawings become whole networks: pipes with their bends, levels and sizes from the texts, pumps, valves, air valves, tanks and reservoirs from the symbols, in metres or feet.
• The model is built, checked against the documents, and protected: an air valve plan by AWWA M51 practice (high points, grade changes, long runs, pump discharge, sized for draining and filling), tested in surge runs with anti-slam valves where they slam, and the air vessel sized for you.

AN AI COPILOT WITH YOUR OWN ACCOUNT
• Connect Anthropic, OpenAI, Google, Azure, Mistral, DeepSeek, xAI, Groq, OpenRouter, Together, or a free model on your computer (Ollama, LM Studio). Keys are encrypted on your device; nothing is sent until you ask.
• The copilot works through the same commands you use: it builds and edits the model, runs the engines and explains the results. Every change is an undo step and every number comes from the engines.
• One-click tasks: explain the results, review the model, design the protection, plan the air valves, scope the surge cases, review daily operation, draft the report narrative.

A FULL ENGINEERING WORKSPACE
• Start page with your recent projects, a one-minute tour, command palette (Ctrl+K), menu bar, tool ribbon, Model Explorer, Properties panel, results dock, light or dark theme, English or Arabic.
• Undo and redo, find, data sheets with Excel paste, bulk edit, libraries of pumps, valves, air valves, vessels and pipe types.
• SI or US units. Model Health Check with one-click fixes before every run.

EVERY ELEMENT
• Junctions, fixed- and varying-level sources, storage tanks, pipes (including viscoelastic plastic pipes), pumps with inertia, four-quadrant characteristics, variable-speed drives and motor starters, hydro turbines with governors, line valves, non-return valves, pressure reducing, sustaining, breaking and flow control valves.
• Protection: air vessels, air valves (double-acting, three-stage anti-slam, vacuum breaker), surge tanks (simple, throttled, differential, variable area), feed tanks, anticipator and relief valves, blow-offs and burst discs.

TWO SURGE ENGINES, AND DAILY OPERATION
• Wave engine: method of characteristics with column separation (discrete gas cavity model) for every fast event.
• Rigid-column engine for slow operations and surge tank oscillation, for networks of thousands of pipes.
• Daily operation (extended period): demand patterns, controls and rules, leakage and pressure-driven demand, tank levels, energy, water age, source tracing and chlorine.

SEE THE SURGE
• Results sweep across the network after a run; the waves travel and reflect in the animated surge view; vapour cavities show where they form.
• Long sections with envelopes linked to the drawing, a waterfall (3D) view of pressure over time, graphs of any variable, slams on the drawing, and the surge animation exported as a video.

DESIGN THE PROTECTION
• Automatic air vessel sizing, air valve planning and sizing, least-cost protection by genetic algorithm (vessels, air valves, pipe classes or diameters), uncertainty analysis, pipe forces for thrust blocks.
• Design checks against pipe class, minimum pressure, column separation, device limits and turbine overspeed.

WORKS WITH YOUR DATA
• EPANET .inp files, Excel and CSV, GIS (GeoJSON, QGIS and ArcGIS Pro plug-ins), CAD (DXF, AutoCAD plug-in), street and satellite maps with terrain levels.
• Live plant data over MQTT, OPC UA and Modbus, historian files, and calibration to field data.
• A complete report in your units, with the basis of the model and every assumption.

AN ENGINE YOU CAN TRUST
• Checked against EPANET 2.2, published benchmarks, TSNet and independent ODE solutions; plan reading checked on a real 1,156-pipe distribution network. Validation summary in the theory manual.

FREE AND LICENSED
SurgeSpace is free to download. The Free plan runs all built-in examples and your own models up to 25 pipes. A 14-day evaluation unlocks everything. Licences (personal or company) are available from Engineering Workspace at engspace.app; request one from inside the app. AI features use your own AI account and are billed by your AI provider.

**What's new in this version** (up to 1,500 characters)

SurgeSpace 3.0:
• Model from documents: drop drawings, long sections, data sheets, Excel schedules or CAD plans; your AI reads them, you check every value against the page, SurgeSpace asks for what is missing, builds the model, checks it and protects it.
• Plan drawings and schedules become whole networks; pump curves from data sheets or digitised from any graph.
• Air valve plan by AWWA M51 practice, tested in surge runs, and automatic air vessel sizing.
• AI copilot with your own AI account (13 providers or a free local model).
• Daily operation: tanks, patterns, controls and rules, leakage, pressure-driven demand, energy and water quality.
• Rigid-column engine, four-quadrant pumps, variable-speed drives, motor starters, turbine governors, differential surge tanks, viscoelastic pipes.
• Least-cost protection, calibration, live plant data, GIS and CAD links.
• New start page, run screen, tour, command palette, waterfall view, video export, Arabic interface.

**Product features** (up to 20, each up to 200 characters)
1. Build the model from your drawings, long sections, data sheets, Excel schedules and CAD plans with AI, checking every value against the page
2. Plan drawings (DXF) and schedules become whole networks with levels, sizes, pumps, valves and tanks
3. AI copilot with your own AI account: builds, runs, explains and designs the protection
4. Air valve plan by AWWA M51 practice, tested in surge runs, with anti-slam valves where they slam
5. Automatic air vessel sizing and least-cost protection by genetic algorithm
6. Watch pressure waves, vapour cavities and slams travel through the network
7. Two surge engines: wave (column separation) and rigid column for large networks
8. Daily operation: tanks, patterns, controls, rules, leakage, energy and water quality
9. Pumps with inertia, four-quadrant data, variable-speed drives and motor starters
10. Hydro turbines with governors and runner characteristics
11. Air vessels, air valves, surge tanks, feed tanks, anticipator and relief valves
12. Long sections with envelopes, waterfall (3D) view and graphs of any variable
13. Cases: keep variants, run them all and compare
14. Pump curves digitised from any graph, by hand or by AI
15. EPANET, Excel, GIS (QGIS, ArcGIS Pro) and CAD (DXF, AutoCAD) exchange
16. Live plant data (MQTT, OPC UA, Modbus) and calibration to field data
17. SI and US units, English and Arabic
18. Model Health Check with one-click fixes
19. Complete report with the basis of the model and every assumption
20. Checked against EPANET 2.2, published benchmarks and independent solutions

**Screenshots** (upload in this order; each is 1920×1080; caption for each; remove the old ones). Files in `store/images/v3/`.
1. `01-start-page.png`: "Start with a new model, the wizard, your recent projects, or build a model from your drawings with AI"
2. `02-network-surge.png`: "Watch the pressure waves travel through the network after the pumps trip"
3. `03-waterfall.png`: "Pressure along the main over time in the waterfall view, with the long section and envelopes"
4. `04-ai-copilot.png`: "An AI copilot with your own AI account: it reads the model, runs the engines and explains the results"
5. `05-documents-review.png`: "Build the model from your drawings: every value the AI reads is shown where it came from"
6. `06-documents-build.png`: "Every value traced to its document, missing data asked for, the model checked against the drawings"
7. `07-air-valve-plan.png`: "Air valve plan by AWWA M51 practice, tested in surge runs, and the air vessel sized for you"
8. `08-plan-drawing.png`: "Read a whole network from a CAD plan: pipes, bends, levels, sizes, pumps, tanks and air valves"
9. `09-daily-operation.png`: "Daily operation: tank levels, pump switching, pressures through the day and water quality"
10. `10-arabic.png`: "English or Arabic, with the interface, panels and report right to left"

Keep the existing artwork: `store-logo-300x300.png`, `box-art-2160x2160.png`, `poster-art-1440x2160.png`, `hero-3840x2160.png`.

## 6. Submission options

Publishing hold options: "Publish as soon as possible" (or manual, if you want to check the listing first).

## 7. Notes for certification

> SurgeSpace is a free engineering desktop app (Tauri / WebView2). It needs runFullTrust as a standard desktop
> application. No sign-in is required: all features can be tested with the built-in examples (Examples menu). To test
> licensed features, press the plan badge next to the SurgeSpace name, then "Start 14-day evaluation". The app
> connects to surgespace-licences.engspace.app only for licence checks, the evaluation and optional messages.
> Licences are sold outside the app; there are no in-app purchases. AI features are optional: they use an AI
> account that the user connects with their own key (sent only to the provider the user chooses); the rest of the
> app works without them.
