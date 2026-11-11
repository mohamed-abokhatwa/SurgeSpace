// Emitters (leakage) and pressure-driven demand: against EPANET 2.2, file round trip, and in the surge engines.
import { readFileSync } from 'node:fs';
import { comparePDA } from '../validation/pda-vs-epanet';
import { parseInp, toInp } from '../src/engine/inp';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { risingMain } from '../src/engine/cases';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

const e = comparePDA('Net1emit');
t('emitters (leakage) over 24 h match EPANET 2.2', e.dH < 0.02 && e.dD < 0.02 && e.dQ < 0.05, `heads ${e.dH.toFixed(4)} m, demands ${e.dD.toFixed(3)} L/s, flows ${e.dQ.toFixed(3)} L/s`);
const p = comparePDA('Net1pda');
t('pressure-driven demand over 24 h matches EPANET 2.2', p.dH < 0.02 && p.dD < 0.02 && p.dQ < 0.05, `heads ${p.dH.toFixed(4)} m, demands ${p.dD.toFixed(3)} L/s, flows ${p.dQ.toFixed(3)} L/s`);

const ref = JSON.parse(readFileSync(new URL('../validation/data/Net1pda.json', import.meta.url), 'utf8'));
const net = parseInp(readFileSync(new URL('../validation/data/Net1pda.inp', import.meta.url), 'utf8')).network;
t('EPANET options read: PDA limits converted from psi, emitter coefficient', net.settings.demandModel === 'PDA' && Math.abs(net.settings.pdaReq! - 120 * 0.70307) < 1e-6 && (net.nodes.find((n) => n.id === '22')!.emitter ?? 0) > 0);
const st = solveSteady(net);
const short = net.nodes.filter((n) => (n.demand ?? 0) > 0 && (st.outflow?.get(n.id) ?? 0) < (n.demand ?? 0) * 0.999 - (st.emitterFlow?.get(n.id) ?? 0));
t('some junctions get less than their demand under the pressure-driven model', short.length > 0 && ref.times.length > 0, short.map((n) => n.id).join(', '));
const back = parseInp(toInp(net)).network;
t('EPANET export keeps the options and emitters', back.settings.demandModel === 'PDA' && Math.abs(back.settings.pdaReq! - net.settings.pdaReq!) < 1e-9 && Math.abs((back.nodes.find((n) => n.id === '22')!.emitter ?? 0) - net.nodes.find((n) => n.id === '22')!.emitter!) < 1e-9);

// surge engines: a leak on the rising main stays in balance in the steady state and draws water in the surge
for (const engine of ['wave', 'rigid'] as const) {
  const rm = risingMain(true);
  rm.settings = { ...rm.settings, engine };
  rm.nodes = rm.nodes.map((n) => (n.id === 'CH1200' ? { ...n, emitter: 0.002 } : n));
  rm.event = { kind: 'none', targets: [], start: 1 };
  const s0 = solveSteady(rm);
  const q = s0.emitterFlow!.get('CH1200')!;
  const r = runTransient({ ...rm, settings: { ...rm.settings, duration: 20 } }, { steady: s0, frames: 50 });
  const h = Array.from(r.nodeHead.CH1200);
  t(`${engine}: leak flow from the pressure, steady state stays balanced`, Math.abs(q - 0.002 * Math.sqrt(s0.heads.get('CH1200')! - rm.nodes.find((n) => n.id === 'CH1200')!.elev)) < 1e-6 && Math.max(...h) - Math.min(...h) < 0.05, `leak ${(q * 1000).toFixed(1)} L/s, head drift ${(Math.max(...h) - Math.min(...h)).toFixed(4)} m`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
