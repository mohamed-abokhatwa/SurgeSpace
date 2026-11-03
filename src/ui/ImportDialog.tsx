import { useState } from 'react';
import { buildFromProfile, importDxf, importTables, parseTable } from '../engine/importers';
import { parseInp } from '../engine/inp';
import { defaultSettings, type Network } from '../engine/types';
import { download } from './util';

type Tab = 'epanet' | 'sheet' | 'profile' | 'dxf';

const NODE_TEMPLATE = 'id\tx\ty\televation\tdemand (L/s)\ttype\thead\nR1\t0\t0\t100\t\treservoir\t105\nJ1\t500\t0\t92\t5\tjunction\t\nJ2\t1200\t150\t88\t8\tjunction\t\n';
const PIPE_TEMPLATE = 'id\tfrom\tto\tlength (m)\tdiameter (mm)\troughness (mm)\twave speed (m/s)\tclass (bar)\nP1\tR1\tJ1\t500\t300\t0.1\t1100\tPN16\nP2\tJ1\tJ2\t720\t250\t0.1\t1100\tPN16\n';
const PROFILE_TEMPLATE = 'chainage (m)\tlevel (m)\tdiameter (mm)\n0\t95\t600\n400\t101\t600\n900\t116\t600\n1200\t121\t600\n1900\t136\t600\n2600\t146\t600\n3200\t140\t600\n3800\t138\t600\n4400\t143\t600\n5000\t147\t600\n';

