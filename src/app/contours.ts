// Contour lines of a node value (elevation, pressure, head) over the drawing: inverse-distance interpolation on a
// grid, masked away from the network, then marching squares at round levels.

export interface ContourSet { levels: number[]; segs: { k: number; x1: number; y1: number; x2: number; y2: number }[]; lo: number; hi: number }

function niceLevels(lo: number, hi: number, n = 8): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [];
  const raw = span / n, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v < hi; v += step) out.push(+v.toFixed(10));
  return out;
}

export function computeContours(pts: { x: number; y: number; v: number }[], opt: { cells?: number; levels?: number[] } = {}): ContourSet | null {
  const P = pts.filter((p) => Number.isFinite(p.v) && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (P.length < 3) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, lo = Infinity, hi = -Infinity;
  for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); }
  const W = Math.max(x1 - x0, 1e-9), H = Math.max(y1 - y0, 1e-9);
  const cells = opt.cells ?? 90;
  const h = Math.max(W, H) / cells;
  const nx = Math.ceil(W / h) + 3, ny = Math.ceil(H / h) + 3;
  const ox = x0 - h, oy = y0 - h;
  // mask: a cell counts only if a node lies within a few cells (no extrapolation into empty land)
  const reach = Math.max(3 * h, Math.sqrt((W * H) / P.length) * 1.2);
  // bucket the points for a fast neighbour search
  const bs = reach, bx = Math.ceil((nx * h) / bs) + 1;
  const buckets = new Map<number, typeof P>();
  for (const p of P) { const k = Math.floor((p.x - ox) / bs) + bx * Math.floor((p.y - oy) / bs); (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(p); }
  const val = new Float64Array(nx * ny).fill(NaN);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = ox + i * h, y = oy + j * h;
    const bi = Math.floor((x - ox) / bs), bj = Math.floor((y - oy) / bs);
    let sw = 0, sv = 0, near = Infinity, exact = NaN;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const list = buckets.get(bi + di + bx * (bj + dj));
      if (!list) continue;
      for (const p of list) {
        const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
        near = Math.min(near, d2);
        if (d2 < 1e-18) { exact = p.v; continue; }
        const w = 1 / (d2 * d2);
        sw += w; sv += w * p.v;
      }
    }
    if (Number.isFinite(exact)) val[i + j * nx] = exact;
    else if (near <= reach * reach && sw > 0) val[i + j * nx] = sv / sw;
  }
  const levels = opt.levels ?? niceLevels(lo, hi);
  const segs: ContourSet['segs'] = [];
  const lerp = (a: number, b: number, l: number) => (l - a) / (b - a || 1e-12);
  for (let k = 0; k < levels.length; k++) {
    const l = levels[k];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = val[i + j * nx], b = val[i + 1 + j * nx], c = val[i + 1 + (j + 1) * nx], d = val[i + (j + 1) * nx];
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
      const code = (a >= l ? 8 : 0) | (b >= l ? 4 : 0) | (c >= l ? 2 : 0) | (d >= l ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const x = ox + i * h, y = oy + j * h;
      const top = { x: x + h * lerp(a, b, l), y }, right = { x: x + h, y: y + h * lerp(b, c, l) };
      const bottom = { x: x + h * lerp(d, c, l), y: y + h }, left = { x, y: y + h * lerp(a, d, l) };
      const add = (p: { x: number; y: number }, q: { x: number; y: number }) => segs.push({ k, x1: p.x, y1: p.y, x2: q.x, y2: q.y });
      switch (code) {
        case 1: case 14: add(left, bottom); break;
        case 2: case 13: add(bottom, right); break;
        case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break;
        case 5: add(left, top); add(bottom, right); break;
        case 6: case 9: add(top, bottom); break;
        case 7: case 8: add(left, top); break;
        case 10: add(top, right); add(left, bottom); break;
      }
    }
  }
  return { levels, segs, lo, hi };
}
