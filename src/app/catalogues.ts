// Catalogues: liquids, pipe materials, standard sizes, and the wave speed calculator.
import type { FluidSpec } from '../engine/types';

/** Water from 0 to 100 °C (density kg/m³, vapour pressure kPa abs, kinematic viscosity m²/s, bulk modulus GPa),
 *  plus a few other liquids met in pipelines. */
const W: [number, number, number, number, number][] = [
  // T, rho, pv, nu, K
  [0, 999.8, 0.611, 1.787e-6, 2.02],
  [5, 1000.0, 0.872, 1.519e-6, 2.06],
  [10, 999.7, 1.228, 1.307e-6, 2.10],
  [15, 999.1, 1.705, 1.139e-6, 2.15],
  [20, 998.2, 2.338, 1.004e-6, 2.19],
  [25, 997.0, 3.169, 0.893e-6, 2.22],
  [30, 995.7, 4.246, 0.801e-6, 2.25],
  [40, 992.2, 7.384, 0.658e-6, 2.28],
  [50, 988.0, 12.35, 0.553e-6, 2.29],
  [60, 983.2, 19.94, 0.475e-6, 2.28],
  [70, 977.8, 31.19, 0.413e-6, 2.25],
  [80, 971.8, 47.39, 0.365e-6, 2.20],
  [90, 965.3, 70.14, 0.326e-6, 2.14],
  [100, 958.4, 101.33, 0.295e-6, 2.07],
];
export const FLUIDS: FluidSpec[] = [
  ...W.map(([T, rho, pv, nu, K]) => ({ name: `Water ${T} °C`, temperature: T, density: rho, vapourPressure: pv, viscosity: nu, bulkModulus: K })),
  { name: 'Sea water 20 °C', temperature: 20, density: 1024.8, vapourPressure: 2.3, viscosity: 1.05e-6, bulkModulus: 2.34 },
  { name: 'Raw wastewater 20 °C', temperature: 20, density: 1002, vapourPressure: 2.34, viscosity: 1.1e-6, bulkModulus: 2.15 },
  { name: 'Treated effluent 25 °C', temperature: 25, density: 998, vapourPressure: 3.17, viscosity: 0.9e-6, bulkModulus: 2.2 },
  { name: 'Brine (RO reject) 25 °C', temperature: 25, density: 1050, vapourPressure: 3.0, viscosity: 1.0e-6, bulkModulus: 2.45 },
  { name: 'Diesel fuel 20 °C', temperature: 20, density: 840, vapourPressure: 0.5, viscosity: 3.5e-6, bulkModulus: 1.45 },
  { name: 'Light crude oil 20 °C', temperature: 20, density: 850, vapourPressure: 30, viscosity: 5e-6, bulkModulus: 1.5 },
];
export const DEFAULT_FLUID = FLUIDS.find((f) => f.name === 'Water 20 °C')!;

