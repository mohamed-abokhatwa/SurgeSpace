// Cases: named variants of the model (used by the Cases tab, the copilot and scripts).
// A case is either a root (a complete model) or a child of another case: a child keeps only what differs from its
// parent (element properties, added and removed elements, other model fields), so a change made in the parent
// flows into every child that has not changed that same property. In memory every case also carries its resolved
// model, so it can be run and compared directly; the file stores only the differences for child cases.
import type { CaseDiff, ModelCase, Network } from '../engine/types';

type Model = Omit<Network, 'cases' | 'activeCase'>;
const strip = (n: Network): Model => { const { cases: _c, activeCase: _a, ...m } = n; void _c; void _a; return structuredClone(m); };
const newId = () => Math.random().toString(36).slice(2, 9);
const LISTS = ['nodes', 'pipes', 'pumps', 'valves'] as const;
type ListKey = (typeof LISTS)[number];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What the child changes relative to the parent. */
export function diffModel(parent: Model, child: Model): CaseDiff {
  const d: CaseDiff = {};
  for (const k of LISTS) {
    const pa = new Map((parent[k] as { id: string }[]).map((x) => [x.id, x as unknown as Record<string, unknown>]));
    const ch = new Map((child[k] as { id: string }[]).map((x) => [x.id, x as unknown as Record<string, unknown>]));
    const changed: Record<string, Record<string, unknown>> = {}, added: unknown[] = [], removed: string[] = [];
    ch.forEach((c, id) => {
      const p = pa.get(id);
      if (!p) { added.push(c); return; }
      const props: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(p), ...Object.keys(c)])) if (!same(p[key], c[key])) props[key] = c[key] === undefined ? null : c[key];
      if (Object.keys(props).length) changed[id] = props;
    });
    pa.forEach((_p, id) => { if (!ch.has(id)) removed.push(id); });
    // the order of elements matters little, but keep the child's order when it differs
    const order = (child[k] as { id: string }[]).map((x) => x.id);
    const parentOrder = (parent[k] as { id: string }[]).map((x) => x.id).filter((id) => ch.has(id));
    const reordered = !same(order.filter((id) => pa.has(id)), parentOrder);
    if (Object.keys(changed).length || added.length || removed.length || reordered) d[k] = { ...(Object.keys(changed).length ? { changed } : {}), ...(added.length ? { added } : {}), ...(removed.length ? { removed } : {}), ...(reordered ? { order } : {}) } as CaseDiff[ListKey];
  }
  const fields: Record<string, unknown> = {};
  const pr = parent as unknown as Record<string, unknown>, cr = child as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(pr), ...Object.keys(cr)])) {
    if ((LISTS as readonly string[]).includes(key)) continue;
    if (!same(pr[key], cr[key])) fields[key] = cr[key] === undefined ? null : cr[key];
  }
  if (Object.keys(fields).length) d.fields = fields;
  return d;
}

/** The child model: the parent with the differences applied. */
export function applyDiff(parent: Model, d: CaseDiff): Model {
  const m = structuredClone(parent) as unknown as Record<string, unknown>;
  for (const k of LISTS) {
    const dk = d[k];
    if (!dk) continue;
    let list = (m[k] as Record<string, unknown>[]).filter((x) => !dk.removed?.includes(x.id as string));
    list = list.map((x) => {
      const c = dk.changed?.[x.id as string];
      if (!c) return x;
      const y = { ...x };
      for (const [key, v] of Object.entries(c)) { if (v === null) delete y[key]; else y[key] = structuredClone(v); }
      return y;
    });
    list.push(...(structuredClone(dk.added ?? []) as Record<string, unknown>[]).filter((a) => !list.some((x) => x.id === a.id)));
    if (dk.order) { const pos = new Map(dk.order.map((id, i) => [id, i])); list.sort((a, b) => (pos.get(a.id as string) ?? 1e9) - (pos.get(b.id as string) ?? 1e9)); }
    m[k] = list;
  }
  for (const [key, v] of Object.entries(d.fields ?? {})) { if (v === null) delete m[key]; else m[key] = structuredClone(v); }
  return m as unknown as Model;
}

