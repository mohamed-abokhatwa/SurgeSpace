// Surge protection device physics, kept free of the time loop so each relation can be tested on its own.
import { G, HB, RHO, type AirValve, type SurgeVessel } from './types';

export const RAIR = 287.1; // J/(kg·K)
export const TAIR = 293.15; // K
export const CD_AIR = 0.6;
/** Density of "normal" air (0 °C, 101.325 kPa), for manufacturer curves in Nm³/h. */
export const RHO_NORMAL = 1.293;

// ── tank geometry ───────────────────────────────────────────────────────
export interface VesselGeometry {
  shape: 'vertical' | 'horizontal' | 'sphere';
  /** Internal diameter, m. */
  D: number;
  /** Vertical: height; horizontal: length; sphere: = D. */
  L: number;
  /** Total internal height, m. */
  height: number;
  volume: number;
}

export function vesselGeometry(v: Pick<SurgeVessel, 'volume' | 'shape' | 'diameter'>): VesselGeometry {
  const V = v.volume;
  const shape = v.shape ?? 'vertical';
  if (shape === 'sphere') {
    const D = Math.cbrt((6 * V) / Math.PI);
    return { shape, D, L: D, height: D, volume: V };
  }
  const D = v.diameter && v.diameter > 0 ? v.diameter : shape === 'vertical' ? Math.cbrt((2 * V) / Math.PI) : Math.cbrt((4 * V) / (3 * Math.PI));
  const L = V / ((Math.PI / 4) * D * D);
  return { shape, D, L, height: shape === 'vertical' ? L : D, volume: V };
}

/** Water volume (m³) for a water depth h (m) above the tank bottom. */
export function waterVolumeAt(g: VesselGeometry, h: number): number {
  const hh = Math.max(0, Math.min(g.height, h));
  const R = g.D / 2;
  if (g.shape === 'vertical') return (Math.PI / 4) * g.D * g.D * hh;
  if (g.shape === 'sphere') return (Math.PI * hh * hh * (3 * R - hh)) / 3;
  // horizontal cylinder: circular segment area × length
  const seg = R * R * Math.acos((R - hh) / R) - (R - hh) * Math.sqrt(Math.max(2 * R * hh - hh * hh, 0));
  return seg * g.L;
}

