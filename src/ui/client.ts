import type { JobRequest } from '../jobs';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (m: string) => void; req: JobRequest };
let worker: Worker | null = null;
let workerOk = false; // set once the worker has answered at least once
let useMainThread = false;
let seq = 0;
const pending = new Map<number, Pending>();

function deliver(m: any) {
  const p = pending.get(m.id);
  if (!p) return;
  if (m.type === 'progress') p.onProgress?.(m.message);
  else if (m.type === 'error') { pending.delete(m.id); p.reject(new Error(m.message)); }
  else { pending.delete(m.id); p.resolve(m); }
}

async function runOnMain(req: JobRequest) {
  const { handleJob } = await import('../jobs');
  // yield so the busy indicator can paint before the engine blocks the page
  await new Promise((r) => setTimeout(r, 30));
  handleJob(req, deliver);
}

function getWorker(): Worker | null {
  if (useMainThread) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
  } catch {
    useMainThread = true;
    return null;
  }
  worker.onmessage = (ev) => { workerOk = true; deliver(ev.data); };
  worker.onerror = (e) => {
    if (!workerOk) {
      // the page does not allow module workers: fall back to the main thread and replay
      useMainThread = true;
      worker = null;
      pending.forEach((p) => runOnMain(p.req));
      return;
    }
    pending.forEach((p) => p.reject(new Error(e.message || 'Engine error')));
    pending.clear();
    worker = null;
  };
  return worker;
}

type Req = JobRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export function call<T = any>(req: Req, onProgress?: (m: string) => void): Promise<T> {
  const id = ++seq;
  const full = { ...req, id } as JobRequest;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress, req: full });
    const w = getWorker();
    if (w) w.postMessage(full);
    else runOnMain(full);
  });
}

/** Stop a long job (sizing, uncertainty) by restarting the engine. */
export function cancelAll() {
  worker?.terminate();
  worker = null;
  pending.forEach((p) => p.reject(new Error('Cancelled')));
  pending.clear();
}
