// Real-world maps under the model: coordinates (UTM or Web Mercator), a street or satellite basemap built from
// web map tiles, and ground elevations from terrain tiles (for nodes and for pipe long sections).
// Model coordinates are metres in the chosen projected system.

export type CRS = { kind: 'utm'; zone: number; south: boolean } | { kind: 'webmercator' };

const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
const rad = Math.PI / 180;

/** WGS84 latitude/longitude (degrees) → UTM easting/northing (m). */
export function toUTM(lat: number, lon: number, zone: number, south: boolean): [number, number] {
  const phi = lat * rad, lam = lon * rad, lam0 = ((zone - 1) * 6 - 180 + 3) * rad;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256) * phi - ((3 * e2) / 8 + (3 * e2 ** 2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi) + ((15 * e2 ** 2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi) - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A * A / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (south) y += 10000000;
  return [x, y];
}

/** UTM easting/northing (m) → WGS84 latitude/longitude (degrees). */
export function fromUTM(x: number, y: number, zone: number, south: boolean): [number, number] {
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const M = (south ? y - 10000000 : y) / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 ** 2) / 64 - (5 * e2 ** 3) / 256));
  const phi1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2), T1 = Math.tan(phi1) ** 2, C1 = ep2 * Math.cos(phi1) ** 2;
  const R1 = (a * (1 - e2)) / (1 - e2 * Math.sin(phi1) ** 2) ** 1.5, D = (x - 500000) / (N1 * k0);
  const lat = phi1 - ((N1 * Math.tan(phi1)) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) / Math.cos(phi1);
  return [lat / rad, ((zone - 1) * 6 - 180 + 3) + lon / rad];
}

/** Model metres → latitude/longitude. */
export function toLatLon(crs: CRS, x: number, y: number): [number, number] {
  if (crs.kind === 'utm') return fromUTM(x, y, crs.zone, crs.south);
  return [(2 * Math.atan(Math.exp(y / a)) - Math.PI / 2) / rad, x / a / rad];
}
export function fromLatLon(crs: CRS, lat: number, lon: number): [number, number] {
  if (crs.kind === 'utm') return toUTM(lat, lon, crs.zone, crs.south);
  return [a * lon * rad, a * Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2))];
}
/** UTM zone of a longitude/latitude. */
export const utmZone = (lat: number, lon: number) => ({ zone: Math.floor((lon + 180) / 6) + 1, south: lat < 0 });

// ── web map tiles (Web Mercator, 256 px) ──
export const tileXY = (lat: number, lon: number, z: number): [number, number] => {
  const n = 2 ** z;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(lat * rad) + 1 / Math.cos(lat * rad)) / Math.PI) / 2) * n];
};
export interface TileSource { id: string; name: string; url: string; attribution: string; maxZoom: number }
export const BASEMAPS: TileSource[] = [
  { id: 'osm', name: 'Streets (OpenStreetMap)', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19 },
  { id: 'imagery', name: 'Satellite (Esri World Imagery)', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Imagery © Esri, Maxar, Earthstar Geographics', maxZoom: 19 },
  { id: 'topo', name: 'Topographic (OpenTopoMap)', url: 'https://tile.opentopomap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors, SRTM; style © OpenTopoMap (CC-BY-SA)', maxZoom: 17 },
];
/** Terrain tiles (Mapzen/AWS Terrarium): elevation = R·256 + G + B/256 − 32768 m. */
export const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const terrariumHeight = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

export type TileFetch = (url: string) => Promise<{ width: number; height: number; data: Uint8ClampedArray } | null>;
/** Browser tile reader: fetch → bitmap → pixels (needs CORS, which these tile services allow). */
export const browserTiles: TileFetch = async (url) => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0);
    return { width: bmp.width, height: bmp.height, data: g.getImageData(0, 0, bmp.width, bmp.height).data };
  } catch { return null; }
};

class TileCache {
  private m = new Map<string, Promise<{ width: number; height: number; data: Uint8ClampedArray } | null>>();
  private tpl: string;
  private get: TileFetch;
  constructor(tpl: string, get: TileFetch) { this.tpl = tpl; this.get = get; }
  tile(z: number, x: number, y: number) {
    const k = `${z}/${x}/${y}`;
    if (!this.m.has(k)) this.m.set(k, this.get(this.tpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))));
    return this.m.get(k)!;
  }
  /** Pixel (RGBA) at a fractional tile position. */
  async pixel(z: number, tx: number, ty: number): Promise<[number, number, number, number] | null> {
    const t = await this.tile(z, Math.floor(tx), Math.floor(ty));
    if (!t) return null;
    const px = Math.min(t.width - 1, Math.floor((tx % 1) * t.width)), py = Math.min(t.height - 1, Math.floor((ty % 1) * t.height));
    const i = (py * t.width + px) * 4;
    return [t.data[i], t.data[i + 1], t.data[i + 2], t.data[i + 3]];
  }
}

