# SurgeSpace command API

Every change to a model goes through these commands — the menus, the AI copilot and scripts (Tools → Script console: `await ss.<name>({…})`) use the same set, so every change is one undo step and every number comes from the engines. Units are SI as named in each parameter.

Generated from `src/app/commands.ts` by `scripts/gen-api.ts`.

## get_model (read only)

Read the current model: nodes, pipes, pumps, valves, operations and run settings (SI units, as named). Call this first.

## list_elements (read only)

List elements of one type with all their editable fields (for large models, page with offset).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `type` | string (node, pipe, pump, valve) | yes | Element type |
| `offset` | number |  | First row (default 0) |
| `limit` | number |  | Rows (default 100, max 500) |

## new_model

Start a new empty model (the current one can be restored with undo).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Project name |
| `description` | string |  | Short description |

## load_example

Open a built-in example: rising, rising-bare, gravity, loop, elhazek, hydro, town, bwsn1.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string (rising, rising-bare, gravity, loop, elhazek, hydro, town, bwsn1) | yes | Example id |

## add_node

Add a junction or a fixed-level source (reservoir, sump, tank).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string |  | Id (optional) |
| `kind` | string (junction, reservoir) | yes | junction or reservoir |
| `x` | number | yes | X, m |
| `y` | number | yes | Y, m |
| `elevation_m` | number | yes | Ground / centreline level, m |
| `water_level_m` | number |  | Reservoir water level, m |
| `demand_lps` | number |  | Junction demand, L/s |

## add_pipe

Add a pipe between two existing nodes. Length defaults to the drawn distance.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | string |  | Id (optional) |
| `from` | string | yes | Start node id |
| `to` | string | yes | End node id |
| `length_m` | number |  | Length, m |
| `diameter_mm` | number | yes | Internal diameter, mm |
| `roughness` | number |  | ε mm (Darcy–Weisbach) or C (Hazen–Williams) |
| `wavespeed_mps` | number |  | Wave speed, m/s |
| `pressure_class_m` | number |  | Pressure class, m head |
| `material` | string |  | Material name |

## build_line

Build a whole pipeline from a long section in one step: points by chainage and level, joined by pipes of one size. Optionally make the first and/or last point a fixed-level source. Use for rising mains and transmission lines.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `points` | array of object | yes | Long-section points in order |
| `diameter_mm` | number | yes | Internal diameter, mm |
| `wavespeed_mps` | number |  | Wave speed, m/s |
| `roughness` | number |  | ε mm or C |
| `pressure_class_m` | number |  | Pressure class, m head |
| `material` | string |  | Material |
| `start_water_level_m` | number |  | If given, the first point is a source with this water level |
| `end_water_level_m` | number |  | If given, the last point is a source with this water level |
| `x0` | number |  | X of the first point (default: right of the existing model) |
| `y0` | number |  | Y of the first point |

## add_pump_station

Add identical pumps in parallel between a suction node and a discharge node, from the duty point. Inertia is estimated from the duty if not given.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `suction` | string | yes | Suction node id |
| `discharge` | string | yes | Discharge node id |
| `count` | number | yes | Number of duty pumps |
| `duty_flow_lps` | number | yes | Flow per pump at duty, L/s |
| `duty_head_m` | number | yes | Head at duty, m |
| `shutoff_head_m` | number |  | Shut-off head, m (default 1.3 × duty) |
| `curve` | string |  | Optional full curve "L/s:m, …" (overrides duty points) |
| `speed_rpm` | number |  | Rated speed (default 1480) |
| `efficiency_pct` | number |  | Efficiency at duty (default 80) |
| `inertia_kgm2` | number |  | Pump + motor inertia per pump |
| `check_valve` | boolean |  | Discharge non-return valve (default true) |

## add_link

Add a link between two nodes: pump, turbine, lineValve, nrv, prv, psv, fcv, orifice (nrv = non-return valve; prv/psv/fcv = control valves).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `kind` | string (pump, turbine, lineValve, nrv, prv, psv, fcv, orifice) | yes | Link kind |
| `from` | string | yes | From node id |
| `to` | string | yes | To node id |
| `diameter_mm` | number |  | Valve diameter, mm |

## insert_on_pipe

Split a pipe and insert a junction, a link (pump, valve…) or a protection device at a fraction of its length.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `pipe` | string | yes | Pipe id |
| `kind` | string (junction, pump, turbine, lineValve, nrv, prv, psv, fcv, orifice, airVessel, airValve, standpipe, feedTank, anticipator, relief, blowoff, burstDisc) | yes | What to insert |
| `fraction` | number | yes | Position along the pipe, 0–1 |

