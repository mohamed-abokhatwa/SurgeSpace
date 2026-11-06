// Display units. The model and the engine always work in SI (m, m³/s, m head); these helpers convert only for
// showing and typing values. The choice is a small global store so every panel follows it without prop drilling.
import { useSyncExternalStore } from 'react';

export type UnitSystem = 'SI' | 'US';
export type Quantity =
  | 'length' | 'elevation' | 'head' | 'diameter' | 'smallDiameter' | 'flow' | 'velocity' | 'volume' | 'pressureHead'
  | 'wavespeed' | 'inertia' | 'power' | 'time' | 'area' | 'accel' | 'none';

export const FLOW_UNITS = { SI: ['L/s', 'm³/h', 'm³/s', 'ML/d'], US: ['gpm', 'cfs', 'MGD'] } as const;
export const PRESSURE_UNITS = { SI: ['m', 'kPa', 'bar'], US: ['psi', 'ft'] } as const;

export interface UnitPrefs { system: UnitSystem; flow: string; pressure: string }

const FLOW_F: Record<string, number> = { 'L/s': 1000, 'm³/h': 3600, 'm³/s': 1, 'ML/d': 86.4, gpm: 15850.3231, cfs: 35.3146667, MGD: 22.8244653 };
// pressure from metres of water head
const PRESS_F: Record<string, number> = { m: 1, kPa: 9.7890, bar: 0.097890, psi: 1.41976, ft: 3.28084 };

const DEFAULT: UnitPrefs = { system: 'SI', flow: 'L/s', pressure: 'm' };
let prefs: UnitPrefs = (() => {
  try { const s = localStorage.getItem('surgespace.units'); if (s) return { ...DEFAULT, ...JSON.parse(s) } as UnitPrefs; } catch { /* storage blocked */ }
  return DEFAULT;
})();
const subs = new Set<() => void>();
export const getUnits = () => prefs;
export function setUnits(p: Partial<UnitPrefs>) {
  let next = { ...prefs, ...p };
  // switching system picks that system's usual flow and pressure units
  if (p.system && p.system !== prefs.system) next = { ...next, flow: p.flow ?? FLOW_UNITS[p.system][0], pressure: p.pressure ?? PRESSURE_UNITS[p.system][0] };
  prefs = next;
  try { localStorage.setItem('surgespace.units', JSON.stringify(prefs)); } catch { /* storage blocked */ }
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useUnits = () => useSyncExternalStore(subscribe, getUnits, getUnits);

/** Factor (shown = SI × factor) and label for a quantity under the given preferences. */
export function unitOf(q: Quantity, p: UnitPrefs | UnitSystem = prefs): { f: number; u: string } {
  const P: UnitPrefs = typeof p === 'string' ? { system: p, flow: FLOW_UNITS[p][0], pressure: PRESSURE_UNITS[p][0] } : p;
  const us = P.system === 'US';
  switch (q) {
    case 'length': case 'elevation': case 'head': return us ? { f: 3.28084, u: 'ft' } : { f: 1, u: 'm' };
    case 'diameter': return us ? { f: 39.3701, u: 'in' } : { f: 1000, u: 'mm' };
    case 'smallDiameter': return us ? { f: 39.3701, u: 'in' } : { f: 1000, u: 'mm' };
    case 'flow': { const u = FLOW_F[P.flow] ? P.flow : FLOW_UNITS[P.system][0]; return { f: FLOW_F[u], u }; }
    case 'velocity': case 'wavespeed': return us ? { f: 3.28084, u: 'ft/s' } : { f: 1, u: 'm/s' };
    case 'accel': return us ? { f: 3.28084, u: 'ft/s²' } : { f: 1, u: 'm/s²' };
    case 'volume': return us ? { f: 35.3147, u: 'ft³' } : { f: 1, u: 'm³' };
    case 'area': return us ? { f: 10.7639, u: 'ft²' } : { f: 1, u: 'm²' };
    case 'pressureHead': { const u = PRESS_F[P.pressure] ? P.pressure : PRESSURE_UNITS[P.system][0]; return { f: PRESS_F[u], u }; }
    case 'inertia': return us ? { f: 23.7304, u: 'lb·ft²' } : { f: 1, u: 'kg·m²' };
    case 'power': return us ? { f: 1.34102, u: 'hp' } : { f: 1, u: 'kW' };
    case 'time': return { f: 1, u: 's' };
    default: return { f: 1, u: '' };
  }
}
/** SI value → shown value. A system name uses that system's default units (for tests and exports). */
export const toShow = (v: number, q: Quantity, p: UnitPrefs | UnitSystem = prefs) => v * unitOf(q, p).f;
export const fromShow = (v: number, q: Quantity, p: UnitPrefs | UnitSystem = prefs) => v / unitOf(q, p).f;
export const uLabel = (q: Quantity, p: UnitPrefs | UnitSystem = prefs) => unitOf(q, p).u;
/** Formatted value with its unit, e.g. "32.8 ft". */
export function fmtQ(v: number | undefined, q: Quantity, d = 1, p: UnitPrefs = prefs): string {
  if (v === undefined || !Number.isFinite(v)) return '—';
  const { f, u } = unitOf(q, p);
  return `${(v * f).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })}${u ? ' ' + u : ''}`;
}

/** Map the SI unit written in an existing label "(mm)" to a quantity, so older editors convert automatically. */
const LABEL_Q: Record<string, Quantity> = {
  mm: 'diameter', m: 'length', 'L/s': 'flow', 'm³/s': 'flow', 'm³': 'volume', 'm/s': 'velocity', 'kg·m²': 'inertia', 'm/s²': 'accel', kW: 'power',
};
/** Rewrite "Label (mm)" for the current units; returns the quantity found (or null to leave the field as it is). */
export function convertLabel(label: string, p: UnitPrefs = prefs): { label: string; q: Quantity | null } {
  const m = label.match(/\(([^()]+)\)\s*$/);
  if (!m) return { label, q: null };
  const unit = m[1].trim();
  let q = LABEL_Q[unit] ?? null;
  // a head or pressure label stays a head unless it says pressure
  if (q === 'length' && /press|set|burst|head/i.test(label) && /press/i.test(label)) q = 'pressureHead';
  if (!q) return { label, q: null };
  return { label: label.replace(/\(([^()]+)\)\s*$/, `(${unitOf(q, p).u})`), q };
}
