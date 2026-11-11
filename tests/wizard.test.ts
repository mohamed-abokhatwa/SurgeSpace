// Guided model wizard: builds a runnable model from a few answers.
import { buildFromWizard, wizardDutyHead, wizardWaveSpeed } from '../src/app/wizard';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
(async () => {
  const a = wizardWaveSpeed('di', 600), p = wizardWaveSpeed('pe100', 315);
  t('wave speeds from the material catalogue are realistic', a > 1000 && a < 1300 && p > 200 && p < 450, `DI DN600 ${a} m/s, PE ${p} m/s`);
  const spec = { kind: 'pumped' as const, name: 'Wizard main', profile: [[0, 96], [1200, 120], [2600, 146], [3500, 128], [5000, 140]] as [number, number][], startLevel: 100, endLevel: 147, diameterMm: 600, material: 'di', flowLps: 500, pumps: 2, operation: 'trip' as const };
  const H = wizardDutyHead(spec);
  const { net, notes } = await buildFromWizard(spec);
  const st = solveSteady(net);
  const q = net.pumps.reduce((s, x) => s + (st.flows.get(x.id) ?? 0), 0) * 1000;
  t('pumped main: two pumps, delivers about the design flow', net.pumps.length === 2 && Math.abs(q - 500) / 500 < 0.08, `${q.toFixed(0)} L/s at duty head ${H} m`);
  t('pumped main: air valve at the high point, trip operation, run length from the wave period', net.nodes.some((n) => n.id === 'CH2600' && n.airValve) && net.event.kind === 'pumpTrip' && net.settings.duration >= 30, notes.join('; '));
  const r = runTransient(net, { steady: st, frames: 200 });
  t('pumped main runs', r.envelopes.length === net.pipes.length && r.envelopes.every((e) => Array.from(e.hMax).every(Number.isFinite)));
  const g = await buildFromWizard({ kind: 'gravity', name: 'Gravity', profile: [[0, 180], [3000, 150], [6000, 110]], startLevel: 190, endLevel: 115, diameterMm: 500, material: 'steel', flowLps: 300, closureS: 20, operation: 'closure' });
  const sg = solveSteady(g.net);
  const qv = (sg.flows.get(g.net.valves[0].id) ?? 0) * 1000;
  t('gravity main: valve sized for the design flow, closure operation', Math.abs(qv - 300) < 3 && g.net.event.kind === 'valveClose' && g.net.event.duration === 20, `${qv.toFixed(1)} L/s`);
  const rg = runTransient(g.net, { steady: sg, frames: 200 });
  t('gravity main runs and the closure raises the pressure', Math.max(...rg.envelopes.map((e) => Math.max(...Array.from(e.hMax)))) > 190);
  const start = await buildFromWizard({ ...spec, operation: 'start' });
  t('pump start: pumps off in the steady state, start operation', start.net.pumps.every((x) => !x.on) && start.net.event.pumpMode === 'start');
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
