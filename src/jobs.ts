// Engine jobs, shared by the background worker and the main-thread fallback.
import { designChecks, sizeVessel, suggestAirValves, uncertainty } from './engine/analysis';
import { solveSteady } from './engine/steady';
import { runTransient } from './engine/transient';
import type { Network } from './engine/types';
import { runEPS } from './engine/eps';
import { candidates, optimiseProtection, pipeCandidates, type OptVar } from './engine/optimise';
import { calibrate, type CalParam } from './app/calibrate';
import type { Series, TagMap } from './app/scada';

export type JobRequest =
  | { id: number; type: 'run'; net: Network }
  | { id: number; type: 'uncertainty'; net: Network }
  | { id: number; type: 'sizeVessel'; net: Network; node: string }
  | { id: number; type: 'airValves'; net: Network }
  | { id: number; type: 'eps'; net: Network }
  | { id: number; type: 'calibrate'; net: Network; data: Series; maps: TagMap[]; params: CalParam[] }
  | { id: number; type: 'optimise'; net: Network; vars?: OptVar[]; generations?: number; population?: number; pipes?: 'class' | 'diameter' };

export function handleJob(req: JobRequest, post: (msg: Record<string, unknown>) => void) {
  try {
    if (req.type === 'run') {
      post({ id: req.id, type: 'progress', message: 'Steady state…' });
      const steady = solveSteady(req.net);
      post({ id: req.id, type: 'progress', message: 'Transient…' });
      const result = runTransient(req.net, { steady, frames: 600 });
      post({ id: req.id, type: 'done', result, checks: designChecks(req.net, result) });
    } else if (req.type === 'uncertainty') {
      const base = runTransient(req.net, { frames: 600 });
      const u = uncertainty(req.net, base, (d, t) => post({ id: req.id, type: 'progress', message: `Uncertainty run ${d + 1} of ${t}…` }));
      post({ id: req.id, type: 'done', uncertainty: { ...u, runs: u.runs.map((r) => ({ label: r.label, maxHead: r.maxHead, minPressure: r.minPressure })) }, checks: designChecks(req.net, base, u.envelopes) });
    } else if (req.type === 'sizeVessel') {
      post({ id: req.id, type: 'done', sizing: sizeVessel(req.net, req.node, (m) => post({ id: req.id, type: 'progress', message: m })) });
    } else if (req.type === 'eps') {
      let last = -1;
      const eps = runEPS(req.net, (f) => { const p = Math.floor(f * 20); if (p !== last) { last = p; post({ id: req.id, type: 'progress', message: `Extended period… ${p * 5} %` }); } });
      post({ id: req.id, type: 'done', eps });
    } else if (req.type === 'calibrate') {
      const c = calibrate(req.net, req.data, req.maps, req.params, (m) => post({ id: req.id, type: 'progress', message: m }));
      post({ id: req.id, type: 'done', calibration: { factors: c.factors, before: c.before, after: c.after, runs: c.runs, fit: c.fit } });
    } else if (req.type === 'optimise') {
      const vars = req.vars ?? [...candidates(req.net), ...(req.pipes ? pipeCandidates(req.net, req.pipes) : [])];
      const r = optimiseProtection(req.net, { vars, generations: req.generations, population: req.population, onProgress: (m, f) => post({ id: req.id, type: 'progress', message: `Optimising · ${m} · ${Math.round(f * 100)} %` }) });
      post({ id: req.id, type: 'done', optimise: { best: r.best, evaluations: r.evaluations, history: r.history, vars } });
    } else if (req.type === 'airValves') {
      const base = runTransient(req.net, { envelopeOnly: true });
      post({ id: req.id, type: 'done', airValves: suggestAirValves(req.net, base, (m) => post({ id: req.id, type: 'progress', message: m })) });
    }
  } catch (e) {
    post({ id: req.id, type: 'error', message: (e as Error).message });
  }
}
