#!/usr/bin/env bash
# Full accuracy check: unit tests, device, valve and report tests, baseline of all examples, benchmark, EPANET and TSNet comparisons.
# Usage: scripts/full-check.sh <baseline.json> <tsnet/epanet reference folder> <TSNet repo networks folder> [Tnet3 reference report .hut]
set -u
BASE="$1"; REF="$2"; NETS="$3"
cd "$(dirname "$0")/.."
echo "== engine tests";  npx tsx tests/engine.test.ts | tail -1
echo "== device tests";  npx tsx tests/devices.test.ts | grep -E "FAIL|passed"
echo "== valve tests";   npx tsx tests/valves.test.ts | grep -E "FAIL|passed"
echo "== report tests";  npx tsx tests/report.test.ts | grep -E "FAIL|passed"
echo "== workspace tests"; npx tsx tests/workspace.test.ts | grep -E "FAIL|passed"
echo "== AI and command tests"; npx tsx tests/ai.test.ts | grep -E "FAIL|passed"
echo "== EPS and water quality vs EPANET"; npx tsx tests/eps.test.ts | grep -E "FAIL|passed"
echo "== four-quadrant pumps"; npx tsx tests/fourq.test.ts | grep -E "FAIL|passed"
echo "== rigid-column engine"; npx tsx tests/rigid.test.ts | grep -E "FAIL|passed"
echo "== skeleton, optimisation, SCADA"; npx tsx tests/phase5.test.ts | grep -E "FAIL|passed"
echo "== pipe forces"; npx tsx tests/forces.test.ts | grep -E "FAIL|passed"
echo "== variable-speed drives"; npx tsx tests/vsd.test.ts | grep -E "FAIL|passed"
echo "== PBV, GPV, TCV vs EPANET"; npx tsx tests/valves2.test.ts | grep -E "FAIL|passed"
echo "== viscoelastic pipes"; npx tsx tests/visco.test.ts | grep -E "FAIL|passed"
echo "== maps and terrain"; npx tsx tests/geo.test.ts | grep -E "FAIL|passed"
echo "== licence tests"; npx tsx tests/license.test.ts 2>/dev/null | tail -1
echo "== examples vs baseline"; npx tsx validation/baseline.ts compare "$BASE"
echo "== Benchmark Tnet0"; npx tsx validation/vs-benchmark-tnet0.ts | tail -2
echo "== Benchmark Tnet3"; npx tsx validation/vs-benchmark-tnet3.ts "$NETS/Tnet3.inp" "${4:-$NETS/tnet3_reference.hut}" "$REF/Tnet3_t0.json" | grep -E "steady head|maximum head|minimum head|within"
echo "== EPANET steady"; npx tsx validation/steady-vs-epanet.ts "$REF/epanet_ref.json" | grep -E "head difference"
echo "== EPANET control valves"; npx tsx validation/control-valves-vs-epanet.ts | grep -E "worst"
echo "== TSNet Net3"; npx tsx validation/transient-vs-tsnet.ts "$REF/Net3_valve.inp" "$REF/Net3_tsnet.json" | grep -E "^(VU|VD|149|153) "
