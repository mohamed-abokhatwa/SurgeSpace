// Element libraries: pumps, valves, air valves, air vessels and pipe types saved once and reused in any project
// (kept on this device and exportable as a file to share with colleagues).
import { useSyncExternalStore } from 'react';
import type { AirValve, Network, Pipe, Pump, SurgeVessel, Valve } from '../engine/types';

export type LibKind = 'pump' | 'valve' | 'airValve' | 'vessel' | 'pipe';
export interface LibItem { id: string; kind: LibKind; name: string; note?: string; data: Record<string, unknown> }

const LS = 'surgespace.library';
const GENERIC: LibItem[] = [
  ...[50, 80, 100, 150, 200].map((d): LibItem => ({ id: `g-av${d}`, kind: 'airValve', name: `Double-orifice air valve DN${d} (generic)`, note: 'Generic sizes: use the manufacturer’s data for design.', data: { inDiameter: d / 1000, outDiameter: Math.max(d / 1000 / 4, 0.008), smallDiameter: 0.002, type: 'double' } })),
  ...[100, 150, 200].map((d): LibItem => ({ id: `g-avk${d}`, kind: 'airValve', name: `Anti-slam (three-stage) air valve DN${d} (generic)`, note: 'Generic sizes.', data: { inDiameter: d / 1000, outDiameter: d / 1000 / 2, smallDiameter: 0.003, type: 'threeStage', switchHead: 0.3 } })),
  { id: 'g-pipe-di', kind: 'pipe', name: 'Ductile iron K9 (typical)', data: { material: 'Ductile iron', roughness: 0.1, wavespeed: 1100, pressureClass: 160 } },
  { id: 'g-pipe-pe', kind: 'pipe', name: 'HDPE PE100 SDR11 (typical)', data: { material: 'HDPE', roughness: 0.007, wavespeed: 300, pressureClass: 160 } },
  { id: 'g-pipe-pvc', kind: 'pipe', name: 'uPVC PN16 (typical)', data: { material: 'PVC', roughness: 0.007, wavespeed: 420, pressureClass: 160 } },
  { id: 'g-pipe-st', kind: 'pipe', name: 'Steel, cement lined (typical)', data: { material: 'Steel', roughness: 0.05, wavespeed: 1150, pressureClass: 250 } },
];

let items: LibItem[] = load();
const subs = new Set<() => void>();
function load(): LibItem[] { try { const s = localStorage.getItem(LS); if (s) return JSON.parse(s); } catch { /* storage blocked */ } return []; }
function save() { try { localStorage.setItem(LS, JSON.stringify(items)); } catch { /* storage blocked */ } subs.forEach((f) => f()); }
const snapshot = () => items;
export const useLibrary = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, snapshot, snapshot);
export const allItems = (user = items) => [...user, ...GENERIC];

const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, structuredClone(o[k])])) as Record<string, unknown>;
export const PUMP_KEYS: (keyof Pump)[] = ['curve', 'efficiency', 'speed', 'inertia', 'checkValve', 'checkSpec', 'power', 'fourQuadrant', 'suter'];
export const VALVE_KEYS: (keyof Valve)[] = ['diameter', 'k0', 'law', 'lawCurve', 'check', 'checkSpec', 'pbv', 'gpv'];
export const PIPE_KEYS: (keyof Pipe)[] = ['diameter', 'roughness', 'wavespeed', 'material', 'wall', 'pressureClass', 'minorLoss', 'viscoelastic'];

export function addItem(kind: LibKind, name: string, source: Pump | Valve | AirValve | SurgeVessel | Pipe, note?: string) {
  const data = kind === 'pump' ? pick(source as Pump, PUMP_KEYS) : kind === 'valve' ? pick(source as Valve, VALVE_KEYS) : kind === 'pipe' ? pick(source as Pipe, PIPE_KEYS) : structuredClone(source as object) as Record<string, unknown>;
  items = [...items, { id: Math.random().toString(36).slice(2, 10), kind, name, note, data }];
  save();
}
export function removeItem(id: string) { items = items.filter((i) => i.id !== id); save(); }
export function importItems(json: string): number {
  const arr = JSON.parse(json);
  const list: LibItem[] = (Array.isArray(arr) ? arr : arr.items ?? []).filter((x: LibItem) => x && x.kind && x.name && x.data);
  const ids = new Set(items.map((i) => i.id));
  items = [...items, ...list.map((x) => (ids.has(x.id) ? { ...x, id: Math.random().toString(36).slice(2, 10) } : x))];
  save();
  return list.length;
}
export const exportItems = () => JSON.stringify({ app: 'SurgeSpace', library: 1, items }, null, 1);

/** Apply a library item to elements of the model (by id). */
export function applyItem(net: Network, it: LibItem, ids: string[]): Network {
  const set = new Set(ids);
  switch (it.kind) {
    case 'pump': return { ...net, pumps: net.pumps.map((p) => (set.has(p.id) ? { ...p, ...structuredClone(it.data) } as Pump : p)) };
    case 'valve': return { ...net, valves: net.valves.map((v) => (set.has(v.id) ? { ...v, ...structuredClone(it.data) } as Valve : v)) };
    case 'pipe': return { ...net, pipes: net.pipes.map((p) => (set.has(p.id) ? { ...p, ...structuredClone(it.data) } as Pipe : p)) };
    case 'airValve': return { ...net, nodes: net.nodes.map((n) => (set.has(n.id) && n.kind === 'junction' ? { ...n, airValve: structuredClone(it.data) as unknown as AirValve } : n)) };
    case 'vessel': return { ...net, nodes: net.nodes.map((n) => (set.has(n.id) && n.kind === 'junction' ? { ...n, vessel: structuredClone(it.data) as unknown as SurgeVessel } : n)) };
  }
}