export interface PipeMaterial {
  id: string;
  name: string;
  /** Young's modulus, GPa. */
  E: number;
  poisson: number;
  /** Absolute roughness, mm (Darcy–Weisbach). */
  roughness: number;
  /** Hazen–Williams C. */
  hwC: number;
  /** Typical wall thickness as a fraction of the internal diameter (first guess for the calculator). */
  wallRatio: number;
  note?: string;
}
export const PIPE_MATERIALS: PipeMaterial[] = [
  { id: 'di', name: 'Ductile iron (cement lined)', E: 169, poisson: 0.28, roughness: 0.1, hwC: 130, wallRatio: 0.0165 },
  { id: 'steel', name: 'Carbon steel (lined)', E: 207, poisson: 0.3, roughness: 0.045, hwC: 120, wallRatio: 0.012 },
  { id: 'ss', name: 'Stainless steel', E: 193, poisson: 0.3, roughness: 0.015, hwC: 140, wallRatio: 0.01 },
  { id: 'ci', name: 'Grey cast iron (old)', E: 110, poisson: 0.25, roughness: 0.26, hwC: 100, wallRatio: 0.03 },
  { id: 'pvcu', name: 'PVC-U', E: 3.3, poisson: 0.45, roughness: 0.0015, hwC: 150, wallRatio: 0.06 },
  { id: 'pvco', name: 'PVC-O (oriented)', E: 4.0, poisson: 0.45, roughness: 0.0015, hwC: 150, wallRatio: 0.035 },
  { id: 'pe100', name: 'PE100 (HDPE)', E: 1.1, poisson: 0.46, roughness: 0.007, hwC: 150, wallRatio: 0.09, note: 'Short-term modulus; viscoelastic damping is not modelled.' },
  { id: 'grp', name: 'GRP / GRE', E: 25, poisson: 0.3, roughness: 0.03, hwC: 145, wallRatio: 0.015 },
  { id: 'pccp', name: 'Prestressed concrete (PCCP)', E: 35, poisson: 0.2, roughness: 0.3, hwC: 120, wallRatio: 0.08 },
  { id: 'rc', name: 'Reinforced concrete', E: 30, poisson: 0.2, roughness: 0.5, hwC: 110, wallRatio: 0.1 },
  { id: 'ac', name: 'Asbestos cement', E: 24, poisson: 0.2, roughness: 0.05, hwC: 140, wallRatio: 0.06 },
  { id: 'cu', name: 'Copper', E: 117, poisson: 0.34, roughness: 0.0015, hwC: 140, wallRatio: 0.04 },
];

export type Restraint = 'anchoredUpstream' | 'anchoredJoints' | 'expansionJoints';
export const RESTRAINTS: { id: Restraint; name: string }[] = [
  { id: 'anchoredJoints', name: 'Restrained along its length (buried, no axial movement)' },
  { id: 'anchoredUpstream', name: 'Anchored at the upstream end only' },
  { id: 'expansionJoints', name: 'Expansion joints throughout' },
];

/** Pressure wave speed (Korteweg with the restraint factor; thick-wall factor when D/e < 25).
 *  D and e in m, E and K in GPa, rho in kg/m³. */
export function waveSpeed(o: { D: number; e: number; E: number; nu: number; K: number; rho: number; restraint: Restraint }): number {
  const { D, e, nu } = o;
  const K = o.K * 1e9, E = o.E * 1e9;
  let c1: number;
  if (D / e >= 25) c1 = o.restraint === 'anchoredUpstream' ? 1 - nu / 2 : o.restraint === 'anchoredJoints' ? 1 - nu * nu : 1;
  else {
    const t = (2 * e) / D * (1 + nu);
    c1 = o.restraint === 'anchoredUpstream' ? t + (D * (1 - nu / 2)) / (D + e) : o.restraint === 'anchoredJoints' ? t + (D * (1 - nu * nu)) / (D + e) : t + D / (D + e);
  }
  const psi = (D / e) * c1;
  return Math.sqrt(K / o.rho / (1 + (K / E) * psi));
}

/** Standard nominal sizes (mm) offered in size pickers. */
export const DN_SIZES = [25, 32, 40, 50, 65, 80, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1400, 1600, 1800, 2000, 2200, 2400];
/** Standard pressure classes (bar) → head in m (×10.2). */
export const PN_CLASSES = [6, 10, 16, 20, 25, 32, 40];

/** Typical air valve orifice sizes by nominal valve size (mm): [large orifice, small orifice]. */
export const AIR_VALVE_SIZES: { dn: number; large: number; small: number }[] = [
  { dn: 50, large: 50, small: 1.6 }, { dn: 80, large: 80, small: 2.4 }, { dn: 100, large: 100, small: 3 },
  { dn: 150, large: 150, small: 3 }, { dn: 200, large: 200, small: 5 }, { dn: 250, large: 250, small: 5 }, { dn: 300, large: 300, small: 8 },
];