/** Water depth (m) above the tank bottom for a water volume Vw (m³). Inverse of waterVolumeAt. */
export function waterDepthOf(g: VesselGeometry, Vw: number): number {
  if (Vw <= 0) return 0;
  if (Vw >= g.volume) return g.height;
  if (g.shape === 'vertical') return Vw / ((Math.PI / 4) * g.D * g.D);
  let lo = 0, hi = g.height;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (waterVolumeAt(g, mid) < Vw) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Initial gas volume of a bladder tank from its pre-charge (isothermal charging: p_pre·V = p0·Vg).
 *  `headAt(Vg)` gives the absolute gas head at the operating point for a gas volume (it depends on the water level). */
export function prechargeGas(V: number, prechargeHead: number, headAt: (Vg: number) => number): { gas: number; holdsWater: boolean } {
  const pre = prechargeHead + HB;
  let Vg = V * 0.5;
  for (let k = 0; k < 50; k++) {
    const p0 = headAt(Vg);
    if (!(p0 > 0)) return { gas: V, holdsWater: false };
    const next = Math.min(V, (V * pre) / p0);
    if (Math.abs(next - Vg) < 1e-12 * V) { Vg = next; break; }
    Vg = next;
  }
  return { gas: Vg, holdsWater: Vg < V * 0.999 };
}

// ── air valves ─────────────────────────────────────────────────────────
const area = (d: number) => (Math.PI / 4) * d * d;
const pAtm = () => RHO * G * HB;

/** Isentropic orifice mass flow (kg/s) from upstream absolute pressure pu to downstream pd (pu > pd). */
export function orificeMassFlow(cdA: number, pu: number, pd: number): number {
  if (pu <= pd || cdA <= 0) return 0;
  const r = pd / pu;
  if (r > 0.528) return cdA * pu * Math.sqrt((7 / (RAIR * TAIR)) * Math.max(r ** 1.4286 - r ** 1.714, 0));
  return (cdA * 0.686 * pu) / Math.sqrt(RAIR * TAIR);
}

/** Linear interpolation in a manufacturer curve [kPa, Nm³/h] → kg/s. Beyond the last point the flow follows √Δp. */
export function curveMassFlow(curve: [number, number][] | undefined, dpKPa: number): number {
  if (!curve || curve.length === 0 || dpKPa <= 0) return 0;
  const pts = [...curve].filter((p) => p[0] >= 0 && p[1] >= 0).sort((a, b) => a[0] - b[0]);
  if (!pts.length) return 0;
  const all = pts[0][0] > 0 ? [[0, 0] as [number, number], ...pts] : pts;
  let q: number;
  const last = all[all.length - 1];
  if (dpKPa >= last[0]) q = last[0] > 0 ? last[1] * Math.sqrt(dpKPa / last[0]) : last[1];
  else {
    let k = 1;
    while (all[k][0] < dpKPa) k++;
    const [x0, y0] = all[k - 1], [x1, y1] = all[k];
    q = y0 + ((y1 - y0) * (dpKPa - x0)) / (x1 - x0 || 1);
  }
  return (q * RHO_NORMAL) / 3600;
}

export interface AirValveModel {
  type: NonNullable<AirValve['type']>;
  cdAin: number;
  cdAout: number;
  cdAsmall: number;
  switchP: number; // overpressure (Pa) where a three-stage valve changes to its small orifice
  inCurve?: [number, number][];
  outCurve?: [number, number][];
}

export function airValveModel(a: AirValve): AirValveModel {
  const type = a.type ?? 'double';
  const cdIn = a.cdIn ?? CD_AIR, cdOut = a.cdOut ?? CD_AIR;
  const small = a.smallDiameter ?? (type === 'threeStage' || type === 'releaseOnly' ? Math.max(a.outDiameter / 10, 0.002) : 0);
  return {
    type,
    cdAin: type === 'releaseOnly' ? 0 : cdIn * area(a.inDiameter),
    cdAout: type === 'vacuumBreaker' || type === 'releaseOnly' ? 0 : cdOut * area(a.outDiameter),
    cdAsmall: type === 'vacuumBreaker' ? 0 : cdOut * area(small),
    switchP: RHO * G * (a.switchHead ?? 0.3),
    inCurve: a.inCurve,
    outCurve: a.outCurve,
  };
}

/** Air mass flow into the pipe (kg/s, negative = out) at absolute pipe pressure p (Pa), with m kg of air inside. */
export function airValveMassRate(m: AirValveModel, p: number, airMass: number): number {
  const pa = pAtm();
  if (p < pa) {
    if (m.type === 'curve') return curveMassFlow(m.inCurve, (pa - p) / 1000);
    return orificeMassFlow(m.cdAin, pa, p);
  }
  if (airMass <= 0) return 0;
  if (m.type === 'curve') return -curveMassFlow(m.outCurve, (p - pa) / 1000);
  let cdA: number;
  if (m.type === 'threeStage') cdA = p - pa > m.switchP ? m.cdAsmall : m.cdAout;
  else if (m.type === 'releaseOnly') cdA = m.cdAsmall;
  else cdA = m.cdAout + m.cdAsmall;
  return -orificeMassFlow(cdA, p, pa);
}

/** Flow curve of an orifice valve in manufacturer form (for comparison or to start a curve). */
export function orificeCurve(cdA: number, inflow: boolean, dps = [0, 2, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90]): [number, number][] {
  const pa = pAtm();
  return dps.map((dp) => {
    const kg = inflow ? orificeMassFlow(cdA, pa, Math.max(pa - dp * 1000, 1)) : orificeMassFlow(cdA, pa + dp * 1000, pa);
    return [dp, (kg * 3600) / RHO_NORMAL] as [number, number];
  });
}

// ── relief valve ───────────────────────────────────────────────────────
/** Relief valve discharge (m³/s) at pressure head p (m). */
export function reliefFlow(r: { setHead: number; capacity: number; diameter?: number; cd?: number; accumulation?: number }, p: number): number {
  if (p <= r.setHead) return 0;
  if (r.diameter && r.diameter > 0) {
    const acc = r.accumulation && r.accumulation > 0 ? r.accumulation : Math.max(0.1 * r.setHead, 0.5);
    const lift = Math.min(1, (p - r.setHead) / acc);
    return (r.cd ?? 0.7) * area(r.diameter) * lift * Math.sqrt(2 * G * p);
  }
  return r.capacity * Math.sqrt((p - r.setHead) / 10);
}

// ── surge anticipation valve ──────────────────────────────────────────
/** Opening fraction (0–1) of a surge anticipation valve, t seconds after it was triggered. */
export function savOpening(s: { openTime: number; holdTime: number; closeTime: number }, t: number): number {
  if (t < 0) return 0;
  const to = Math.max(s.openTime, 1e-6), th = Math.max(s.holdTime, 0), tc = Math.max(s.closeTime, 1e-6);
  if (t < to) return t / to;
  if (t < to + th) return 1;
  if (t < to + th + tc) return 1 - (t - to - th) / tc;
  return 0;
}

/** Bracketed safeguarded Newton for a decreasing function f on [lo, hi]. Returns the root (or the bound). */
export function solveDecreasing(f: (x: number) => number, lo: number, hi: number, guess: number): number {
  let flo = f(lo);
  if (flo <= 0) return lo;
  const fhi = f(hi);
  if (fhi >= 0) return hi;
  let x = guess > lo && guess < hi ? guess : (lo + hi) / 2;
  for (let k = 0; k < 80; k++) {
    const fx = f(x);
    if (Math.abs(fx) < 1e-11) break;
    if (fx > 0) { lo = x; flo = fx; } else hi = x;
    const h = 1e-7 * Math.max(1, Math.abs(x));
    const d = (f(x + h) - fx) / h;
    let xn = d < 0 ? x - fx / d : (lo + hi) / 2;
    if (!(xn > lo && xn < hi)) xn = (lo + hi) / 2;
    if (Math.abs(xn - x) < 1e-13 * Math.max(1, Math.abs(x))) { x = xn; break; }
    x = xn;
  }
  void flo;
  return x;
}
