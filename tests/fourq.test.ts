// Four-quadrant pumps: reverse flow and reverse rotation after a trip without a non-return valve.
import { risingMain } from '../src/engine/cases';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { fourQuadrant, pumpCurve, pumpHeadAt } from '../src/engine/hydraulics';
import type { Network } from '../src/engine/types';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const run = (n: Network) => runTransient(n, { steady: solveSteady(n), frames: 400 });

{
  const p = risingMain(false).pumps[0];
  const fq = fourQuadrant({ ...p, fourQuadrant: 'generic' });
  const c = pumpCurve(p);
  let worst = 0;
  for (let q = 0; q <= 0.3; q += 0.01) worst = Math.max(worst, Math.abs(fq.head(q, 1) - pumpHeadAt(c, q, 1)));
  t('generic 4Q head follows the pump curve in the normal zone', worst < 1.5, `${worst.toFixed(2)} m worst over 0–300 L/s`);
  t('reverse flow through a stopped impeller needs head (loss)', fq.head(-0.25, 0) > 0 && fq.head(0.25, 0) < 0);
  t('reverse flow turns a stopped impeller backwards', fq.torque(-0.25, 0) > 0);
  t('turbine zone: reverse rotation with reverse flow gives positive head', fq.head(-0.4, -0.5) > 0);
  // Suter data: a table equivalent to the generic model must give the same values
  const th = Array.from({ length: 73 }, (_, i) => i * 5);
  const wh = th.map((d) => { const r = (d * Math.PI) / 180; const a = Math.sin(r), v = Math.cos(r); return fq.head(v * fq.QR, a) / fq.HR; });
  const wb = th.map((d) => { const r = (d * Math.PI) / 180; const a = Math.sin(r), v = Math.cos(r); return fq.torque(v * fq.QR, a) / fq.TR; });
  const su = fourQuadrant({ ...p, fourQuadrant: 'suter', suter: { theta: th.slice(0, 72), wh: wh.slice(0, 72), wb: wb.slice(0, 72) } });
  let dh = 0;
  for (const [q, a] of [[0.2, 1], [-0.1, 0.5], [-0.2, -0.3], [0.1, -0.2]]) dh = Math.max(dh, Math.abs(su.head(q, a) - fq.head(q, a)) / fq.HR);
  t('Suter table reproduces the characteristic', dh < 0.02, `${(dh * 100).toFixed(2)} % of rated head`);
}
{
  // trip without non-return valves: the generic 4Q pump runs down, reverses flow, then turns backwards
  const base = risingMain(true);
  const n4: Network = { ...base, pumps: base.pumps.map((p) => ({ ...p, checkValve: false, fourQuadrant: 'generic' as const })), settings: { ...base.settings, duration: 90 } };
  const r = run(n4);
  const sp = Array.from(r.pumps.PU1.speed), fl = Array.from(r.pumps.PU1.flow);
  const minS = Math.min(...sp), minQ = Math.min(...fl);
  t('flow reverses through the pump', minQ < -0.01, `${(minQ * 1000).toFixed(0)} L/s`);
  t('pump turns backwards (turbine) and stays bounded', minS < -0.05 && minS > -2.5, `lowest speed ${(minS * 100).toFixed(0)} %`);
  t('warning names the reverse rotation', r.warnings.some((w) => w.includes('turned backwards')));
  t('finite results', r.envelopes.every((e) => e.hMax.every(Number.isFinite) && e.hMin.every(Number.isFinite)));
  // same pumps with check valves: 4Q model gives (almost) the same as the standard one, since the zone is normal
  const a = run(base), b = run({ ...base, pumps: base.pumps.map((p) => ({ ...p, fourQuadrant: 'generic' as const })) });
  const mx = (x: typeof a) => Math.max(...x.envelopes.flatMap((e) => Array.from(e.hMax)));
  const mn = (x: typeof a) => Math.min(...x.envelopes.flatMap((e) => Array.from(e.hMin).map((h, i) => h - e.z[i])));
  t('with check valves the 4Q model agrees with the standard pump model', Math.abs(mx(a) - mx(b)) < 3 && Math.abs(mn(a) - mn(b)) < 3, `max head ${mx(a).toFixed(1)} vs ${mx(b).toFixed(1)} m, min pressure ${mn(a).toFixed(1)} vs ${mn(b).toFixed(1)} m`);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
