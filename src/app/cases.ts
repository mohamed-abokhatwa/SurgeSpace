// Cases: named variants of the model, each a complete copy (used by the Cases tab, the copilot and scripts).
import type { ModelCase, Network } from '../engine/types';

type Model = Omit<Network, 'cases' | 'activeCase'>;
const strip = (n: Network): Model => { const { cases: _c, activeCase: _a, ...m } = n; void _c; void _a; return structuredClone(m); };
const newId = () => Math.random().toString(36).slice(2, 9);

/** Make sure the project has a case list with the current model as the active case. */
export function ensureCases(n: Network): Network {
  if (n.cases?.length && n.activeCase) return n;
  const id = newId();
  return { ...n, cases: [{ id, name: 'Base case', model: strip(n) }], activeCase: id };
}
/** Store the model being edited into its case slot. */
export function syncActive(n: Network): ModelCase[] {
  return (n.cases ?? []).map((c) => (c.id === n.activeCase ? { ...c, model: strip(n) } : c));
}
export function switchCase(n: Network, id: string): Network {
  const cases = syncActive(n);
  const target = cases.find((c) => c.id === id);
  if (!target) return n;
  return { ...structuredClone(target.model), cases, activeCase: id } as Network;
}
export function addCase(n: Network, name: string): Network {
  const base = ensureCases(n);
  const cases = syncActive(base);
  const id = newId();
  return { ...base, cases: [...cases, { id, name, model: strip(base) }], activeCase: id };
}