/** How many properties a child case changes (for the Cases table). */
export function diffSize(d: CaseDiff | undefined): number {
  if (!d) return 0;
  let n = Object.keys(d.fields ?? {}).length;
  for (const k of LISTS) { const x = d[k]; if (x) n += Object.values(x.changed ?? {}).reduce((s, c) => s + Object.keys(c).length, 0) + (x.added?.length ?? 0) + (x.removed?.length ?? 0); }
  return n;
}

/** Resolve every case's model from its parent chain (parents before children; cycles and missing parents make the
 *  case a root with its last known model). */
export function resolveCases(cases: ModelCase[]): ModelCase[] {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const done = new Map<string, ModelCase>();
  const visit = (c: ModelCase, stack: Set<string>): ModelCase => {
    const hit = done.get(c.id);
    if (hit) return hit;
    let out: ModelCase = c;
    const p = c.parent ? byId.get(c.parent) : undefined;
    if (c.parent && p && !stack.has(p.id) && c.diff) {
      stack.add(c.id);
      const pr = visit(p, stack);
      out = { ...c, model: applyDiff(pr.model, c.diff) };
    } else if (c.parent && (!p || stack.has(c.parent))) {
      out = { ...c, parent: undefined, diff: undefined };
    }
    done.set(c.id, out);
    return out;
  };
  return cases.map((c) => visit(c, new Set()));
}

/** Make sure the project has a case list with the current model as the active case. */
export function ensureCases(n: Network): Network {
  if (n.cases?.length && n.activeCase) return n;
  const id = newId();
  return { ...n, cases: [{ id, name: 'Base case', model: strip(n) }], activeCase: id };
}

/** Store the model being edited into its case slot (as differences when the case has a parent) and bring every
 *  child case up to date with its parent. */
export function syncActive(n: Network): ModelCase[] {
  const cur = strip(n);
  let cases = (n.cases ?? []).map((c) => (c.id === n.activeCase ? { ...c, model: cur } : c));
  const act = cases.find((c) => c.id === n.activeCase);
  if (act?.parent) {
    const parent = resolveCases(cases).find((c) => c.id === act.parent);
    if (parent) cases = cases.map((c) => (c.id === act.id ? { ...c, diff: diffModel(parent.model, cur) } : c));
  }
  if (!cases.some((c) => c.parent)) return cases;
  // children follow their parents, except the case being edited, which is what the user sees
  return resolveCases(cases).map((c) => (c.id === n.activeCase ? { ...c, model: cur } : c));
}
export function switchCase(n: Network, id: string): Network {
  const cases = syncActive(n);
  const target = cases.find((c) => c.id === id);
  if (!target) return n;
  return { ...structuredClone(target.model), cases, activeCase: id } as Network;
}
/** New case from the current one. With inherit, it is a child that keeps only its own changes. */
export function addCase(n: Network, name: string, inherit = false): Network {
  const base = ensureCases(n);
  const cases = syncActive(base);
  const id = newId();
  const c: ModelCase = inherit ? { id, name, parent: base.activeCase, diff: {}, model: strip(base) } : { id, name, model: strip(base) };
  return { ...base, cases: [...cases, c], activeCase: id };
}
/** Turn a child case into a complete, independent copy. */
export function detachCase(n: Network, id: string): Network {
  const cases = syncActive(n).map((c) => (c.id === id ? { ...c, parent: undefined, diff: undefined } : c));
  return { ...n, cases };
}
/** Cases for saving: child cases keep only their differences. */
export function casesForFile(cases: ModelCase[] | undefined): ModelCase[] | undefined {
  return cases?.map((c) => (c.parent && c.diff ? ({ id: c.id, name: c.name, notes: c.notes, parent: c.parent, diff: c.diff } as ModelCase) : c));
}
/** Delete a case; its children become complete copies first. */
export function deleteCase(n: Network, id: string): Network {
  let cases = syncActive(n).map((c) => (c.parent === id ? { ...c, parent: undefined, diff: undefined } : c)).filter((c) => c.id !== id);
  if (!cases.length) return n;
  cases = resolveCases(cases);
  if (id === n.activeCase) return { ...structuredClone(cases[0].model), cases, activeCase: cases[0].id } as Network;
  return { ...n, cases };
}
