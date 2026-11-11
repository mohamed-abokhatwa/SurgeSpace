# SurgeSpace tutorials

Each tutorial starts from a built-in example (File → Open example) and takes 10–20 minutes.

## 1. Pump trip on a rising main, and its protection
1. Open **Rising main · no protection**. Press **Run** (F5).
2. Results dock → **Profile**: the minimum head line falls to vapour pressure near the high point HP2600 — the water
   column separates. **Design checks** lists the failures and where they are.
3. Press **Play** (Space) to watch the down-surge travel up the main.
4. Select node **PS-D** → Protection devices → add an **air vessel**. Or Results dock → **Protection sizing** → Size
   air vessel at PS-D: SurgeSpace tries sizes and gas volumes and gives the smallest that passes.
5. Add an **air valve** at HP2600 (ribbon → Air valve, click the node). Run again.
6. **Cases** → New case from current, change the vessel size in the new case, **Run all cases and compare**. On the
   Profile, **Overlay cases** shows both envelopes together.
7. Analysis → **Optimise protection** finds the least-cost combination of vessel and air valves that meets the
   limits, judged by full surge runs.
8. File → **Detailed report** (English or العربية) → Print / Save as PDF.

## 2. Valve closure on a gravity main
1. Open **Gravity main · valve closure**. Run.
2. Left pane → **Operations**: change the closure time and the closure law (gate, butterfly or a stroke curve);
   run each time, or use Tools → **Script console** → Example to run four closure times in one go.
3. Select the main and look at **Unbalanced axial forces** in the report for thrust-block design.

## 3. Daily operation, water quality and a surge run from the worst hour
1. Open **Town supply · daily operation**. Results dock → **Daily operation** → **Run 48 h**.
2. Move the time slider; set **Map: water quality** to see chlorine across the town. Pumps start and stop on the
   tank level controls (Controls tab; add rule-based controls in EPANET syntax there).
3. Find the hour with the highest pumping and press **Surge run from …**: a new case with that hour's tank level,
   demands and pump states. Add a pump trip in Operations and run.
4. Live data tab: import a historian CSV (time + tag columns), map tags to elements, compare, and **Calibrate**
   roughness and demand.

## 4. From GIS to a report, with the copilot
1. File → **Import GIS layer (GeoJSON)** (or QGIS / ArcGIS plug-ins in `plugins/`). Fields such as diameter,
   material and elevation are matched by name.
2. View → **Map and terrain**: set the UTM zone, place a satellite map under the model, take junction elevations and
   pipe long sections from terrain (check against survey levels).
3. **Model Health Check** → **Fix all** for the usual corrections.
4. AI → **AI accounts**: connect your AI account. In the Copilot tab: *Scope the surge cases* → agree → it creates the
   cases; *Design the protection*; *Draft the report narrative* → Use in report.
5. File → **Export results workbook (Excel)** and **Export drawing to scale (SVG A3)** for the submission.
