// Shared hydraulic relations: friction, pump curves, valve losses.
import { G, RHO, area, type Pipe, type Pump, type Valve } from './types';

const NU = 1.004e-6; // kinematic viscosity at 20 °C, m²/s

/** Darcy friction factor: laminar 64/Re, Swamee–Jain turbulent, blended through transition. */
export function darcyF(q: number, d: number, epsMm: number): number {
  const v = Math.abs(q) / area(d);
  const re = Math.max((v * d) / NU, 1);
  const lam = 64 / re;
  const rr = epsMm / 1000 / d;
  const turb = 0.25 / Math.log10(rr / 3.7 + 5.74 / Math.max(re, 4000) ** 0.9) ** 2;
  if (re <= 2000) return lam;
  if (re >= 4000) return turb;
  const w = (re - 2000) / 2000; // smooth blend so Newton never jumps
  return lam * (1 - w) + turb * w;
}

/** Equivalent Darcy f for a Hazen–Williams C at the given flow (so one transient engine serves both). */
export function hwF(q: number, d: number, c: number, length = 1): number {
  const qa = Math.max(Math.abs(q), 1e-6);
  const h = (10.67 * length * qa ** 1.852) / (c ** 1.852 * d ** 4.87);
  return (h * 2 * G * d * area(d) ** 2) / (length * qa * qa);
}

export function frictionF(p: Pipe, q: number, model: 'DW' | 'HW'): number {
  return model === 'HW' ? hwF(q, p.diameter, p.roughness) : darcyF(q, p.diameter, p.roughness);
}

/** Pipe head loss coefficient r in h = r·Q|Q| (friction + minor losses). */
export function pipeR(p: Pipe, q: number, model: 'DW' | 'HW'): number {
  const A = area(p.diameter);
  const f = frictionF(p, q, model);
  return (f * p.length) / (2 * G * p.diameter * A * A) + (p.minorLoss ?? 0) / (2 * G * A * A);
}

/** Quadratic through the three curve points: H = a + bQ + cQ² at rated speed. */
export function pumpQuadratic(pump: Pump): { a: number; b: number; c: number } {
  const pts = [...pump.curve].sort((p1, p2) => p1[0] - p2[0]);
  if (pts.length === 1) {
    // single design point (EPANET style): shutoff 133 % of design head, max flow 200 % of design flow
    const [q, h] = pts[0];
    const a = 1.33334 * h;
    return { a, b: 0, c: -(a - h) / (q * q) };
  }
  const [[x0, y0], [x1, y1], [x2, y2]] = pts.length >= 3 ? pts : [pts[0], pts[1], [pts[1][0] * 1.5, pts[1][1] * 0.5]];
  const d = (x0 - x1) * (x0 - x2) * (x1 - x2);
  const c = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / d;
  const b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / d;
  const a = (x1 * x2 * (x1 - x2) * y0 + x2 * x0 * (x2 - x0) * y1 + x0 * x1 * (x0 - x1) * y2) / d;
  return { a, b, c };
}

/** Rated (best-efficiency) flow: the middle curve point, or the single design point. */
export function pumpRatedQ(pump: Pump): number {
  const pts = [...pump.curve].sort((p1, p2) => p1[0] - p2[0]);
  return pts.length === 1 ? pts[0][0] : pts[1][0];
}

export const omegaRated = (pump: Pump) => (2 * Math.PI * pump.speed) / 60;

/** Efficiency vs flow at rated speed: parabola peaking at the rated point. */
export function pumpEff(pump: Pump, q: number): number {
  const qr = pumpRatedQ(pump);
  const x = q / qr;
  return Math.max(0.05, pump.efficiency * (2 * x - x * x));
}

/**
 * Homologous torque at rated speed fitted as T = ta + tb·Q + tc·Q² (N·m), from T = ρ g Q H / (η ω).
 * With the head curve, the homologous forms H = aα² + bαQ + cQ² and T = taα² + tbαQ + tcQ² stay smooth at α → 0.
 */
export function pumpTorqueQuadratic(pump: Pump): { ta: number; tb: number; tc: number } {
  const { a, b, c } = pumpQuadratic(pump);
  const qr = pumpRatedQ(pump);
  const w = omegaRated(pump);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i <= 24; i++) {
    const q = (qr * 1.4 * i) / 24;
    const h = Math.max(a + b * q + c * q * q, 0);
    xs.push(q);
    ys.push((RHO * G * q * h) / (pumpEff(pump, q) * w));
  }
  // least squares on [1, q, q²]
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    s0 += 1; s1 += x; s2 += x * x; s3 += x ** 3; s4 += x ** 4;
    t0 += y; t1 += x * y; t2 += x * x * y;
  }
  const M = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]];
  const r = solveDense(M, [t0, t1, t2]);
  return { ta: r[0], tb: r[1], tc: r[2] };
}

/** Thorley's correlations for pump and motor inertia (P in kW at rated duty, N in rpm), kg·m². */
export function estimateInertia(powerKW: number, rpm: number): number {
  const pumpI = 1.5e7 * (powerKW / rpm ** 3) ** 0.9556;
  const motorI = 118 * (powerKW / rpm) ** 1.48;
  return pumpI + motorI;
}

export function valveKv(v: Valve, opening: number): number {
  const A = area(v.diameter);
  const tau = Math.max(opening, 0);
  if (tau <= 0) return Infinity;
  return v.k0 / (2 * G * A * A * tau * tau);
}

/** Gaussian elimination with partial pivoting (small dense systems). */
export function solveDense(Ain: number[][], bin: number[]): number[] {
  const n = bin.length;
  const A = Ain.map((r) => r.slice());
  const b = bin.slice();
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(A[i][k]) > Math.abs(A[p][k])) p = i;
    if (p !== k) {
      [A[k], A[p]] = [A[p], A[k]];
      [b[k], b[p]] = [b[p], b[k]];
    }
    const piv = A[k][k] || 1e-30;
    for (let i = k + 1; i < n; i++) {
      const f = A[i][k] / piv;
      if (f === 0) continue;
      for (let j = k; j < n; j++) A[i][j] -= f * A[k][j];
      b[i] -= f * b[k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / (A[i][i] || 1e-30);
  }
  return x;
}
