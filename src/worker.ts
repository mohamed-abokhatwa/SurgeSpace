// Runs the engine off the main thread so the app stays responsive during long simulations.
import { handleJob, type JobRequest } from './jobs';

self.onmessage = (ev: MessageEvent<JobRequest>) => handleJob(ev.data, (m) => (self as unknown as Worker).postMessage(m));
