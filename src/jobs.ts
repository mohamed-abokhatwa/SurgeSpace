// Engine jobs, shared by the background worker and the main-thread fallback.
import { designChecks, sizeVessel, suggestAirValves, uncertainty } from './engine/analysis';
import { solveSteady } from './engine/steady';
import { runTransient } from './engine/transient';
import type { Network } from './engine/types';
import { runEPS } from './engine/eps';

export type JobRequest =
  | { id: number; type: 'run'; net: Network }
  | { id: number; type: 'uncertainty'; net: Network }
  | { id: number; type: 'sizeVessel'; net: Network; node: string }
  | { id: number; type: 'airValves'; net: Network }
  | { id: number; type: 'eps'; net: Network };

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
    } else if (req.type === 'airValves') {
      const base = runTransient(req.net, { envelopeOnly: true });
      post({ id: req.id, type: 'done', airValves: suggestAirValves(req.net, base, (m) => post({ id: req.id, type: 'progress', message: m })) });
    }
  } catch (e) {
    post({ id: req.id, type: 'error', message: (e as Error).message });
  }
}
