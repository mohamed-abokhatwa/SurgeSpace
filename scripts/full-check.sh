#!/usr/bin/env bash
# Full accuracy check: unit tests, device tests, baseline of all examples, HAMMER, EPANET and TSNet comparisons.
# Usage: scripts/full-check.sh <baseline.json> <tsnet/epanet reference folder> <TSNet repo networks folder>
set -u
BASE="$1"; REF="$2"; NETS="$3"
cd "$(dirname "$0")/.."
echo "== engine tests";  npx tsx tests/engine.test.ts | tail -1
echo "== device tests";  npx tsx tests/devices.test.ts | grep -E "FAIL|passed"
echo "== licence tests"; npx tsx tests/license.test.ts 2>/dev/null | tail -1
echo "== examples vs baseline"; npx tsx validation/baseline.ts compare "$BASE"
echo "== HAMMER Tnet0"; npx tsx validation/vs-hammer-tnet0.ts | tail -2
echo "== HAMMER Tnet3"; npx tsx validation/vs-hammer-tnet3.ts "$NETS/Tnet3.inp" "$NETS/tnet3_hammer/tnet3.wtg_1_58.hut" "$REF/Tnet3_t0.json" | grep -E "steady head|maximum head|minimum head|within"
echo "== EPANET steady"; npx tsx validation/steady-vs-epanet.ts "$REF/epanet_ref.json" | grep -E "head difference"
echo "== TSNet Net3"; npx tsx validation/transient-vs-tsnet.ts "$REF/Net3_valve.inp" "$REF/Net3_tsnet.json" | grep -E "^(VU|VD|149|153) "
