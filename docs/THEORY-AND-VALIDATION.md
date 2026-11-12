# SurgeSpace theory and validation

## 1. Steady state
Global gradient algorithm (Todini–Pilati), as EPANET: Darcy–Weisbach (Swamee–Jain / laminar) or Hazen–Williams
friction, minor losses, pump curves as EPANET interprets them (one point, three points, multi-point), control valves
(PRV, PSV, FCV) by status iteration, pressure-breaker and general-purpose valves, non-return valves, variable-speed
pumps whose speed is found (secant) to meet a pressure set point.

Emitters (Q = C·p^γ) and pressure-driven demands (EPANET 2.2: D·((p − p_min)/(p_req − p_min))^e between the two
pressures) are links to a virtual source at the node elevation, linearised in the same Newton iteration, with the
demand held at zero or in full while the pressure stays beyond the limits. In the surge engines the emitter keeps
discharging C·p^γ at every step.

## 2. Wave engine (method of characteristics)
- Characteristic equations on a fixed grid; one time step for the whole network, pipe wave speeds adjusted within a
  tolerance (default 0.5 %) and reported; very short pipes become rigid columns.
- Column separation: discrete gas cavity model (free gas fraction 10⁻⁷ by default), solved in closed form at every
  section, so vapour cavities form and collapse without spurious spikes.
- Unsteady friction: Brunone–Vítkovský with Vardy's shear decay coefficient.
- Viscoelastic pipe walls (PE, PVC): Kelvin–Voigt creep elements; the retarded strain is integrated exactly over the
  step and implicitly in the new head inside the cavity model, so it stays stable at any compliance.
- Boundary conditions solved implicitly with the connected characteristics: pumps (homologous head and torque,
  inertia run-down, controlled ramps, starts, variable-speed PI control), four-quadrant pumps (generic odd/even form
  fitted to the pump curve, or tabulated Suter WH/WB), valves (stroke laws, manufacturer curves, active control
  valves with response time), check valves (ideal, delay, reverse velocity, dynamic characteristic), air vessels
  (polytropic gas, shape, bladder, dip tube, bypass), air valves (isentropic air flow, three-stage, curves), open
  and one-way tanks, anticipator, relief, outlets and burst discs, turbines (gate operation and speed).
- Differential (Johnson) surge tanks: the riser follows the pipe head (with its connection loss); the chamber fills
  and empties through the ports (orifice law, implicit chamber level over the step); the riser overflows into the
  chamber. Both engines.
- Motor start-up: the speed comes from the torque balance I·dω/dt = T_motor(ω) − T_pump(ω, Q), with the motor
  torque–speed curve (typical design B or a table), star–delta (torque / 3 below the switch speed) or a soft starter
  (torque ∝ V², voltage ramp). Both engines.
- Turbine runner characteristics: flow and efficiency follow the unit speed ν = (n/n_r)/√(H/H_r) (Francis low and
  high specific speed, Kaplan, Pelton or a table; efficiency zero at runaway), with the runner speed integrated in
  the time loop from the power balance and the governor acting on the gates.
- Slams at check valves and air valves are detected and reported with the Joukowsky estimate and the computed rise.

## 3. Rigid-column engine
L/(gA)·dQ/dt = ΔH − losses for each pipe, continuity at the nodes, pump speed from the torque balance and storage
devices (vessels, tanks) — solved together by Newton's method at each implicit step. No pressure waves. On large
models each Newton step eliminates the link, pump-speed and device unknowns (each local to one link or node), leaving
a sparse symmetric system in the node heads solved by preconditioned conjugate gradients; it gives the same answers
as the dense solve.

