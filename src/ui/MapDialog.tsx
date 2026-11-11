// Map and terrain: the model's coordinate system, a street / satellite / topographic basemap under the drawing,
// and ground elevations from terrain data for nodes and pipe long sections.
import { useState } from 'react';
import { BASEMAPS, browserTiles, buildBasemap, pointsAlong, terrainAt, toLatLon, type CRS } from '../app/geo';
import type { Network } from '../engine/types';
import { Modal } from './Dialogs';
import { Ic } from './Icons';

type SetNet = (f: (n: Network) => Network, label?: string) => void;

export function MapDialog({ net, setNet, onClose, onToast }: { net: Network; setNet: SetNet; onClose: () => void; onToast: (m: string[]) => void }) {
  const [crs, setCrs] = useState<CRS>(net.crs ?? { kind: 'utm', zone: 37, south: false });
  const [src, setSrc] = useState(BASEMAPS[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState(50);
  const xs = net.nodes.map((n) => n.x), ys = net.nodes.map((n) => n.y);
  const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 200) * 0.08;
  const ext = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
  const centre = net.nodes.length ? toLatLon(crs, (ext.x0 + ext.x1) / 2, (ext.y0 + ext.y1) / 2) : null;
  // UTM eastings lie between about 160 and 840 km; small numbers mean local (schematic) coordinates
  const localLike = crs.kind === 'utm' && (Math.min(...xs) < 100000 || Math.max(...xs) > 900000);
  const plausible = !!centre && !localLike && Math.abs(centre[0]) < 85 && Math.abs(centre[1]) <= 180;
  const saveCrs = () => setNet((n) => ({ ...n, crs }), 'Coordinate system');
  const basemap = async () => {
    saveCrs();
    const s = BASEMAPS.find((b) => b.id === src)!;
    setBusy('Loading map tiles…');
    try {
      const bm = await buildBasemap(crs, ext, s, browserTiles, 2048);
      if (bm.missing > bm.width * bm.height * 0.5) throw new Error('The map service did not answer (offline, or blocked by the network).');
      const c = document.createElement('canvas');
      c.width = bm.width; c.height = bm.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(bm.rgba), bm.width, bm.height), 0, 0);
      const url = c.toDataURL('image/jpeg', 0.85);
      setNet((n) => ({ ...n, crs, background: { src: url, ...ext, opacity: 0.75, visible: true, attribution: s.attribution } }), 'Basemap');
      onToast([`${s.name} basemap placed under the model (zoom ${bm.zoom}). Opacity and visibility: View → Background picture.`]);
      onClose();
    } catch (e) { onToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const nodesFromTerrain = async (all: boolean) => {
    saveCrs();
    setBusy('Reading terrain…');
    try {
      const targets = net.nodes.filter((n) => all || n.kind === 'junction');
      const hs = await terrainAt(crs, targets, browserTiles);
      const bad = hs.filter((h) => !Number.isFinite(h)).length;
      if (bad === hs.length) throw new Error('No terrain data came back (offline, or blocked by the network).');
      const map = new Map(targets.map((n, k) => [n.id, hs[k]]));
      setNet((m) => ({ ...m, crs, nodes: m.nodes.map((n) => (map.has(n.id) && Number.isFinite(map.get(n.id)!) ? { ...n, elev: Math.round(map.get(n.id)! * 100) / 100 } : n)) }), 'Elevations from terrain');
      onToast([`Elevations of ${hs.length - bad} nodes set from terrain data (about 10 m grid; Undo with Ctrl+Z). Check them against survey levels for design.`]);
    } catch (e) { onToast([(e as Error).message]); } finally { setBusy(null); }
  };
  const profilesFromTerrain = async () => {
    saveCrs();
    setBusy('Reading terrain along the pipes…');
    try {
      const plan = net.pipes.map((p) => {
        const a = net.nodes.find((n) => n.id === p.from)!, b = net.nodes.find((n) => n.id === p.to)!;
        const al = pointsAlong(a, b, p.vertices, step);
        return { id: p.id, length: p.length, drawn: al.length, pts: al.points };
      }).filter((x) => x.pts.length);
      const hs = await terrainAt(crs, plan.flatMap((x) => x.pts), browserTiles);
      let k = 0, n = 0;
      const prof = new Map(plan.map((x) => [x.id, x.pts.map((q) => { const z = hs[k++]; return Number.isFinite(z) ? { s: Math.round((q.s * x.length) / x.drawn * 100) / 100, z: Math.round(z * 100) / 100 } : null; }).filter((q): q is { s: number; z: number } => !!q)]));
      prof.forEach((v) => (n += v.length));
      if (!n) throw new Error('No terrain data came back (offline, or blocked by the network).');
      setNet((m) => ({ ...m, crs, pipes: m.pipes.map((p) => (prof.get(p.id)?.length ? { ...p, profile: prof.get(p.id) } : p)) }), 'Long sections from terrain');
      onToast([`Long sections from terrain: ${n} points on ${prof.size} pipes (every ${step} m, pipe at ground level). Lower them by the cover depth if the levels are ground levels.`]);
    } catch (e) { onToast([(e as Error).message]); } finally { setBusy(null); }
  };
  return (
    <Modal title="Map and terrain" onClose={onClose} wide icon={<Ic name="profile" />}>
      <div className="grid3">
        <label className="field"><span>Model coordinates</span>
          <select value={crs.kind} onChange={(e) => setCrs(e.target.value === 'utm' ? { kind: 'utm', zone: 37, south: false } : { kind: 'webmercator' })}>
            <option value="utm">UTM (WGS 84)</option><option value="webmercator">Web Mercator (EPSG:3857)</option>
          </select>
        </label>
        {crs.kind === 'utm' && <>
          <label className="field"><span>UTM zone</span><input type="number" min={1} max={60} value={crs.zone} onChange={(e) => setCrs({ ...crs, zone: Math.max(1, Math.min(60, Number(e.target.value) || 37)) })} /></label>
          <label className="field"><span>Hemisphere</span><select value={crs.south ? 'S' : 'N'} onChange={(e) => setCrs({ ...crs, south: e.target.value === 'S' })}><option value="N">North</option><option value="S">South</option></select></label>
        </>}
      </div>
      <p className="small muted">{centre ? <>Model centre: {centre[0].toFixed(5)}°, {centre[1].toFixed(5)}° {plausible ? '' : <b className="bad">— {localLike ? 'the coordinates look local (schematic), not UTM: import or draw the model in UTM metres first' : 'not a real place: check the zone'}</b>}</> : 'Draw or import the model first.'} Saudi Arabia: zones 36–40 North (Makkah, Jeddah, Madinah 37; Riyadh 38; Dammam 39).</p>
      <div className="label">Basemap</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <select className="cell boxed" style={{ width: 260 }} value={src} onChange={(e) => setSrc(e.target.value)}>{BASEMAPS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
        <button className="btn small primary" disabled={!!busy || !plausible} onClick={basemap}>Place under the model</button>
      </div>
      <p className="small muted">Map tiles come from the provider over the internet; their terms and credit apply ({BASEMAPS.find((b) => b.id === src)!.attribution}).</p>
      <div className="label">Terrain</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button className="btn small" disabled={!!busy || !plausible} onClick={() => nodesFromTerrain(false)}>Junction elevations from terrain</button>
        <button className="btn small" disabled={!!busy || !plausible} onClick={() => nodesFromTerrain(true)}>All node elevations</button>
        <label className="row small" style={{ gap: 4 }}>every <input className="cell boxed" type="number" style={{ width: 60 }} value={step} onChange={(e) => setStep(Math.max(5, Number(e.target.value) || 50))} /> m</label>
        <button className="btn small" disabled={!!busy || !plausible} onClick={profilesFromTerrain}>Pipe long sections from terrain</button>
      </div>
      <p className="small muted">Ground levels from the open terrain dataset (SRTM and others, about 10–30 m accuracy). Fine for planning and checks; use survey levels for design. Everything can be undone.</p>
      {busy && <p className="small" role="status"><span className="spinner" />{busy}</p>}
    </Modal>
  );
}
