// Air valve plan: rule-based locations (AWWA M51 practice), sizing for draining and filling, and the surge test.
import { applyAirValvePlan, avInflow, avOutflow, drainFlow, planAirValves, testAirValvePlan } from '../src/app/airValvePlan';
import { risingMain } from '../src/engine/cases';
import type { Network } from '../src/engine/types';
import { execute, localContext } from '../src/app/commands';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

// orifice capacities against typical published air valve data (DN100 large orifice ≈ 0.85–0.95 m³/s free air
// at 35 kPa vacuum; DN50 ≈ 0.2–0.25 m³/s)
t('inflow capacity of a DN100 orifice at 35 kPa vacuum is in the published range', avInflow(0.1) > 0.8 && avInflow(0.1) < 1.0, `${(avInflow(0.1) * 1000).toFixed(0)} L/s`);
t('capacity grows with the area', Math.abs(avInflow(0.2) / avInflow(0.1) - 4) < 0.01 && avOutflow(0.1, 14) < avInflow(0.1, 35));
t('gravity drain flow (Hazen–Williams) of DN600 at 1 % ≈ 0.79 m³/s', Math.abs(drainFlow(0.6, 0.01) - 0.786) < 0.01, `${(drainFlow(0.6, 0.01) * 1000).toFixed(0)} L/s`);

const net = risingMain(false);
const plan = planAirValves(net);
const where = (it: (typeof plan)[number]) => ('node' in it.at ? it.at.node : `${it.at.pipe}@${it.at.s}`);
t('the high point gets an air valve', plan.some((it) => 'node' in it.at && it.at.node === 'HP2600'), plan.map(where).join(', '));
t('the pump discharge gets an air valve', plan.some((it) => 'node' in it.at && it.at.node === 'PS-D'));
t('a decrease in upward slope gets an air valve', plan.some((it) => it.reasons.includes('Decrease in upward slope')));
t('the low point does not get an air valve', !plan.some((it) => 'node' in it.at && it.at.node === 'CH3800'));
// spacing along the main: chainage of each valve
const ch = new Map<string, number>([['PS-D', 0], ['CH1200', 1200], ['HP2600', 2600], ['CH3800', 3800], ['TANK', 5000]]);
const pipeStart: Record<string, number> = { M1: 0, M2: 1200, M3: 2600, M4: 3800 };
const chain = plan.map((it) => ('node' in it.at ? ch.get(it.at.node)! : pipeStart[it.at.pipe] + it.at.s)).concat([5000]).sort((a, b) => a - b);
// gaps between valves, except across the low point at CH3800 (a washout, not an air valve, goes there)
const gaps = chain.slice(1).map((c, i) => (chain[i] < 3800 && c > 3800 ? 0 : c - chain[i]));
t('no ascending or descending run longer than 1.25 × the spacing without an air valve', Math.max(...gaps) <= 750, `largest gap ${Math.max(...gaps).toFixed(0)} m`);
t('sizes admit the draining flow at 35 kPa', plan.every((it) => avInflow(it.inDiameter) >= it.qDrain - 1e-9 || it.inDiameter >= 0.3), plan.map((it) => `${where(it)} DN${Math.round(it.inDiameter * 1000)}`).join(', '));
const ap = applyAirValvePlan(net, plan);
t('applying the plan adds junctions inside pipes at the right levels', ap.net.nodes.filter((n) => n.airValve).length === plan.length && ap.net.pipes.length === net.pipes.length + plan.filter((it) => 'pipe' in it.at).length);
const totalL = (n: Network) => n.pipes.reduce((s, p) => s + p.length, 0);
t('total pipe length unchanged', Math.abs(totalL(ap.net) - totalL(net)) < 0.01);
const test = testAirValvePlan(net, plan);
t('surge test runs with and without the plan and makes slamming valves anti-slam', Number.isFinite(test.after.minPressure) && test.plan.length === plan.length && test.antiSlam.every((n) => test.plan.some((it) => it.type === 'threeStage')), `largest cavity ${(test.before.cavity * 1000).toFixed(0)} → ${(test.after.cavity * 1000).toFixed(0)} L; lowest pressure ${test.before.minPressure.toFixed(1)} → ${test.after.minPressure.toFixed(1)} m; anti-slam at ${test.antiSlam.join(', ') || 'none'}; slams left ${test.after.slams}`);
t('the plan reduces the largest vapour cavity', test.after.cavity < test.before.cavity, `${(test.before.cavity * 1000).toFixed(0)} → ${(test.after.cavity * 1000).toFixed(0)} L`);

// the copilot command
void (async () => {
  const ctx = localContext(risingMain(false));
  const r = await execute(ctx, 'plan_air_valves', { apply: true });
  const out = r.output as { applied: boolean; valves: { at: string; inflow_mm: number }[] };
  t('copilot command plan_air_valves plans and applies', r.ok && out.applied && out.valves.length === plan.length && ctx.getNet().nodes.filter((n) => n.airValve).length === plan.length, out.valves.map((v) => `${v.at} DN${v.inflow_mm}`).join(', '));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