## set_properties

Change fields of one or more elements of the same type. Node fields: label, x, y, elevation, demand_lps, water_level_m, kind. Pipe: length_m, diameter_mm, roughness, wavespeed_mps, pressure_class_m, minor_loss_k, material, wall_mm, closed, check_valve. Pump: curve ("L/s:m, …"), efficiency_pct, speed_rpm, inertia_kgm2, check_valve, running. Valve: diameter_mm, k_open, opening, characteristic, set_point.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `type` | string (node, pipe, pump, valve) | yes | Element type |
| `ids` | array of string | yes | Element ids |
| `values` | object | yes | Field → value |

## add_device

Put a protection device on a junction: vessel, airValve, standpipe, feedTank, anticipator, relief, blowoff, burstDisc. Optional values as in set_device.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `node` | string | yes | Junction id |
| `device` | string (vessel, airValve, standpipe, feedTank, anticipator, relief, blowoff, burstDisc) | yes | Device |
| `values` | object |  | Device field → value (see set_device) |

## set_device

Change a device on a junction. vessel: volume_m3, gas_volume_m3, connection_mm, k_in, k_out, polytropic_n, shape, bladder. airValve: type, inflow_mm, outflow_mm, small_mm. standpipe/feedTank: diameter_m, bottom_m, top_m, connection_mm, riser_diameter_m, port_area_m2, riser_top_m. relief: set_head_m, diameter_mm. anticipator: low_set_m, diameter_mm, open_s, hold_s, close_s. blowoff/burstDisc: diameter_mm, opens_at_s, burst_head_m.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `node` | string | yes | Junction id |
| `device` | string (vessel, airValve, standpipe, feedTank, anticipator, relief, blowoff, burstDisc) | yes | Device |
| `values` | object | yes | Field → value |

## remove_device

Remove a protection device from a junction.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `node` | string | yes | Junction id |
| `device` | string (vessel, airValve, standpipe, feedTank, anticipator, relief, blowoff, burstDisc) | yes | Device |

## delete_elements

Delete elements. Deleting a node also deletes the pipes, pumps and valves connected to it.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `refs` | array of object | yes | Items: type, id |

## rename_element

Rename an element; every reference to it follows.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `type` | string (node, pipe, pump, valve) | yes | Type |
| `id` | string | yes | Current id |
| `new_id` | string | yes | New id |

## set_operations

Replace the run's operations (what happens during the surge run). Kinds: pump_trip, pump_stop_ramp, pump_start, valve_close, valve_open, turbine_rejection, turbine_acceptance. Each element follows the first operation that lists it. Valve operations: duration_s = stroke time, final_opening 0–1, exponent 1 linear / 2 slow end, or curve [[t_s, stroke], …].

| Parameter | Type | Required | Description |
|---|---|---|---|
| `operations` | array of object | yes | Items: kind, targets, start_s, duration_s, final_opening, exponent, curve |

## set_run_settings

Change run settings: duration_s, friction (DW or HW), min_pressure_m, max_pressure_m, unsteady_friction, liquid (Water 0 °C, Water 5 °C, Water 10 °C, Water 15 °C, Water 20 °C…), site_elevation_m.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `duration_s` | number |  | Simulation time, s |
| `friction` | string (DW, HW) |  | Friction method |
| `min_pressure_m` | number |  | Lowest allowed pressure, m |
| `max_pressure_m` | number |  | Highest allowed pressure, m |
| `unsteady_friction` | boolean |  | Unsteady friction |
| `liquid` | string |  | Liquid name |
| `site_elevation_m` | number |  | Site elevation above sea level, m |
| `engine` | string (wave, rigid) |  | Surge engine: wave (all events, default) or rigid (rigid columns: slow events, surge tank mass oscillation) |

## set_eps

Extended-period (daily operation) settings: duration_h, step_min (hydraulic step), pattern_step_min, default_pattern (for junctions without one), quality (none, age, trace, chemical), trace_node, chemical, bulk_per_day (negative = decay, chlorine typically -0.5), wall_m_per_day (negative).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `duration_h` | number |  | Duration, h |
| `step_min` | number |  | Hydraulic step, min |
| `pattern_step_min` | number |  | Pattern step, min |
| `default_pattern` | string |  | Default junction pattern id |
| `quality` | string (none, age, trace, chemical) |  | Water quality |
| `trace_node` | string |  | Trace source node |
| `chemical` | string |  | Chemical name |
| `bulk_per_day` | number |  | Bulk coefficient 1/day |
| `wall_m_per_day` | number |  | Wall coefficient m/day |

