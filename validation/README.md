# Validation

Every script here runs from the repository root with `npx tsx validation/<script>.ts …`.

## 1. Against Bentley HAMMER

The TSNet repository (github.com/glorialulu/tsnet, `examples/networks/tnet0_hammer` and `tnet3_hammer`) ships two
HAMMER projects together with HAMMER's own text reports (HAMMER engine 08.11.06.113). The event settings were read
from the HAMMER project database, and the reported extremes were compared with SurgeSpace.

### Tnet0: valve closure, 2 pipes (`vs-hammer-tnet0.ts`)

Reservoir 750 m → 1200 m DN600 → 2400 m DN1200 → valve discharging 0.05 m³/s to air, closing over 2 s.

| Point | Max head HAMMER | Max head SurgeSpace | Min head HAMMER | Min head SurgeSpace |
|---|---|---|---|---|
| Junction 2 | 759.3 m | 759.3 m | 740.6 m | 740.6 m |
| Valve | 761.8 m | 761.8 m | 738.3 m | 738.3 m |

### Tnet3: BWSN network 1, pump shutdown (`vs-hammer-tnet3.ts`)

126 junctions, 168 pipes, 2 pumps, 8 valves, 2 tanks. PUMP-172 is ramped from full speed to zero over 2 s.
Wave speed 1200 m/s; 20 s; steady friction. 332 pipe ends compared.

| Quantity | Mean difference | 95th percentile | Worst |
|---|---|---|---|
| Steady head | 0.05 m | 0.07 m | 0.68 m |
| Maximum head (largest rise 30.4 m) | 1.6 m | 3.1 m | 4.2 m |
| Minimum head (largest drop 43.7 m) | 0.8 m | 2.1 m | 7.4 m |

Pipe ends where both max and min agree within 3 m: 92 %; within 5 m: 99 %.

Where they differ: both programs use the same pump curve, but they extend it differently at low speed. HAMMER uses
generic four-quadrant curves based on the pump's specific speed; SurgeSpace applies the affinity laws to the curve
given. HAMMER's check valve at PUMP-172 closes at 0.46 s, SurgeSpace's at 0.80 s, and the largest differences sit at
the two pumps and the tank next to PUMP-170 (which HAMMER models as a surge tank with a throat).

The run time step does not explain the differences. Re-running SurgeSpace at HAMMER's own 0.002 s step with
fixed-step wave-speed rounding (`HAMMER_LIKE=1`) gives the same numbers within 0.2 m.

## 2. Against TSNet (open-source MOC), Net3 (`transient-vs-tsnet.ts`)

EPANET Net3 (92 junctions, 2 pumps, 3 tanks). A gate valve was inserted in the busiest main (830 L/s, DN750)
and closed linearly over 2 s. TSNet's adjusted wave speeds, valve curve and constant friction were used in both
codes, and both start from EPANET's t = 0 state. Column separation was switched off, because TSNet has no cavity model.

- Steady heads agree within 0.01 m.
- The first pressure wave agrees closely at every reported node. Examples: valve upstream +222.2 vs +222.1 m;
  valve downstream −220.7 vs −220.6 m; node 153 −227.4 vs −229.0 m.
- At the valve, the two codes agree within 0.2 m for the first 11.5 s.
- After about 9–12 s they part. TSNet's own log shows its pump boundary failing on almost every step
  ("The quadratic equation has no real solution (pump)" 9,942 times, plus ~6,600 invalid-value warnings), and its
  valve-side head then drops 283 m in one step. So TSNet's later values for this network are not a usable reference.

## 3. Steady state against EPANET 2.2 (`steady-vs-epanet.ts`)

| Network | Junctions | Mean head difference | Worst | Flow difference |
|---|---|---|---|---|
| Net3 | 92 | 0.001 m | 0.012 m | 0.01 % |
| ky4 (POWER pumps) | 959 | 0.000 m | 0.007 m | 0.07 % |
| Net6 | 3,323 | 0.001 m | 0.007 m | 0.02 % |

## 4. Closed-form tests (`tests/engine.test.ts`)

