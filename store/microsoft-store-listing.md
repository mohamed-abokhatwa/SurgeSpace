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

Upload `SurgeSpace_1.0.<n>.0.msix` (the newest one; Partner Center needs a higher version than the last upload) from the GitHub build (Actions → Desktop builds → artifact **SurgeSpace-MicrosoftStore**).

- Device family: **Windows 10/11 Desktop** only.
- The package declares *runFullTrust* (a standard desktop app). If certification asks why, use the note in section 7.

## 5. Store listing: English (United States)

**Product name**
SurgeSpace

**Short title** (optional)
SurgeSpace: surge analysis

**Short description** (shown on the listing; up to 200 characters)
Water hammer and pressure surge analysis for pipelines and water networks. Watch the waves move, see the worst pressures and size surge protection automatically.

**Description** (up to 10,000 characters)

SurgeSpace is a transient (water hammer) analysis tool for engineers who design and operate pipelines and water distribution networks.

Load a model, choose an event (pump trip, controlled pump stop, pump start, valve closing or opening) and SurgeSpace shows the pressure waves travelling through every pipe. You see where pressures rise above the pipe class, where they fall towards vapour pressure, and what protection fixes it.

SEE THE SURGE
• Surge view colours each pipe by its change from steady pressure (red for a rise, blue for a drop), so you can watch the waves move and reflect.
• Animated flow direction, spinning pumps, valves that close on screen, and surge vessel water levels.
• Long-section profile with the steady line, the maximum and minimum heads, pipe class and vapour line. During playback the head at the current moment fills against steady.
• Timeline showing the biggest rise and drop at each moment, with one-click jumps to the worst cases.
• Time histories at any node, plus pump speed and flow, vessel gas volume and water level, surge tank levels, check valve flow, valve movement and air valve air.
• Slams light up on the map: when a check valve or an air valve closes on moving water you see where, when and how big (a·v/g).
• Large networks: thousands of pipes animate smoothly.

DESIGN THE PROTECTION
• Automatic surge vessel sizing: finds the smallest vessel that keeps every point above your minimum pressure and within pipe class, without emptying, and recommends the connection size.
• Automatic air valve sizing at the high points that need it.
• Uncertainty analysis: repeats the run with wave speed ±10 %, valve stroke ±20 % and pump inertia ±15 %, and shows the worst-case envelope.
• Design checks list what fails and where, with one click to the location.

ALL THE PROTECTION DEVICES
• Hydropneumatic tanks: vertical, horizontal or spherical; gas volume or bladder pre-charge; dip tube; connection pipe inertia; separate in/out losses or a check valve with bypass; polytropic gas.
• Air valves: double-acting, three-stage anti-slam, vacuum breaker, air release only, or the manufacturer's flow curves; every orifice size and Cd can be changed; "Treat as junction" keeps a valve on the drawing but leaves it out of the run.
• Open surge tanks with overflow, one-way (feed) tanks, surge anticipation valves, pressure relief valves, rupture disks and timed discharges to atmosphere.

VALVES AND CHECK VALVES
• Check valves on pumps, valves and pipes that close ideally, after a delay, at a reverse velocity, or by the manufacturer's dynamic characteristic, so check valve slam is predicted.
• Valve characteristics: gate, globe, ball, butterfly, needle or the manufacturer's curve; operating curves for multi-stage closures.
• Pressure reducing, pressure sustaining and flow control valves (PRV, PSV, FCV), locked during the surge or active with a response time. Their steady set points match EPANET.

DETAILED REPORT
• One click gives a full report: summary of findings, profile envelope, all input data, results for every node and pipe, protection devices, slams, design checks and time histories. Print it or save it as PDF.

AN ENGINE YOU CAN TRUST
• Method of characteristics that keeps every pipe at its real length; wave speeds are adjusted by at most 0.5 % (typical tools allow far more).
• Column separation with the discrete gas cavity model, unsteady friction, pump run-down with inertia, and every protection device solved together at each node.
• Validated against Bentley HAMMER on published cases (exact on the Tnet0 benchmark; mean difference 1.6 m on a 126-junction network), against TSNet and against EPANET steady state on networks up to 3,323 junctions. Every device is tested against hand calculations and theory.

WORKS WITH YOUR DATA
• EPANET .inp files (from EPANET, WaterGEMS, WaterCAD, InfoWater and others), including check valves and PRV / PSV / FCV control valves.
• Excel and CSV tables of nodes and pipes, or paste straight from Excel.
• Long-section profiles (chainage and level): nodes and air valves are placed at high and low points automatically.
• CAD drawings (DXF) with coordinates and levels.
• Export to EPANET and CSV.

FREE AND LICENSED
SurgeSpace is free to download. The Free plan runs all built-in examples and your own models up to 25 pipes. A 14-day evaluation unlocks everything. Licences (personal or company) are available from Engineering Workspace at engspace.app. Request one from inside the app. Licensed computers work offline and check in once a day when online.

**What's new in this version** (paste into "What's new in this version"; up to 1,500 characters)