## set_patterns

Create or replace time patterns (multipliers per pattern step, repeating), e.g. a 24-value daily demand pattern. Optionally assign a pattern to junctions (or a fixed-level source head).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `patterns` | array of object |  | Items: id, factors |
| `assign` | array of object |  | Assignments |

## set_storage

Make a fixed-level source a storage tank whose level changes in the extended-period run (levels in m above the tank bottom = node elevation), or remove the storage (remove: true).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `node` | string | yes | Fixed-level source id |
| `init_level_m` | number |  | Initial level |
| `min_level_m` | number |  | Minimum level |
| `max_level_m` | number |  | Maximum level (overflow) |
| `diameter_m` | number |  | Tank diameter |
| `initial_quality` | number |  | Initial quality |
| `remove` | boolean |  | Remove the storage |

## set_controls

Replace the simple controls of the extended-period run. Each: link (pump, pipe or valve id), status open|closed (or setting), and one trigger: at_h (hours after start), clock_h (time of day, daily), or node + op (above|below) + value (tank level m above its bottom, or junction pressure m).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `controls` | array of object | yes | Items: link, status, setting, at_h, clock_h, node, op, value |

## set_rules

Replace the rule-based controls of the extended-period run, written in EPANET rule syntax with SI values (levels, heads, pressures m; flows L/s; times h:mm). Example: "RULE 1
IF TANK T1 LEVEL BELOW 2
AND SYSTEM CLOCKTIME >= 22:00
THEN PUMP PU1 STATUS IS OPEN
PRIORITY 1".

| Parameter | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Rules text |

## run_eps (read only)

Run the extended-period simulation (daily operation: tank levels, pump cycling, pressures through the day, water quality). Returns a summary: tank level ranges, pump hours and energy, lowest and highest pressures with times, quality ranges, events.

## optimise_protection

Least-cost surge protection by a genetic algorithm: chooses sizes (or none) for candidate air vessels and air valves — and optionally the pressure class or diameter of the pipes — so the pressure limits are met, judging every design with a full surge run. Without candidates it uses vessels at pump discharges and air valves at high points. Applies the best design. Takes from seconds to a few minutes.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `candidates` | array of object |  | Items: node, kind, options |
| `pipes` | string (none, class, diameter) |  | Also choose pipe pressure classes (class) or diameters (diameter) |

## skeletonise

Simplify the model: merge pipes in series through plain junctions (same diameter and material; the junction stays as a profile point) and optionally trim small dead ends. keep = node ids that must stay.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `keep` | array of string |  |  |
| `trim_below_mm` | number |  | Trim dead ends below this diameter (0 = off) |

## health_check (read only)

Check the model for errors and implausible inputs before running.

## query_elements (read only)

Find elements by data and results, e.g. "pipes where diameter_mm < 200 and material = PVC", "nodes where max_pressure_m > 120 or min_pressure_m < 0". Highlights them on the drawing and returns the ids.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Query text |

## create_case

Keep the current model as a case and continue in a new named copy (e.g. "Power failure, both pumps", "Valve V1 closes in 10 s"). Then change that copy (operations, devices). Cases are compared side by side in the Cases tab. With inherit, the new case is a child that keeps only its own changes, so later corrections to the current case flow into it (use it for variants of one design).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Name of the new case |
| `notes` | string |  | What the case represents |
| `inherit` | boolean |  | Child case that inherits from the current one |

## apply_health_fixes

Apply the suggested fix of every health-check finding that has one (or only those whose title contains `match`). One undo step.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `match` | string |  | Only findings whose title contains this text |

## run_analysis (read only)

Run the steady state and the surge simulation with the current model and operations; returns the results summary.

## get_results (read only)

Results of the last run: "summary", "nodes" (pressures at every node), "pipes" (flows and pressure envelopes), "forces" (largest unbalanced axial force per pipe for anchors and thrust blocks, kN), or a list of ids.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `what` | string (summary, nodes, pipes, forces) | yes | What |
| `ids` | array of string |  | Limit to these ids |

## size_air_vessel (read only)

Find the smallest air vessel at a junction that keeps every point above the minimum pressure and within class (several engine runs). Does not change the model: apply the result with add_device.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `node` | string | yes | Junction id (usually the pump discharge) |

## suggest_air_valves (read only)

Find high points that need air valves and the smallest standard inflow size for each (engine runs). Does not change the model.

## select_elements (read only)

Highlight elements on the drawing for the user (to show where something is).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `refs` | array of object | yes | Items: type, id |