export function ImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (net: Network, notes: string[]) => void }) {
  const [tab, setTab] = useState<Tab>('epanet');
  const [err, setErr] = useState('');
  const [nodesText, setNodesText] = useState(NODE_TEMPLATE);
  const [pipesText, setPipesText] = useState(PIPE_TEMPLATE.replace(/PN16/g, '16'));
  const [profText, setProfText] = useState(PROFILE_TEMPLATE);
  const [prof, setProf] = useState({ diameter: 600, wavespeed: 1100, roughness: 0.1, pressureClass: 160, upstream: 'pump' as 'pump' | 'reservoir', upstreamLevel: 100, downstreamLevel: 150, flow: 500, pumps: 2 });
  const [dxfOpt, setDxfOpt] = useState({ tol: 0.5, scale: 1, diameter: 300, wavespeed: 1000, layerFilter: '' });

  const fail = (e: unknown) => setErr((e as Error).message);
  const readFile = (accept: string, cb: (f: File) => void) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.onchange = () => i.files?.[0] && cb(i.files[0]);
    i.click();
  };

  const fromTables = (nt: string, pt: string) => {
    const r = importTables(nt, pt);
    if (!r.nodes.length || !r.pipes.length) throw new Error('Both tables need data rows.');
    const net: Network = { name: 'Network from spreadsheet', nodes: r.nodes, pipes: r.pipes, pumps: [], valves: [], event: { kind: 'none', targets: [], start: 1 }, settings: defaultSettings() };
    if (!r.nodes.some((n) => n.kind === 'reservoir')) r.notes.push('No reservoir found: set at least one node type to "reservoir" (with its water level) before running.');
    onImport(net, r.notes);
  };

  const xlsx = async (f: File) => {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const sheets = await readXlsxFile(f);
    const pick = (re: RegExp) => sheets.find((s) => re.test(s.sheet.toLowerCase()));
    const ns = pick(/node|junction/) ?? sheets[0];
    const ps = pick(/pipe|link/) ?? sheets[1];
    if (!ps) throw new Error('The workbook needs a "Nodes" sheet and a "Pipes" sheet.');
    const toTsv = (rows: unknown[][]) => rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c))).join('\t')).join('\n');
    setNodesText(toTsv(ns.data as unknown[][]));
    setPipesText(toTsv(ps.data as unknown[][]));
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Import a model</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="tabs" style={{ padding: 0, margin: '10px 0 14px' }}>
          {([['epanet', 'EPANET file'], ['sheet', 'Spreadsheet'], ['profile', 'Long-section profile'], ['dxf', 'CAD drawing (DXF)']] as const).map(([k, l]) => (
            <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => { setTab(k); setErr(''); }}>{l}</button>
          ))}
        </div>
        {err && <div className="hint" style={{ color: 'var(--bad)', borderColor: 'var(--bad)', marginBottom: 10 }}>{err}</div>}

        {tab === 'epanet' && (
          <div>
            <p className="small muted">Open an EPANET <span className="mono">.inp</span> file, exported from EPANET, WaterGEMS, WaterCAD, InfoWater or most network tools. Nodes, pipes, pumps, valves, curves and coordinates are read; wave speeds and pump inertia get defaults you can review.</p>
            <button className="btn primary" onClick={() => readFile('.inp,.txt', (f) => f.text().then((t) => { try { const r = parseInp(t, f.name.replace(/\.\w+$/, '')); onImport(r.network, r.notes); } catch (e) { fail(e); } }))}>Choose .inp file</button>
          </div>
        )}

        {tab === 'sheet' && (
          <div>
            <p className="small muted">Paste from Excel (copy the cells including the header row), or upload a CSV / Excel workbook with sheets named <b>Nodes</b> and <b>Pipes</b>. Columns are matched by name: id, x, y, elevation, demand (L/s), type, head · id, from, to, length, diameter (mm), roughness, wave speed, class (bar or m).</p>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <button className="btn small" onClick={() => readFile('.xlsx', (f) => xlsx(f).catch(fail))}>Upload Excel (.xlsx)</button>
              <button className="btn small" onClick={() => readFile('.csv,.txt', (f) => f.text().then(setNodesText))}>Nodes CSV…</button>
              <button className="btn small" onClick={() => readFile('.csv,.txt', (f) => f.text().then(setPipesText))}>Pipes CSV…</button>
              <button className="btn small ghost" onClick={() => { download('surgespace-nodes-template.csv', NODE_TEMPLATE.replace(/\t/g, ',')); download('surgespace-pipes-template.csv', PIPE_TEMPLATE.replace(/\t/g, ',')); }}>Download templates</button>
            </div>
            <div className="grid2">
              <label className="field"><span>Nodes ({Math.max(parseTable(nodesText).length - 1, 0)} rows)</span><textarea rows={9} value={nodesText} onChange={(e) => setNodesText(e.target.value)} /></label>
              <label className="field"><span>Pipes ({Math.max(parseTable(pipesText).length - 1, 0)} rows)</span><textarea rows={9} value={pipesText} onChange={(e) => setPipesText(e.target.value)} /></label>
            </div>
            <button className="btn primary" style={{ marginTop: 10 }} onClick={() => { try { fromTables(nodesText, pipesText); } catch (e) { fail(e); } }}>Build network</button>
          </div>
        )}

        {tab === 'profile' && (
          <div>
            <p className="small muted">Paste a long-section (chainage and pipe level, optionally diameter in mm). SurgeSpace keeps every point, puts nodes at high and low points, adds air valves at the high points, and builds the source and delivery ends.</p>
            <textarea rows={8} value={profText} onChange={(e) => setProfText(e.target.value)} />
            <div className="grid2" style={{ marginTop: 8 }}>
              <label className="field"><span>Upstream end</span>
                <select value={prof.upstream} onChange={(e) => setProf({ ...prof, upstream: e.target.value as 'pump' | 'reservoir' })}>
                  <option value="pump">Pump station (pump trip study)</option>
                  <option value="reservoir">Reservoir (gravity main)</option>
                </select>
              </label>
              <label className="field"><span>Design flow (L/s)</span><input type="number" value={prof.flow} onChange={(e) => setProf({ ...prof, flow: +e.target.value })} /></label>
              <label className="field"><span>{prof.upstream === 'pump' ? 'Sump water level (m)' : 'Source water level (m)'}</span><input type="number" value={prof.upstreamLevel} onChange={(e) => setProf({ ...prof, upstreamLevel: +e.target.value })} /></label>
              <label className="field"><span>Delivery water level (m)</span><input type="number" value={prof.downstreamLevel} onChange={(e) => setProf({ ...prof, downstreamLevel: +e.target.value })} /></label>
              <label className="field"><span>Default diameter (mm)</span><input type="number" value={prof.diameter} onChange={(e) => setProf({ ...prof, diameter: +e.target.value })} /></label>
              <label className="field"><span>Wave speed (m/s)</span><input type="number" value={prof.wavespeed} onChange={(e) => setProf({ ...prof, wavespeed: +e.target.value })} /></label>
              <label className="field"><span>Roughness ε (mm)</span><input type="number" value={prof.roughness} onChange={(e) => setProf({ ...prof, roughness: +e.target.value })} /></label>
              <label className="field"><span>Pipe class (m)</span><input type="number" value={prof.pressureClass} onChange={(e) => setProf({ ...prof, pressureClass: +e.target.value })} /></label>
              {prof.upstream === 'pump' && <label className="field"><span>Duty pumps</span><input type="number" value={prof.pumps} onChange={(e) => setProf({ ...prof, pumps: +e.target.value })} /></label>}
            </div>
            <button className="btn primary" style={{ marginTop: 10 }} onClick={() => {
              try {
                const rows = parseTable(profText).filter((r) => Number.isFinite(Number(r[0]))).map((r) => [Number(r[0]), Number(r[1]), r[2] ? Number(r[2]) : undefined] as [number, number, number?]);
                const r = buildFromProfile({ ...prof, rows, diameter: prof.diameter / 1000, flow: prof.flow / 1000 });
                onImport(r.network, r.notes);
              } catch (e) { fail(e); }
            }}>Build pipeline</button>
          </div>
        )}

        {tab === 'dxf' && (
          <div>
            <p className="small muted">Open a DXF drawing (save as DXF from AutoCAD, Civil 3D, BricsCAD, QGIS…). Lines and polylines become pipes, their vertices become nodes. Levels come from the vertex Z or the polyline elevation; leave Z at 0 to enter levels afterwards.</p>
            <div className="grid2">
              <label className="field"><span>Drawing units → metres (×)</span><input type="number" value={dxfOpt.scale} onChange={(e) => setDxfOpt({ ...dxfOpt, scale: +e.target.value })} /></label>
              <label className="field"><span>Snap tolerance (drawing units)</span><input type="number" value={dxfOpt.tol} onChange={(e) => setDxfOpt({ ...dxfOpt, tol: +e.target.value })} /></label>
              <label className="field"><span>Default diameter (mm)</span><input type="number" value={dxfOpt.diameter} onChange={(e) => setDxfOpt({ ...dxfOpt, diameter: +e.target.value })} /></label>
              <label className="field"><span>Wave speed (m/s)</span><input type="number" value={dxfOpt.wavespeed} onChange={(e) => setDxfOpt({ ...dxfOpt, wavespeed: +e.target.value })} /></label>
              <label className="field"><span>Only layers containing (optional)</span><input value={dxfOpt.layerFilter} placeholder="e.g. WATER" onChange={(e) => setDxfOpt({ ...dxfOpt, layerFilter: e.target.value })} /></label>
            </div>
            <button className="btn primary" style={{ marginTop: 10 }} onClick={() => readFile('.dxf', (f) => f.text().then((t) => {
              try {
                const r = importDxf(t, { ...dxfOpt, diameter: dxfOpt.diameter / 1000, layerFilter: dxfOpt.layerFilter || undefined });
                const net: Network = { name: f.name.replace(/\.\w+$/, ''), nodes: r.nodes, pipes: r.pipes, pumps: [], valves: [], event: { kind: 'none', targets: [], start: 1 }, settings: defaultSettings() };
                onImport(net, r.notes);
              } catch (e) { fail(e); }
            }))}>Choose .dxf file</button>
          </div>
        )}
      </div>
    </div>
  );
}