New in SurgeSpace 1.0 (November update):
• All hydropneumatic tank options: vertical, horizontal or spherical, bladder pre-charge, dip tube, connection pipe, check valve with bypass.
• All air valve types: double-acting, three-stage anti-slam, vacuum breaker, air release, manufacturer curves; editable orifice sizes; "Treat as junction".
• Open and one-way surge tanks, surge anticipation valves, relief valves sized by diameter, rupture disks and timed outlets.
• Check valves on pumps, valves and pipes with delay, reverse-velocity or dynamic-characteristic closure, and check valve slam.
• Air-valve and check-valve slams shown on the map and listed with their size.
• Valve types (gate, globe, ball, butterfly, needle, manufacturer curve), operating curves, and PRV / PSV / FCV control valves.
• Pump start events.
• Detailed report to PDF.
• More accurate start-up with free gas, and a sturdier solver for valves that open sharply.

**Product features** (up to 20, each up to 200 characters)
1. Watch pressure waves travel through pipelines and networks in an animated Surge view
2. Maximum and minimum pressure envelopes on the map and along any route profile
3. Automatic surge vessel sizing with connection size and safety margin
4. Automatic air valve sizing at high points
5. Pump trip (with inertia), controlled pump stop, pump start, valve closure and opening events
6. Column separation (vapour cavities) with the discrete gas cavity model
7. Unsteady friction for realistic wave damping
8. Uncertainty analysis: worst case over wave speed, valve stroke and pump inertia
9. Exact pipe lengths: wave speeds adjusted by at most 0.5 %
10. Validated against Bentley HAMMER, TSNet and EPANET
11. Import EPANET .inp, Excel/CSV, long-section profiles and DXF drawings
12. Time histories of pressure, pump speed, vessel volume and air valve air
13. Design checks against pipe class and minimum pressure
14. Handles large networks (thousands of pipes)
15. Hydropneumatic tanks: vertical, horizontal or spherical, bladder pre-charge, dip tube and check valve with bypass
16. Air valves: double, three-stage anti-slam, vacuum breaker, release only or manufacturer curves
17. Check valves on pumps, valves and pipes with slam prediction (delay, reverse velocity or dynamic curve)
18. Valve curves, operating curves and PRV / PSV / FCV control valves
19. Detailed report with all inputs, results, checks and charts, saved as PDF
20. Light and dark themes, works offline

**Screenshots** (upload in this order; each is 1920×1080; a caption for each; the Store takes up to 10)
1. `01-network-surge.png`: "Watch the pressure wave travel through a real 126-junction network after a pump stops"
2. `09-protection-devices.png`: "Every hydropneumatic tank option, including bladder pre-charge" (new)
3. `10-check-valve-slam.png`: "Check valve slam found and shown on the map, with its size" (new)
4. `11-detailed-report.png`: "A detailed report you can print or save as PDF" (new)
5. `02-max-pressure-history.png`: "Maximum pressure across the network, with time histories at any node"
6. `03-profile-envelopes.png`: "A rising main without protection: the minimum head falls to vapour pressure"
7. `04-automatic-protection-sizing.png`: "Automatic surge vessel and air valve sizing"
8. `07-pressure-animation.png`: "Pressure animation with flow direction, and the live head along the profile"
9. `05-import-cad-spreadsheet-epanet.png`: "Import EPANET, Excel, long-section profiles or CAD drawings with levels"
10. `06-validated-engine.png`: "An engine validated against Bentley HAMMER, TSNet and EPANET"

`08-dark-mode.png` ("Light and dark themes") drops out to make room; delete it from the submission or keep it as #10 instead of 06.

**Store logos** (optional)
- 1:1 box art (2160×2160): `box-art-2160x2160.png`
- 2:3 poster art (1440×2160): `poster-art-1440x2160.png`. Recommended: it is used on the Store's large tiles.
- 1:1 app tile icon (300×300): `store-logo-300x300.png`

**Promotional images** (optional)
- 16:9 Super hero art (3840×2160): `hero-3840x2160.png`

**Keywords** (up to 7)
water hammer · surge analysis · transient · pipeline · hydraulics · EPANET · surge vessel

**Copyright and trademark info**
© 2026 Engineering Workspace

**Additional licence terms**
SurgeSpace is free to install. Running models over 25 pipes, automatic protection sizing, uncertainty analysis, the detailed report and export require a licence from Engineering Workspace (engspace.app) or the 14-day evaluation. Results support, and do not replace, the judgement of a qualified engineer.

**Developed by**
Engineering Workspace

## 6. Submission options

Publishing hold options: "Publish as soon as possible" (or manual, if you want to check the listing first).

## 7. Notes for certification

> SurgeSpace is a free engineering desktop app (Tauri / WebView2). It needs runFullTrust as a standard desktop
> application. No sign-in is required: all features can be tested with the built-in examples (Examples menu). To test
> licensed features, press the plan badge next to the SurgeSpace name, then "Start 14-day evaluation". The app
> connects to surgespace-licences.engspace.app only for licence checks, the evaluation and optional messages.
> Licences are sold outside the app; there are no in-app purchases.
