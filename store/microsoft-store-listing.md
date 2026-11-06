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
| Product declarations | Tick: "This app has been tested to meet accessibility guidelines" only if you have checked it. Leave the others as they are |
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

Upload **`SurgeSpace_2.0.<n>.0.msix`** (the newest one; Partner Center needs a higher version than the last upload, 1.0.9.0). It is built by GitHub Actions → Desktop builds (tag `v2.0.0`), saved as the artifact **SurgeSpace-MicrosoftStore** and copied to the `store-builds` branch.

- Device family: **Windows 10/11 Desktop** only.
- Remove the older 1.0.x package from the submission so only 2.0 is offered.
- The package declares *runFullTrust* (a standard desktop app). If certification asks why, use the note in section 7.

## 5. Store listing: English (United States)

**Product name**
SurgeSpace

**Short title** (optional)
SurgeSpace: surge analysis

**Short description** (shown on the listing; up to 200 characters)
Water hammer and surge analysis for pipelines, pumping stations, hydropower and water networks. Draw, run, watch the waves and size the protection.

**Description** (up to 10,000 characters)

SurgeSpace is a complete transient (water hammer) analysis workspace for engineers who design and operate pipelines, pumping stations, hydropower schemes and water distribution networks.

Draw the system or import it, define what happens (pumps trip, valves close, a turbine rejects its load) and SurgeSpace shows the pressure waves travelling through every pipe, the worst pressures, the slams and the protection that fixes them.

A FULL ENGINEERING WORKSPACE
• Menu bar, tool ribbon, Model Explorer, Properties panel, results dock and status bar, in light or dark theme.
• Undo and redo, find, duplicate, right-click menus and keyboard shortcuts for every tool.
• SI or US units, with your choice of flow unit (L/s, m³/h, ML/d, gpm, cfs, MGD) and pressure unit (m, kPa, bar, psi, ft).
• Model Health Check finds broken links, missing data and implausible values before every run.

DRAW IT YOUR WAY
• Draw pipes from point to point on real map coordinates, with bends; click a pipe to split it or to insert a pump, valve, turbine or protection device.
• Drag junctions and bends, box-select, snap to the grid, scale bar and north arrow.
• Put a site plan, aerial photo or scanned drawing under the network and trace over it.
• Colour pipes by diameter, material, class, wave speed, elevation or velocity; show value labels; draw contours of elevation or pressure.
• Data Sheets: every element type as a table you can sort, filter, edit, paste into from Excel and export to CSV.

EVERY ELEMENT
• Junctions, fixed-level sources, and varying-level sources (sine wave or time table: tides, waves, upstream stations).
• Pipes, pumps with inertia, hydro turbines, line valves (gate, globe, ball, butterfly, needle or your own curve), non-return valves, pressure reducers, pressure sustainers, flow limiters and inline orifices.
• Protection: air vessels (vertical, horizontal or spherical; gas volume or bladder pre-charge; dip tube; connection inertia; non-return valve with bypass), air valves (double-acting, three-stage anti-slam, vacuum breaker, release only or catalogue curves), open standpipes, feed tanks, anticipator valves, relief valves, timed blow-offs and burst discs.

ANY SCENARIO
• As many operations in one run as you need: pump power failure, controlled stop, pump start-up, valve closing or opening (stroke and law, or a multi-stage operating curve), turbine load rejection and load acceptance, each with its own timing.
• Cases: keep variants of the model side by side (with and without a vessel, faster or slower closure, future demand), run them all and compare the results in one table.
• Liquids from 0 to 100 °C water to sea water, brine and fuels, and the site's height above sea level.

SEE THE SURGE
• Surge view colours each pipe by its change from steady pressure, so you watch the waves move and reflect. Flow direction, spinning pumps and turbines, closing valves and vessel water levels are animated.
• Long-section profiles with steady, maximum and minimum heads, pipe class and vapour line; save the routes you use.
• Graph builder: plot any variable of any element (pressure, head, flow, velocity, pump or turbine speed, vessel gas, air volume) and export it.
• Slams light up on the drawing when a check valve or an air valve closes on moving water, with their size (a·v/g).

DESIGN THE PROTECTION
• Automatic air vessel sizing and air valve sizing.
• Uncertainty analysis: worst case over wave speed, valve stroke and pump inertia.
• Design checks against pipe class, minimum pressure, column separation, device limits and turbine overspeed, with one click to the location.

DETAILED REPORT
• One click gives a full report in your units: summary of findings, profile envelope, all input data, results for every node and pipe, protection devices, slams, design checks and time histories. Print it or save it as PDF.

