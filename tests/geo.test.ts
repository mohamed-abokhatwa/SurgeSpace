// Map coordinates, terrain decoding and basemap resampling (no network: tiles are made up here).
import { buildBasemap, fromUTM, pointsAlong, terrainAt, terrariumHeight, toUTM, utmZone, type TileFetch } from '../src/app/geo';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
// reference values from PROJ (pyproj, EPSG:32637 and EPSG:32719)
const ref: [number, number, number, boolean, number, number][] = [
  [21.4225, 39.8262, 37, false, 585624.2166, 2369133.5290],
  [21.54, 39.17, 37, false, 517603.5898, 2381922.4138],
  [18.0, 36.0, 37, false, 182293.8864, 1992757.4728],
  [26.3, 41.9, 37, false, 789559.7319, 2912156.2741],
  [-33.45, -70.65, 19, true, 346642.6950, 6297606.8325],
];
let worst = 0, back = 0;
for (const [lat, lon, z, s, x, y] of ref) {
  const [ex, ny] = toUTM(lat, lon, z, s);
  worst = Math.max(worst, Math.hypot(ex - x, ny - y));
  const [la, lo] = fromUTM(x, y, z, s);
  back = Math.max(back, Math.hypot((la - lat) * 111000, (lo - lon) * 111000 * Math.cos(lat * Math.PI / 180)));
}
t('UTM forward matches PROJ', worst < 0.01, `${worst.toFixed(4)} m worst`);
t('UTM inverse matches PROJ', back < 0.01, `${back.toFixed(4)} m worst`);
t('UTM zone of Makkah is 37N', utmZone(21.42, 39.83).zone === 37 && !utmZone(21.42, 39.83).south);
t('terrarium height', terrariumHeight(128, 0, 0) === 0 && terrariumHeight(128, 100, 128) === 100.5);
// fake tiles: terrain tile where the height is 300 + column index; basemap tile coloured by tile index
const fakeTerrain: TileFetch = async () => { const d = new Uint8ClampedArray(256 * 256 * 4); for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) { const h = 300 + x + 32768; const i = (y * 256 + x) * 4; d[i] = Math.floor(h / 256); d[i + 1] = h % 256; d[i + 2] = 0; d[i + 3] = 255; } return { width: 256, height: 256, data: d }; };
const crs = { kind: 'utm' as const, zone: 37, south: false };
(async () => {
  const hs = await terrainAt(crs, [{ x: 585624, y: 2369133 }], fakeTerrain);
  t('terrain sampled in range', hs[0] >= 300 && hs[0] <= 556, hs[0].toFixed(2));
  let calls = 0;
  const fakeMap: TileFetch = async (url) => { calls++; const m = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(url)!; const v = (Number(m[2]) * 37 + Number(m[3]) * 11) % 255; return { width: 256, height: 256, data: new Uint8ClampedArray(256 * 256 * 4).fill(v) }; };
  const bm = await buildBasemap(crs, { x0: 585000, y0: 2368500, x1: 587000, y1: 2369800 }, { id: 'f', name: 'f', url: 'https://x/{z}/{x}/{y}.png', attribution: '', maxZoom: 18 }, fakeMap, 512);
  t('basemap covers the extent with the right shape', bm.width === 512 && Math.abs(bm.height - Math.round(512 * 1300 / 2000)) <= 1 && bm.missing === 0, `${bm.width}×${bm.height} at zoom ${bm.zoom}, ${calls} tiles`);
  const al = pointsAlong({ x: 0, y: 0 }, { x: 300, y: 400 }, [], 100);
  t('points every 100 m along a 500 m pipe', al.points.length === 4 && al.length === 500 && Math.abs(al.points[0].x - 60) < 1e-9);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