/** Ground elevation (m) at model points, from terrain tiles at zoom 14 (≈ 10 m pixels), bilinear. */
export async function terrainAt(crs: CRS, pts: { x: number; y: number }[], get: TileFetch, zoom = 14): Promise<number[]> {
  const cache = new TileCache(TERRAIN_URL, get);
  const out: number[] = [];
  for (const p of pts) {
    const [lat, lon] = toLatLon(crs, p.x, p.y);
    const [tx, ty] = tileXY(lat, lon, zoom);
    // bilinear over the 4 neighbouring pixels (256 px tiles)
    const fx = tx * 256 - 0.5, fy = ty * 256 - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
    const h = async (px: number, py: number) => { const c = await cache.pixel(zoom, px / 256, py / 256); return c ? terrariumHeight(c[0], c[1], c[2]) : NaN; };
    const [h00, h10, h01, h11] = await Promise.all([h(x0, y0), h(x0 + 1, y0), h(x0, y0 + 1), h(x0 + 1, y0 + 1)]);
    out.push(h00 * (1 - dx) * (1 - dy) + h10 * dx * (1 - dy) + h01 * (1 - dx) * dy + h11 * dx * dy);
  }
  return out;
}

/** A basemap image of the model extent (plus a margin), resampled exactly onto the model grid. */
export async function buildBasemap(crs: CRS, ext: { x0: number; y0: number; x1: number; y1: number }, src: TileSource, get: TileFetch, maxPx = 2048): Promise<{ width: number; height: number; rgba: Uint8ClampedArray; zoom: number; missing: number }> {
  const w = ext.x1 - ext.x0, h = ext.y1 - ext.y0;
  const scale = Math.max(w, h) / maxPx; // metres per output pixel
  const W = Math.max(1, Math.round(w / scale)), H = Math.max(1, Math.round(h / scale));
  const [latc] = toLatLon(crs, (ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2);
  // zoom whose pixel size is just below the output pixel size
  const zoom = Math.max(1, Math.min(src.maxZoom, Math.ceil(Math.log2((156543.034 * Math.cos(latc * rad)) / scale))));
  const cache = new TileCache(src.url, get);
  const rgba = new Uint8ClampedArray(W * H * 4);
  let missing = 0;
  // prefetch the tiles the extent needs
  const corners = [[ext.x0, ext.y0], [ext.x1, ext.y0], [ext.x0, ext.y1], [ext.x1, ext.y1]].map(([x, y]) => tileXY(...toLatLon(crs, x, y), zoom));
  const txs = corners.map((c) => Math.floor(c[0])), tys = corners.map((c) => Math.floor(c[1]));
  if ((Math.max(...txs) - Math.min(...txs) + 1) * (Math.max(...tys) - Math.min(...tys) + 1) > 400) throw new Error('The area is too large for a basemap at this detail; zoom the model extent or simplify.');
  const tiles = new Map<string, { width: number; height: number; data: Uint8ClampedArray } | null>();
  await Promise.all(Array.from({ length: Math.max(...txs) - Math.min(...txs) + 1 }, (_, i) => Math.min(...txs) + i).flatMap((x) => Array.from({ length: Math.max(...tys) - Math.min(...tys) + 1 }, (_, j) => Math.min(...tys) + j).map(async (y) => tiles.set(`${x}/${y}`, await cache.tile(zoom, x, y)))));
  for (let j = 0; j < H; j++) {
    const y = ext.y1 - (j + 0.5) * scale; // image rows go down, model y goes up
    for (let i = 0; i < W; i++) {
      const x = ext.x0 + (i + 0.5) * scale;
      const [tx, ty] = tileXY(...toLatLon(crs, x, y), zoom);
      const t = tiles.get(`${Math.floor(tx)}/${Math.floor(ty)}`);
      const o = (j * W + i) * 4;
      if (!t) { missing++; rgba[o + 3] = 0; continue; }
      const px = Math.min(t.width - 1, Math.floor((tx % 1) * t.width)), py = Math.min(t.height - 1, Math.floor((ty % 1) * t.height));
      const k = (py * t.width + px) * 4;
      rgba[o] = t.data[k]; rgba[o + 1] = t.data[k + 1]; rgba[o + 2] = t.data[k + 2]; rgba[o + 3] = 255;
    }
  }
  return { width: W, height: H, rgba, zoom, missing };
}

/** Points every `step` m along a pipe (for a long section from terrain), excluding the ends. */
export function pointsAlong(a: { x: number; y: number }, b: { x: number; y: number }, vertices: { x: number; y: number }[] = [], step = 50) {
  const pts = [a, ...vertices, b];
  const out: { s: number; x: number; y: number }[] = [];
  let s0 = 0;
  for (let k = 1; k < pts.length; k++) {
    const L = Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    for (let s = step - (s0 % step); s < L; s += step) out.push({ s: s0 + s, x: pts[k - 1].x + ((pts[k].x - pts[k - 1].x) * s) / L, y: pts[k - 1].y + ((pts[k].y - pts[k - 1].y) * s) / L });
    s0 += L;
  }
  return { points: out, length: s0 };
}