Joukowsky jump (0.05 %), line packing, column separation and collapse, 2L/a timing, slow closure,
mixed-pipe time step selection, and junction wave transmission against exact theory (0.8 %).

## 5. Protection devices (`tests/devices.test.ts`, 49 tests)

Each device is checked against hand calculations or closed-form theory:

| Device | What is checked |
|---|---|
| Hydropneumatic tank | Vertical, horizontal and sphere geometry; bladder pre-charge (p_pre·V = p0·Vg); oscillation period and amplitude against rigid-column theory for n = 1.0 and 1.4; connection inertia; water balance; dip-tube minimum water; non-return valve with bypass loss |
| Open surge tank | Period and amplitude against rigid-column theory; overflow volume balance over 40,000 steps |
| One-way tank | Outflow only, check valve holds on recovery |
| Surge anticipation valve | Flow law Q = Cd·A·open·√(2gp); open / hold / close schedule; low and high triggers |
| Pressure relief valve | Flow law with lift = (p − set)/accumulation; limits the peak near the set pressure |
| Air valves | Double, three-stage (switch to small orifice), vacuum breaker, release only, manufacturer curve (curve built from the orifice sizes gives the same result), Treat as junction, ideal gas law |

All results are deterministic (same answer on repeated runs).

## 6. Corrections made during device testing

- **Gas start-up equilibrium.** Free-gas volumes are now set at equilibrium with the steady head at t = 0.
  Before, a tiny start-up drift (3e-4 m) could grow in strongly cavitating runs. The gravity-main example
  peak changed from 560 m to 510 m; 510 m is converged (510.2–510.4 m across time steps and gas fractions).
- **Solver fallback.** When the Newton solve for a group of joined devices stalls, a flow-based solve is
  tried and kept only if it fits the equations better. This removed a false relief-valve spike
  (254 m against a 210 m set pressure). All other examples are unchanged against the saved baseline.

## 7. Valves, check valves and slams (`tests/valves.test.ts`, 43 tests)

| Item | What is checked |
|---|---|
| Valve characteristics | Gate table unchanged; globe, ball, butterfly, needle curves rise 0 → 1; manufacturer curve interpolation; a part-open valve starts the transient with no jump (steady state uses the same curve) |
| Control valves | PRV, PSV and FCV hold their set points in the steady state; fully open with a warning when the set point cannot be reached; locked valves keep their opening; an active PRV brings the downstream pressure back to its set point after a disturbance |
| Operating curve | Valve follows the time–stroke table at every step |
| Pump start | Off in steady state, speed ramps to 100 %, settles at the running duty (within 0.1 %) |
| Check valves | Ideal: no reverse flow on pumps and pipes; parallel pumps with different check valves kept separate; pipe check valve loss = K·v²/2g; reverse-velocity closure: the computed head jump equals a·v/g (within 1.5 %); delay and closing time to one time step; dynamic characteristic: closes at the reverse velocity the curve gives for the measured deceleration; reopening head |
| Air-valve slam | Pocket closure found; computed jump = a·(Σq/ΣA)/g for the closing columns (39.9 vs 39.8 m); three-stage valve removes the slam |
| Outlets | Timed outlet and rupture disk: Q = Cd·A·opening·√(2g·p) at every step, volume balance, bursting time, peak limited |

## 8. Control valves against EPANET 2.2 (`control-valves-vs-epanet.ts`)

A network with a PRV (active), a PSV (fully open because its set point is already exceeded) and an FCV (active),
imported from `data/control-valves.inp` and compared with EPANET 2.2 run through WNTR: worst head difference
0.005 m, worst flow difference 0.0001 L/s, same valve states.

## 9. Corrections made while adding valves

- A part-open **gate valve** used the raw stroke as the flow area in the steady state but the gate table in the
  transient, which caused a start-up jump. Both now use the same valve curve.
- A closed valve with a check valve could be re-opened by the steady solver; it now stays closed.

`scripts/full-check.sh` runs every test and comparison in this folder; it was run three times with identical results.