AN ENGINE YOU CAN TRUST
• Method of characteristics that keeps every pipe at its real length (wave speeds adjusted by at most 0.5 %).
• Column separation with the discrete gas cavity model, unsteady friction, pump run-down with inertia, and every device solved together at each node.
• Validated against published Bentley HAMMER cases (exact on the Tnet0 benchmark; mean difference 1.6 m on a 126-junction network), TSNet, and EPANET steady state on networks up to 3,323 junctions.

WORKS WITH YOUR DATA
• EPANET .inp files (from EPANET, WaterGEMS, WaterCAD, InfoWater and others), Excel and CSV tables, long-section profiles and CAD drawings (DXF).
• Export to EPANET, CSV and PDF. Projects keep every case in one file; work is autosaved on your computer.

FREE AND LICENSED
SurgeSpace is free to download. The Free plan runs all built-in examples and your own models up to 25 pipes. A 14-day evaluation unlocks everything. Licences (personal or company) are available from Engineering Workspace at engspace.app; request one from inside the app. Licensed computers work offline and check in once a day when online.

**What's new in this version** (up to 1,500 characters)

SurgeSpace 2.0 — a complete engineering workspace:
• New desktop layout: menu bar, tool ribbon, Model Explorer, Properties panel, results dock and status bar.
• Draw the network on the canvas: pipes with bends, every element placed with one click, insert pumps, valves and devices on a pipe, drag, box select, snap, undo/redo, right-click menus.
• Background pictures, contours, colour-by-attribute and value labels.
• Several operations in one run, and turbine load rejection/acceptance with runner speed rise.
• Cases: keep model variants and compare them side by side.
• Data Sheets for every element and result, with Excel paste and CSV export.
• SI and US units; liquids and site elevation; wave speed calculator and pipe material catalogue.
• Varying-level sources (tides, waves), Model Health Check, graph builder, saved profiles.
• Report in your units.
Analysis results for existing models are unchanged.

**Product features** (up to 20, each up to 200 characters)
1. Draw pipes, pumps, valves, turbines and protection devices on real map coordinates, with bends and snapping
2. Watch pressure waves travel through the network in an animated Surge view
3. Several pump, valve and turbine operations in one run, each with its own timing
4. Cases: keep model variants, run them all and compare side by side
5. Data Sheets: edit every element in tables, paste from Excel, export to CSV
6. SI and US units with your choice of flow and pressure units
7. Air vessels, air valves, standpipes, feed tanks, anticipator and relief valves, blow-offs and burst discs
8. Hydro turbine load rejection with runner overspeed
9. Automatic air vessel and air valve sizing
10. Column separation with the discrete gas cavity model and unsteady friction
11. Uncertainty analysis: worst case over wave speed, stroke and inertia
12. Long-section profiles with maximum and minimum envelopes; saved routes
13. Graph builder for any variable of any element
14. Check-valve and air-valve slam prediction
15. Liquids catalogue, site elevation and wave speed calculator
16. Model Health Check before every run
17. Contours, colour-by-attribute, labels and background site plans
18. Validated against HAMMER benchmarks, TSNet and EPANET
19. Import EPANET .inp, Excel/CSV, long sections and DXF; export EPANET, CSV and PDF
20. Detailed report in your units, saved as PDF

**Screenshots** (upload in this order; each is 1920×1080; caption for each; remove the old ones)
1. `01-network-surge.png`: "Watch the pressure wave travel through a 126-junction network after a pump stops"
2. `02-draw-and-edit.png`: "A full engineering workspace: draw, edit in Properties and Data Sheets"
3. `03-profile-envelopes.png`: "Maximum pressure on the drawing and envelopes along the profile"
4. `04-cases-compare.png`: "Keep cases side by side and compare them in one table"
5. `05-operations-graphs.png`: "Several operations in one run, with the graph builder"
6. `06-hydro-turbine.png`: "Hydropower load rejection: surge shaft, penstock and turbine overspeed"
7. `07-run-setup.png`: "Liquids, site elevation, solver accuracy, design limits and units"
8. `08-wave-speed-calculator.png`: "Wave speed calculator with pipe materials"
9. `09-dark-us-units.png`: "Dark theme and US units"
10. `10-detailed-report.png`: "One-click detailed report in your units, saved as PDF"

Keep the existing artwork: `store-logo-300x300.png`, `box-art-2160x2160.png`, `poster-art-1440x2160.png`, `hero-3840x2160.png`.

## 6. Submission options

Publishing hold options: "Publish as soon as possible" (or manual, if you want to check the listing first).

## 7. Notes for certification

> SurgeSpace is a free engineering desktop app (Tauri / WebView2). It needs runFullTrust as a standard desktop
> application. No sign-in is required: all features can be tested with the built-in examples (Examples menu). To test
> licensed features, press the plan badge next to the SurgeSpace name, then "Start 14-day evaluation". The app
> connects to surgespace-licences.engspace.app only for licence checks, the evaluation and optional messages.
> Licences are sold outside the app; there are no in-app purchases.