## 4. Extended period and water quality
Sequence of steady states with tank level integration, pattern steps, simple controls (time, clock, level,
pressure) with the step cut exactly at the level, rule-based controls with EPANET's rule step and premise logic,
full/empty tank handling. Water quality by Lagrangian segments (EPANET's method): age, trace, first-order bulk and
wall reactions with mass transfer (Sherwood number), completely mixed tanks, boosters and source concentrations.

## 5. Validation (run in continuous integration unless a script is named)
| Check | Reference | Result |
|---|---|---|
| Steady heads and flows | EPANET 2.2 | see `validation/steady-vs-epanet.ts` (needs the reference folder) |
| PRV, PSV, FCV, PBV, GPV, TCV | EPANET 2.2 | heads within 0.003 m, flows within 0.01 L/s |
| Extended period, Net1/Net2/Net3 | EPANET 2.2 | heads within 0.04 m |
| Rule-based controls (Net1 with four rules) | EPANET 2.2 | heads within 0.008 m |
| Chlorine, Net1 | EPANET 2.2 | within 0.003 mg/L |
| Water age, Net1/Net2/Net3 | EPANET 2.2 | 95 % of values within 0.2 h |
| Transient, Net3 valve closure | TSNet | see `validation/transient-vs-tsnet.ts` |
| Transient benchmarks Tnet0, Tnet3 | published benchmark results | see `validation/README.md` |
| Joukowsky rise, wave period, line packing | closed form | engine tests |
| Surge tank mass oscillation | Jaeger's formula; wave engine | within 5 %; engines agree within 1 % |
| Pipe force on a straight pipe | ρ·a·V·A | within 12 % (line packing) |
| Variable-speed drive | set point | holds the pressure in steady state and after a demand step |
| Differential surge tank | limits: ports wide open = plain tank of full area; ports shut = riser alone | within 5 %; engines agree within 2 % |
| Motor start | final speed and duty; run-up order DOL < star–delta < soft start | speed within 3 % of rated; engines agree |
| Turbine runner characteristics | trends: Francis chokes (higher rise), Kaplan relieves (lower rise) vs a speed-independent runner | as expected; steady state unchanged |
| Pipe class optimisation | rising main | feasible, cheaper than the highest classes, higher class near the pumps |
| Emitters (leakage), Net1 over 24 h | EPANET 2.2 | heads within 0.008 m, demands within 0.003 L/s |
| Pressure-driven demand, Net1 over 24 h | EPANET 2.2 | heads within 0.007 m, demands within 0.005 L/s |
| Differential surge tank | SciPy ODE integration (independent code) | upsurge equal to 0.01 %; history within 0.06 m |
| Motor start (direct on line) | SciPy ODE integration (independent code) | rigid within 0.03 %, wave within 1.2 % (compressibility) |
| Rigid-column sparse solve | dense solve | identical results; 3,000-pipe grid at about 0.1 s per step |
| Calibration | synthetic field data | recovers roughness ×3 and demand ×1.2 |
| UTM conversion | PROJ | within 0.2 mm |
| DXF export | ezdxf (independent reader) | no audit errors |
| QGIS plug-in | QGIS 3.34 (headless) | export, SurgeSpace import and results layers |
| Network from a plan drawing (DXF) | KY4, a real distribution network (959 junctions, 1,156 pipes with 2,812 bends, 2 pumps, 4 tanks, 1 reservoir) drawn as a DXF in feet with level, size and TWL texts, symbols and clutter; compared with the network it was drawn from | 99.8 % of nodes and 99.5 % of pipes found between the right nodes; levels 99.8 % within 1 cm; sizes 99.5 %; lengths along the bends 99.8 %; sources and water levels all correct; steady heads against an independently built model: median 0.03 m, 95 % within 0.29 m (the rest is where pipes in the source data run within a metre of a junction they do not join, which a drawing cannot tell apart) |
| Network from schedules | EPANET Net3 written as node and link schedules (Excel layout) and read back by the header rules | heads equal within 0.0004 m |
| Pump curve digitised by hand | a raster graph with a known curve; a published extension-service curve (2,000 gpm at 80 ft, stated in its text) | within 0.3 units; 2,000 gpm read as 79.8 ft |
| Pump curve fitted to points | an exact quadratic | recovered exactly at shut-off, duty and end |

Reference data and generators: `validation/data/` (WNTR scripts and JSON results).
