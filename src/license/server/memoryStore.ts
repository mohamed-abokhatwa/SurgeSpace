// In-memory store for tests and the preview's demo mode (optionally saved, e.g. to browser storage).
import type { Feedback, Licence, LicenceRequest, Machine, Store, Trial } from './logic';

export interface MemoryData { licences: Licence[]; machines: Machine[]; trials: Trial[]; requests: LicenceRequest[]; feedback: Feedback[] }
export const emptyData = (): MemoryData => ({ licences: [], machines: [], trials: [], requests: [], feedback: [] });

export function memoryStore(d: MemoryData = emptyData(), save: (d: MemoryData) => void = () => {}): Store {
  const done = async () => save(d);
  const nextId = (a: { id: number }[]) => a.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  return {
    licences: async () => d.licences.map((l) => ({ ...l })),
    licenceByCode: async (code) => d.licences.find((l) => l.code === code) ?? null,
    licenceById: async (id) => d.licences.find((l) => l.id === id) ?? null,
    addLicence: async (l) => { const id = nextId(d.licences); d.licences.push({ ...l, id }); await done(); return id; },
    updateLicence: async (id, p) => { const l = d.licences.find((x) => x.id === id); if (l) Object.assign(l, p); await done(); },
    machines: async (id) => d.machines.filter((m) => m.licence_id === id).map((m) => ({ ...m })),
    machineLicences: async (machine) => d.machines.filter((m) => m.machine === machine),
    putMachine: async (m) => { d.machines = [...d.machines.filter((x) => !(x.licence_id === m.licence_id && x.machine === m.machine)), m]; await done(); },
    freeMachines: async (id) => { d.machines = d.machines.filter((m) => m.licence_id !== id); await done(); },
    trial: async (hash) => d.trials.find((t) => t.hash === hash) ?? null,
    trials: async () => d.trials.map((t) => ({ ...t })),
    putTrial: async (t) => { d.trials = [...d.trials.filter((x) => x.hash !== t.hash), t]; await done(); },
    addRequest: async (r) => { const id = nextId(d.requests); d.requests.push({ ...r, id }); await done(); return id; },
    requests: async () => d.requests.map((r) => ({ ...r })),
    addFeedback: async (f) => { const id = nextId(d.feedback); d.feedback.push({ ...f, id }); await done(); return id; },
    feedback: async () => d.feedback.map((f) => ({ ...f })),
  };
}
