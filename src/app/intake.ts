// Model from documents: drawings (PDF, images), spreadsheets and DXF are read into an evidence register — every
// value with its source (file, page, region, cell) and a confidence — which the engineer reviews; missing data is
// listed as questions; the model is then built from the accepted evidence through the command layer, keeping a
// trace from each element back to its source or to a stated assumption.
import type { Network } from '../engine/types';

export type DocKind = 'pdf' | 'image' | 'sheet' | 'dxf' | 'text';
export interface TextItem { s: string; x: number; y: number; w: number; h: number }
export interface IntakePage { n: number; w: number; h: number; image: string; text?: TextItem[] }
export interface IntakeDoc {
  id: string;
  name: string;
  kind: DocKind;
  pages: IntakePage[];
  sheets?: { name: string; rows: (string | number | null)[][] }[];
  dxf?: DxfSummary;
  text?: string;
}
export interface DxfSummary { layers: { name: string; lines: number }[]; blocks: { name: string; count: number; at: [number, number][] }[]; texts: { layer: string; s: string; x: number; y: number }[]; raw: string; /** $INSUNITS from the header (2 feet, 4 mm, 6 m …). */ insunits?: number }

export const EV_TYPES = ['profilePoint', 'reservoir', 'tank', 'pump', 'pumpCurvePoint', 'pipe', 'valve', 'checkValve', 'airValve', 'washout', 'junction', 'design', 'note'] as const;
export type EvType = (typeof EV_TYPES)[number];
export interface Evidence {
  id: string;
  type: EvType;
  label?: string;
  /** Values in SI with the unit in the name: chainage_m, level_m, diameter_mm, flow_lps, head_m … */
  values: Record<string, number | string>;
  source: { doc: string; page?: number; box?: [number, number, number, number]; cell?: string; how: 'ai' | 'table' | 'cad' | 'user' };
  confidence: number;
  status: 'proposed' | 'accepted' | 'rejected';
}
export interface Gap {
  id: string;
  question: string;
  why: string;
  unit?: string;
  typical?: number | string;
  options?: string[];
  status: 'open' | 'answered' | 'assumed';
  answer?: number | string;
  critical?: boolean;
}

let seq = 0;
export const newId = (p = 'e') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

// ── reading files (in the browser / desktop, no AI) ──────────────────────────
export async function readDocument(file: File, onProgress?: (m: string) => void): Promise<IntakeDoc> {
  const name = file.name, ext = name.split('.').pop()?.toLowerCase() ?? '';
  const id = newId('d');
  if (ext === 'pdf') return readPdf(file, id, onProgress);
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
    const url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    const img = await loadImage(url);
    const page = await downscale(img, 2400);
    return { id, name, kind: 'image', pages: [{ n: 1, ...page }] };
  }
  if (['xlsx', 'xlsm', 'xls'].includes(ext)) {
    const { default: readXlsxFile, readSheetNames } = await import('read-excel-file/browser') as unknown as { default: (f: File, o?: { sheet: string }) => Promise<(string | number | null)[][]>; readSheetNames: (f: File) => Promise<string[]> };
    const names = readSheetNames ? await readSheetNames(file) : ['Sheet1'];
    const sheets: IntakeDoc['sheets'] = [];
    for (const sh of names.slice(0, 12)) { try { sheets.push({ name: sh, rows: (await readXlsxFile(file, { sheet: sh })).slice(0, 5000).map((r) => r.map((c: unknown) => (c instanceof Date ? c.toISOString() : (c as string | number | null)))) }); } catch { /* unreadable sheet */ } }
    return { id, name, kind: 'sheet', pages: [], sheets };
  }
  if (['csv', 'tsv'].includes(ext)) {
    const t = await file.text();
    const sep = ext === 'tsv' || t.split('\n')[0].includes('\t') ? '\t' : t.split('\n')[0].includes(';') ? ';' : ',';
    const rows = t.replace(/\r/g, '').split('\n').filter((l) => l.trim()).map((l) => l.split(sep).map((c) => { const v = c.trim().replace(/^"|"$/g, ''); const n = Number(v); return v !== '' && Number.isFinite(n) ? n : v; }));
    return { id, name, kind: 'sheet', pages: [], sheets: [{ name: name.replace(/\.\w+$/, ''), rows }] };
  }
  if (ext === 'dxf') { const t = await file.text(); return { id, name, kind: 'dxf', pages: [], dxf: dxfSummary(t) }; }
  return { id, name, kind: 'text', pages: [], text: (await file.text()).slice(0, 60000) };
}

async function readPdf(file: File, id: string, onProgress?: (m: string) => void): Promise<IntakeDoc> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: IntakePage[] = [];
  const nP = Math.min(doc.numPages, 40);
  for (let i = 1; i <= nP; i++) {
    onProgress?.(`${file.name}: page ${i} of ${nP}`);
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    // about 2400 px on the long side: enough for the AI to read small print on drawing sheets (in tiles)
    const scale = Math.min(4, 2400 / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as never).promise;
    const tc = await page.getTextContent();
    const text: TextItem[] = [];
    for (const it of tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      if (!it.str?.trim() || !it.transform) continue;
      const [x, y] = [it.transform[4], it.transform[5]];
      text.push({ s: it.str.trim(), x: x / v1.width, y: 1 - y / v1.height, w: (it.width ?? 0) / v1.width, h: (it.height ?? 0) / v1.height });
    }
    pages.push({ n: i, w: c.width, h: c.height, image: c.toDataURL('image/png'), text });
  }
  return { id, name: file.name, kind: 'pdf', pages };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('The image could not be read.')); i.src = url; });
}
async function downscale(img: HTMLImageElement, maxSide: number): Promise<{ w: number; h: number; image: string }> {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return { w: c.width, h: c.height, image: c.toDataURL('image/png') };
}

/** Images for the AI: the whole page, then four overlapping quadrants at full resolution for small print. */
export async function pageTiles(p: IntakePage): Promise<{ mime: string; data: string }[]> {
  const img = await loadImage(p.image);
  const out: { mime: string; data: string }[] = [];
  const cut = (x0: number, y0: number, x1: number, y1: number, maxSide: number) => {
    const sw = (x1 - x0) * img.width, sh = (y1 - y0) * img.height, k = Math.min(1, maxSide / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * k); c.height = Math.round(sh * k);
    c.getContext('2d')!.drawImage(img, x0 * img.width, y0 * img.height, sw, sh, 0, 0, c.width, c.height);
    out.push({ mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.88).split(',')[1] });
  };
  cut(0, 0, 1, 1, 1568);
  if (Math.max(img.width, img.height) > 1700) for (const [x0, y0] of [[0, 0], [0.45, 0], [0, 0.45], [0.45, 0.45]]) cut(x0, y0, x0 + 0.55, y0 + 0.55, 1568);
  return out;
}

// ── DXF: layers, blocks (symbols) and texts, for the AI to map ───────────────
export function dxfSummary(text: string): DxfSummary {
  const lines = text.replace(/\r/g, '').split('\n');
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([Number(lines[i].trim()), lines[i + 1].trim()]);
  const layers = new Map<string, number>(), blocks = new Map<string, [number, number][]>(), texts: DxfSummary['texts'] = [];
  let inE = false;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 2 && v === 'ENTITIES') inE = true;
    if (c === 0 && v === 'ENDSEC') inE = false;
    if (!inE || c !== 0) continue;
    const e: Record<number, string> = {};
    for (let j = i + 1; j < pairs.length && pairs[j][0] !== 0; j++) if (!(pairs[j][0] in e)) e[pairs[j][0]] = pairs[j][1];
    const layer = e[8] ?? '0';
    if (v === 'LINE' || v === 'LWPOLYLINE' || v === 'POLYLINE') layers.set(layer, (layers.get(layer) ?? 0) + 1);
    else if (v === 'INSERT') { const nm = e[2] ?? '?'; const a = blocks.get(nm); if (a) a.push([+e[10], +e[20]]); else blocks.set(nm, [[+e[10], +e[20]]]); }
    else if (v === "TEXT" || v === "MTEXT") texts.push({ layer, s: (e[1] ?? '').replace(/\\P/g, ' ').replace(/\{[^}]*;|}/g, ''), x: +e[10], y: +e[20] });
  }
  const iu = pairs.findIndex(([c, v]) => c === 9 && v === '$INSUNITS');
  const insunits = iu >= 0 && pairs[iu + 1]?.[0] === 70 ? Number(pairs[iu + 1][1]) : undefined;
  return { layers: [...layers].map(([name, n]) => ({ name, lines: n })).sort((a, b) => b.lines - a.lines), blocks: [...blocks].map(([name, at]) => ({ name, count: at.length, at })), texts, raw: text, ...(insunits !== undefined ? { insunits } : {}) };
}

// ── spreadsheets without AI: recognise long sections, pipe and node tables by their headers ──
const H = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// keys in order of preference: the first key that matches any header wins
const findCol = (hdr: string[], ...keys: string[]) => { for (const k of keys) { const i = hdr.findIndex((h) => h === k || h.startsWith(`${k} `) || h.includes(` ${k}`) || h.startsWith(k)); if (i >= 0) return i; } return -1; };
export function sheetEvidence(doc: IntakeDoc): Evidence[] {
  const out: Evidence[] = [];
  for (const sh of doc.sheets ?? []) {
    // header: the first row with at least two text cells among the first 15 rows
    const hi = sh.rows.slice(0, 15).findIndex((r) => r.filter((c) => typeof c === 'string' && c.trim()).length >= 2);
    if (hi < 0) continue;
    const hdr = sh.rows[hi].map(H);
    const body = sh.rows.slice(hi + 1).filter((r) => r.some((c) => c !== null && c !== ''));
    const num = (r: (string | number | null)[], k: number) => (k >= 0 && r[k] !== null && r[k] !== '' && Number.isFinite(Number(r[k])) ? Number(r[k]) : undefined);
    const cell = (k: number, i: number) => `${sh.name}!${String.fromCharCode(65 + k)}${hi + 2 + i}`;
    const cCh = findCol(hdr, 'chainage', 'ch', 'station', 'sta', 'distance', 'km'), cLv = findCol(hdr, 'invert', 'pipe level', 'centreline', 'centerline', 'level', 'elevation', 'elev', 'rl', 'z');
    const cGr = findCol(hdr, 'ground', 'gl', 'existing ground');
    const cD = findCol(hdr, 'diameter', 'dn', 'dia', 'size'), cL = findCol(hdr, 'length', 'len'), cFrom = findCol(hdr, 'from', 'start node', 'node 1'), cTo = findCol(hdr, 'to', 'end node', 'node 2');
    const cQ = findCol(hdr, 'flow', 'discharge', 'q'), cHd = findCol(hdr, 'head', 'tdh', 'h');
    if (cCh >= 0 && (cLv >= 0 || cGr >= 0)) {
      body.forEach((r, i) => {
        const ch = num(r, cCh), z = num(r, cLv >= 0 ? cLv : cGr);
        if (ch === undefined || z === undefined) return;
        out.push({ id: newId(), type: 'profilePoint', values: { chainage_m: hdr[cCh].includes('km') ? ch * 1000 : ch, level_m: z, ...(cGr >= 0 && cLv >= 0 && num(r, cGr) !== undefined ? { ground_m: num(r, cGr)! } : {}) }, source: { doc: doc.id, cell: cell(cCh, i), how: 'table' }, confidence: 0.95, status: 'proposed' });
      });
    } else if (findCol(hdr, 'id', 'node', 'junction', 'name', 'label') >= 0 && ((findCol(hdr, 'x', 'easting', 'east') >= 0 && findCol(hdr, 'y', 'northing', 'north') >= 0) || cLv >= 0) && cFrom < 0) {
      // node schedule: id, coordinates, level, demand
      const cId = findCol(hdr, 'id', 'node', 'junction', 'name', 'label'), cX = findCol(hdr, 'x', 'easting', 'east'), cY = findCol(hdr, 'y', 'northing', 'north'), cDem = findCol(hdr, 'demand', 'base demand', 'flow', 'q'), cType = findCol(hdr, 'type', 'kind');
      // the node's own level, not a water level column
      const cWl = findCol(hdr, 'water level', 'twl', 'hwl', 'head', 'wl');
      const cE = (() => { for (const k of ['elevation', 'elev', 'invert', 'ground level', 'ground', 'level', 'rl', 'z']) { const i = hdr.findIndex((h, j) => j !== cWl && (h === k || h.startsWith(`${k} `) || h.includes(` ${k}`) || h.startsWith(k))); if (i >= 0) return i; } return -1; })();
      body.forEach((r, i) => {
        const id = String(r[cId] ?? '').trim();
        if (!id) return;
        const kind = cType >= 0 ? String(r[cType] ?? '').toLowerCase() : '';
        const t: EvType = /tank/.test(kind) ? 'tank' : /res|source|sump/.test(kind) ? 'reservoir' : 'junction';
        const v: Record<string, number | string> = { name: id };
        if (cX >= 0 && num(r, cX) !== undefined) v.x_m = num(r, cX)!;
        if (cY >= 0 && num(r, cY) !== undefined) v.y_m = num(r, cY)!;
        if (cE >= 0 && num(r, cE) !== undefined) v.level_m = num(r, cE)!;
        if (cWl >= 0 && num(r, cWl) !== undefined) v.head_m = num(r, cWl)!;
        if (cDem >= 0 && num(r, cDem) !== undefined) v.demand_lps = num(r, cDem)!;
        out.push({ id: newId(), type: t, label: id, values: v, source: { doc: doc.id, cell: cell(cId, i), how: 'table' }, confidence: 0.95, status: 'proposed' });
      });
    } else if (cFrom >= 0 && cTo >= 0 && (cL >= 0 || findCol(hdr, 'type', 'kind') >= 0)) {
      // link schedule: pipes (from, to, length, diameter, roughness); pumps and valves by a type column
      const cType = findCol(hdr, 'type', 'kind'), cR = findCol(hdr, 'roughness', 'c factor', 'hw c', 'hazen', 'ks', 'k s'), cMat = findCol(hdr, 'material'), cSt = findCol(hdr, 'status', 'state');
      body.forEach((r, i) => {
        const L = num(r, cL), d = num(r, cD), kind = cType >= 0 ? String(r[cType] ?? '').toLowerCase() : 'pipe';
        const t: EvType = /pump/.test(kind) ? 'pump' : /check|nrv|non.?return/.test(kind) ? 'checkValve' : /valve|prv|fcv|tcv|gv|bfv/.test(kind) ? 'valve' : 'pipe';
        if (t === 'pipe' && L === undefined) return;
        const v: Record<string, number | string> = { from: String(r[cFrom] ?? '').trim(), to: String(r[cTo] ?? '').trim() };
        if (L !== undefined) v.length_m = L;
        if (d !== undefined) v.diameter_mm = d < 5 ? d * 1000 : d;
        if (cR >= 0 && num(r, cR) !== undefined) v.roughness = num(r, cR)!;
        if (cMat >= 0 && r[cMat]) v.material = String(r[cMat]);
        if (cSt >= 0 && /closed|shut/i.test(String(r[cSt] ?? ''))) v.status = 'closed';
        out.push({ id: newId(), type: t, label: String(r[0] ?? ''), values: v, source: { doc: doc.id, cell: cell(cFrom, i), how: 'table' }, confidence: 0.9, status: 'proposed' });
      });
    } else if (cQ >= 0 && cHd >= 0 && body.length >= 3) {
      body.forEach((r, i) => {
        const q = num(r, cQ), h = num(r, cHd);
        if (q === undefined || h === undefined) return;
        out.push({ id: newId(), type: 'pumpCurvePoint', values: { flow_lps: q, head_m: h }, source: { doc: doc.id, cell: cell(cQ, i), how: 'table' }, confidence: 0.85, status: 'proposed' });
      });
    }
  }
  return out;
}

// ── AI extraction ───────────────────────────────────────────────────────────
export const EXTRACT_SYSTEM = `You read engineering drawings and documents for a water pipeline surge (water hammer) study and record what they state, for a model to be built from them.

Record only what the document shows; never invent values. Give every item a confidence (0–1) and the region it comes from as box [x0, y0, x1, y1] in fractions of the WHOLE page (0,0 = top left). Convert to SI and name each field with its unit: chainage_m, level_m (pipe invert or centreline level), ground_m, length_m, diameter_mm, flow_lps, head_m, speed_rpm, power_kw, efficiency_pct, level_m / min_level_m / max_level_m (water levels), class_m or class_bar, closure_s. Text fields: material, kind, name, line, from, to.

Item types:
- profilePoint: a point of a long section (chainage_m and level_m; ground_m if shown). Read the chainage/level table under a long section column by column; include every column.
- reservoir / tank: source or delivery reservoir, sump, tank (level_m, min_level_m, max_level_m, diameter_m, chainage_m).
- pump: pump station or duty pump (count, duty_flow_lps per pump, duty_head_m, speed_rpm, power_kw, efficiency_pct, standby, inertia_kgm2 = moment of inertia J of pump plus motor; if only GD² is given, J = GD²/4).
- pumpCurvePoint: a point of ONE pump's head curve at rated speed (flow_lps per pump, head_m; efficiency_pct if shown). For a curve drawn as a graph, read the axis scales and units first, then record 6–10 points along the head curve from shut-off (zero flow) to the end of the curve; convert m³/h to L/s (÷ 3.6) and bar to m (× 10.2). If several impeller diameters are drawn, use the one marked as selected or duty, and say which in the label.
- pipe: pipe data (diameter_mm, material, class, length_m, from/to chainage).
- valve: line valve (kind gate|butterfly|globe|ball|prv|psv|fcv, diameter_mm, chainage_m, closure_s).
- checkValve, airValve (kind double|single|vacuum|antislam, diameter_mm, chainage_m), washout (chainage_m, diameter_mm).
- junction: a node with its level or a demand (name, chainage_m, level_m, demand_lps).
On a network PLAN (pipes drawn in plan view, not a long section): record every junction (where pipes meet, end, or change size; tanks and reservoirs as their own types) with its name as written — or J1, J2 … in reading order if none is written — its level_m if written, and its box tight around the point; and every pipe as a pipe item with from and to (the junction names), diameter_mm, length_m if written, and material. Do not skip pipes: the network is built from them.
- design: design data stated as text (design_flow_lps, static_head_m, working_pressure_m, test_pressure_m).
- note: anything else that matters for the model (text).

Symbols on plans and P&IDs: air valve (often a small circle or bell with "AV"/"ARV" or a valve with a vent), washout/scour ("WO"), gate/sluice valve (bow-tie), butterfly valve, non-return/check valve (bow-tie with a bar or arrow), PRV. Use the labels next to them.
Call record_evidence once with all items found. If the page has nothing relevant, call it with an empty list and say so in summary.`;

export const RECORD_TOOL = {
  name: 'record_evidence',
  description: 'Record the items found on the page (all at once).',
  params: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'What the page is (e.g. "Long section CH 0–5000, rising main DN600 DI") and what was found' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: [...EV_TYPES] },
            label: { type: 'string' },
            fields: { type: 'array', description: 'Values, SI, unit in the name', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } }, required: ['name', 'value'] } },
            box: { type: 'array', items: { type: 'number' }, description: '[x0, y0, x1, y1] fractions of the whole page' },
            confidence: { type: 'number' },
          },
          required: ['type', 'fields'],
        },
      },
    },
    required: ['items'],
  },
};

/** Turn the tool call arguments into evidence items. */
export function parseRecorded(args: unknown, src: { doc: string; page?: number }): { summary: string; items: Evidence[] } {
  const a = (args ?? {}) as { summary?: string; items?: { type?: string; label?: string; fields?: { name?: string; value?: unknown }[]; box?: number[]; confidence?: number }[] };
  const items: Evidence[] = [];
  for (const it of a.items ?? []) {
    if (!it || !EV_TYPES.includes(it.type as EvType)) continue;
    const values: Record<string, number | string> = {};
    for (const f of it.fields ?? []) {
      if (!f?.name) continue;
      const raw = typeof f.value === 'string' ? f.value.trim() : f.value;
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
      values[String(f.name).trim()] = Number.isFinite(n) && String(raw).trim() !== '' && !/^[a-z]/i.test(String(raw)) ? n : String(raw ?? '');
    }
    const box = Array.isArray(it.box) && it.box.length === 4 && it.box.every((v) => Number.isFinite(v)) ? (it.box.map((v) => Math.max(0, Math.min(1, v))) as [number, number, number, number]) : undefined;
    items.push({ id: newId(), type: it.type as EvType, label: it.label, values, source: { ...src, box, how: 'ai' }, confidence: Math.max(0, Math.min(1, Number(it.confidence ?? 0.6))), status: 'proposed' });
  }
  return { summary: a.summary ?? '', items };
}

/** The text a vector PDF carries, with positions, so the AI can read numbers exactly. */
export function pageTextForAI(p: IntakePage, max = 1400): string {
  if (!p.text?.length) return '';
  const t = p.text.slice(0, max).map((it) => `${it.s} @(${it.x.toFixed(3)},${it.y.toFixed(3)})`).join('\n');
  return `Text on the page (exact, with position as fractions of the page):\n${t}`;
}

// ── what is missing ─────────────────────────────────────────────────────────
const acc = (ev: Evidence[]) => ev.filter((e) => e.status !== 'rejected');
const first = (ev: Evidence[], t: EvType, k: string) => { for (const e of acc(ev)) if (e.type === t && e.values[k] !== undefined && e.values[k] !== '') return e.values[k]; return undefined; };
/** `plan`: a plan drawing (DXF) is there, so the network can come from it: the long section, levels and flow are
 *  then not needed (the ends are set as sources and demands on the plan). */
export function findGaps(ev: Evidence[], prev: Gap[] = [], plan = false): Gap[] {
  const keep = new Map(prev.map((g) => [g.id, g]));
  const out: Gap[] = [];
  const add = (g: Omit<Gap, 'status'>) => out.push({ ...g, status: keep.get(g.id)?.status ?? 'open', answer: keep.get(g.id)?.answer });
  const prof = acc(ev).filter((e) => e.type === 'profilePoint');
  const pumped = acc(ev).some((e) => e.type === 'pump' || e.type === 'pumpCurvePoint');
  if (prof.length < 2) add({ id: 'profile', question: 'Long section: chainage and pipe level along the line', why: 'The surge depends on the levels (high points, where the pressure can fall to vapour).', critical: true, unit: 'chainage m, level m per line' });
  if (first(ev, 'pipe', 'diameter_mm') === undefined) add({ id: 'diameter', question: 'Internal diameter of the main', why: 'Velocity, friction and the size of the pressure surge.', unit: 'mm', critical: true });
  if (first(ev, 'pipe', 'material') === undefined) add({ id: 'material', question: 'Pipe material', why: 'Sets the wave speed (how fast and how strong the surge is).', options: ['Ductile iron', 'Carbon steel', 'PE100', 'PVC-U', 'GRP', 'Concrete'], typical: 'Ductile iron' });
  if (first(ev, 'pipe', 'class_m') === undefined && first(ev, 'pipe', 'class_bar') === undefined && first(ev, 'pipe', 'class') === undefined) add({ id: 'class', question: 'Pipe pressure class', why: 'The highest pressure allowed in the checks.', unit: 'bar (PN)', typical: 16 });
  const flow = first(ev, 'design', 'design_flow_lps') ?? first(ev, 'pump', 'duty_flow_lps');
  if (flow === undefined) add({ id: 'flow', question: 'Design flow', why: 'The steady flow the surge starts from.', unit: 'L/s', critical: true });
  const levels = acc(ev).filter((e) => e.type === 'reservoir' || e.type === 'tank');
  if (levels.length < 1) add({ id: 'startLevel', question: pumped ? 'Sump (suction) water level' : 'Upstream reservoir water level', why: 'The fixed head at the start of the line.', unit: 'm', critical: true });
  if (levels.length < 2) add({ id: 'endLevel', question: pumped ? 'Delivery tank water level' : 'Downstream reservoir water level', why: 'The fixed head at the end of the line.', unit: 'm', critical: true });
  if (pumped) {
    if (first(ev, 'pump', 'count') === undefined) add({ id: 'pumps', question: 'Number of duty pumps', why: 'All duty pumps trip together on power failure.', typical: 1 });
    if (first(ev, 'pump', 'duty_head_m') === undefined && !acc(ev).some((e) => e.type === 'pumpCurvePoint')) add({ id: 'pumpHead', question: 'Pump duty head (or the pump curve data sheet)', why: 'The pump curve; without it the head is estimated from the lift and friction.', unit: 'm', typical: 'estimate' });
    if (first(ev, 'pump', 'speed_rpm') === undefined) add({ id: 'speed', question: 'Pump speed', why: 'With the inertia it sets how fast the pumps run down after a trip.', unit: 'rpm', typical: 1480 });
    if (first(ev, 'pump', 'inertia_kgm2') === undefined) add({ id: 'inertia', question: 'Pump and motor inertia (data sheet)', why: 'The run-down after a power failure — the main driver of the down-surge.', unit: 'kg·m²', typical: 'estimate (Thorley)' });
  } else if (first(ev, 'valve', 'closure_s') === undefined) add({ id: 'closure', question: 'Closure time of the downstream valve', why: 'The event analysed on a gravity main.', unit: 's', typical: 30 });
  if (plan) for (const g of out) if (['profile', 'flow', 'startLevel', 'endLevel', 'diameter'].includes(g.id)) g.critical = false;
  return out;
}

export const gapValue = (g: Gap | undefined) => (g && g.status !== 'open' ? (g.status === 'assumed' ? g.typical : g.answer) : undefined);

/** Everything the model will be built from, as one record (accepted evidence plus answers), with the trace. */
export interface BuildBasis { curve?: [number, number][]; profile: [number, number][]; startLevel: number; endLevel: number; diameterMm: number; material: string; classM: number; flowLps: number; kind: 'pumped' | 'gravity'; pumps: number; speedRpm: number; dutyHead?: number; closureS: number; airValves: { chainage: number; diameterMm?: number; kind?: string }[]; washouts: number[]; inertia?: number; trace: { what: string; value: string; from: string }[] }

export function buildBasis(ev: Evidence[], gaps: Gap[], docs: { id: string; name: string }[]): BuildBasis {
  const trace: BuildBasis['trace'] = [];
  const name = (e: Evidence) => `${docs.find((d) => d.id === e.source.doc)?.name ?? 'document'}${e.source.page ? `, page ${e.source.page}` : ''}${e.source.cell ? `, ${e.source.cell}` : ''}`;
  const pick = <T,>(what: string, t: EvType, keys: string[], gapId: string, conv: (v: number | string) => T, fallback: T, unit = ''): T => {
    for (const e of acc(ev)) if (e.type === t) for (const k of keys) if (e.values[k] !== undefined && e.values[k] !== '') { const v = conv(e.values[k]); trace.push({ what, value: `${v}${unit}`, from: name(e) }); return v; }
    const g = gaps.find((x) => x.id === gapId), v = gapValue(g);
    if (v !== undefined && v !== '' && v !== 'estimate' && v !== 'estimate (Thorley)') { const c = conv(v); trace.push({ what, value: `${c}${unit}`, from: g!.status === 'assumed' ? 'assumed (typical value)' : 'entered by the engineer' }); return c; }
    trace.push({ what, value: `${fallback}${unit}`, from: 'assumed (default)' });
    return fallback;
  };
  const N = (v: number | string) => Number(v);
  const prof = acc(ev).filter((e) => e.type === 'profilePoint').map((e) => [N(e.values.chainage_m), N(e.values.level_m ?? e.values.ground_m)] as [number, number]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b)).sort((a, b) => a[0] - b[0]);
  const profile: [number, number][] = [];
  for (const p of prof) if (!profile.length || p[0] - profile[profile.length - 1][0] > 0.5) profile.push(p);
  if (profile.length) { const src = acc(ev).find((e) => e.type === 'profilePoint')!; trace.push({ what: 'Long section', value: `${profile.length} points, CH ${profile[0][0]}–${profile[profile.length - 1][0]} m`, from: name(src) }); }
  const pumped = acc(ev).some((e) => e.type === 'pump' || e.type === 'pumpCurvePoint');
  const levels = acc(ev).filter((e) => (e.type === 'reservoir' || e.type === 'tank') && Number.isFinite(N(e.values.level_m ?? e.values.max_level_m ?? e.values.min_level_m)));
  const lv = (e: Evidence) => N(e.values.level_m ?? e.values.max_level_m ?? e.values.min_level_m);
  // the source is the one nearest the start of the line (by chainage, else the lowest when pumped / highest by gravity)
  const byCh = levels.filter((e) => Number.isFinite(N(e.values.chainage_m))).sort((a, b) => N(a.values.chainage_m) - N(b.values.chainage_m));
  const start = byCh[0] ?? [...levels].sort((a, b) => (pumped ? lv(a) - lv(b) : lv(b) - lv(a)))[0];
  const end = byCh.length > 1 ? byCh[byCh.length - 1] : levels.find((e) => e !== start);
  let startLevel: number, endLevel: number;
  if (start) { startLevel = lv(start); trace.push({ what: 'Start water level', value: `${startLevel} m`, from: name(start) }); } else { const g = gaps.find((x) => x.id === 'startLevel'); const v = gapValue(g); startLevel = Number(v ?? (profile[0]?.[1] ?? 0) + (pumped ? 2 : 10)); trace.push({ what: 'Start water level', value: `${startLevel} m`, from: v !== undefined ? 'entered by the engineer' : 'assumed (default)' }); }
  if (end) { endLevel = lv(end); trace.push({ what: 'End water level', value: `${endLevel} m`, from: name(end) }); } else { const g = gaps.find((x) => x.id === 'endLevel'); const v = gapValue(g); endLevel = Number(v ?? (profile[profile.length - 1]?.[1] ?? 0) + 2); trace.push({ what: 'End water level', value: `${endLevel} m`, from: v !== undefined ? 'entered by the engineer' : 'assumed (default)' }); }
  const diameterMm = pick('Internal diameter', 'pipe', ['diameter_mm'], 'diameter', N, 300, ' mm');
  const material = pick('Material', 'pipe', ['material'], 'material', String, 'Ductile iron');
  const classM = pick('Pressure class', 'pipe', ['class_m', 'class_bar', 'class'], 'class', (v) => { const x = N(String(v).replace(/[^0-9.]/g, '')); return x > 0 && x <= 64 ? Math.round(x * 10.197) : x || 163; }, 163, ' m');
  const flowLps = (() => {
    const d = first(ev, 'design', 'design_flow_lps');
    if (d !== undefined) { const e = acc(ev).find((x) => x.type === 'design' && x.values.design_flow_lps !== undefined)!; trace.push({ what: 'Design flow', value: `${d} L/s`, from: name(e) }); return N(d); }
    const q = first(ev, 'pump', 'duty_flow_lps'), c = N(first(ev, 'pump', 'count') ?? gapValue(gaps.find((g) => g.id === 'pumps')) ?? 1);
    if (q !== undefined) { const e = acc(ev).find((x) => x.type === 'pump' && x.values.duty_flow_lps !== undefined)!; trace.push({ what: 'Design flow', value: `${N(q) * c} L/s (${c} × ${q})`, from: name(e) }); return N(q) * c; }
    return pick('Design flow', 'design', ['flow_lps'], 'flow', N, 100, ' L/s');
  })();
  const pumps = pumped ? pick('Duty pumps', 'pump', ['count', 'duty_pumps'], 'pumps', (v) => Math.max(1, Math.round(N(v))), 1) : 0;
  const speedRpm = pumped ? pick('Pump speed', 'pump', ['speed_rpm'], 'speed', N, 1480, ' rpm') : 1480;
  const dutyHead = pumped ? (() => {
    const h = first(ev, 'pump', 'duty_head_m');
    if (h !== undefined) { const e = acc(ev).find((x) => x.type === 'pump' && x.values.duty_head_m !== undefined)!; trace.push({ what: 'Pump duty head', value: `${h} m`, from: name(e) }); return N(h); }
    const g = gaps.find((x) => x.id === 'pumpHead');
    if (g?.status === 'answered' && Number.isFinite(Number(g.answer))) { trace.push({ what: 'Pump duty head', value: `${g.answer} m`, from: 'entered by the engineer' }); return Number(g.answer); }
    trace.push({ what: 'Pump duty head', value: 'lift + friction + 5 %', from: 'assumed (estimate)' });
    return undefined;
  })() : undefined;
  // pump curve read from a data sheet (table or graph): fitted, then evaluated at shut-off, duty and maximum flow
  const curvePts = acc(ev).filter((e) => e.type === 'pumpCurvePoint').map((e) => [N(e.values.flow_lps), N(e.values.head_m)] as [number, number]).filter(([q, h]) => Number.isFinite(q) && Number.isFinite(h) && q >= 0 && h > 0);
  let curve: [number, number][] | undefined;
  if (curvePts.length >= 3) {
    curve = fitPumpCurve(curvePts, flowLps / Math.max(1, pumps));
    const e = acc(ev).find((x) => x.type === 'pumpCurvePoint')!;
    const k = trace.findIndex((x) => x.what === 'Pump duty head' && x.from.startsWith('assumed'));
    if (k >= 0) trace[k] = { what: 'Pump duty head', value: `${curve[1][1]} m at ${curve[1][0]} L/s`, from: 'from the pump curve' };
    trace.push({ what: 'Pump curve', value: `${curvePts.length} points → ${curve.map(([q, h]) => `${q.toFixed(0)} L/s ${h.toFixed(1)} m`).join(', ')}`, from: name(e) });
  }
  const inertia = pumped ? (() => {
    const i = first(ev, 'pump', 'inertia_kgm2');
    if (i !== undefined) { const e = acc(ev).find((x) => x.type === 'pump' && x.values.inertia_kgm2 !== undefined)!; trace.push({ what: 'Pump and motor inertia', value: `${i} kg·m²`, from: name(e) }); return N(i); }
    const g = gaps.find((x) => x.id === 'inertia');
    if (g?.status === 'answered' && Number.isFinite(Number(g.answer))) { trace.push({ what: 'Pump and motor inertia', value: `${g.answer} kg·m²`, from: 'entered by the engineer' }); return Number(g.answer); }
    trace.push({ what: 'Pump and motor inertia', value: 'Thorley estimate from the duty', from: 'assumed (estimate)' });
    return undefined;
  })() : undefined;
  const closureS = !pumped ? pick('Valve closure time', 'valve', ['closure_s'], 'closure', N, 30, ' s') : 30;
  const airValves = acc(ev).filter((e) => e.type === 'airValve' && Number.isFinite(N(e.values.chainage_m))).map((e) => ({ chainage: N(e.values.chainage_m), diameterMm: Number.isFinite(N(e.values.diameter_mm)) ? N(e.values.diameter_mm) : undefined, kind: e.values.kind ? String(e.values.kind) : undefined }));
  if (airValves.length) trace.push({ what: 'Air valves on the drawings', value: airValves.map((a) => `CH ${a.chainage}`).join(', '), from: 'drawings' });
  const washouts = acc(ev).filter((e) => e.type === 'washout' && Number.isFinite(N(e.values.chainage_m))).map((e) => N(e.values.chainage_m));
  return { curve, profile, startLevel, endLevel, diameterMm, material, classM, flowLps, kind: pumped ? 'pumped' : 'gravity', pumps, speedRpm, dutyHead, inertia, closureS, airValves, washouts, trace };
}

/** Pump head curve through the points read (L/s, m): least-squares quadratic h = a + b·q + c·q², evaluated at
 *  shut-off, at the duty flow per pump and at the largest flow read — the three points the engines use. */
export function fitPumpCurve(pts: [number, number][], dutyLps: number): [number, number][] {
  const P = [...pts].sort((a, b) => a[0] - b[0]);
  const qMax = P[P.length - 1][0];
  // normal equations for [a, b, c]
  const S = [0, 0, 0, 0, 0], T = [0, 0, 0];
  for (const [q, h] of P) { let x = 1; for (let k = 0; k < 5; k++) { S[k] += x; if (k < 3) T[k] += h * x; x *= q; } }
  const A = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const det3 = (m: number[][]) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det3(A);
  let a: number, b: number, c: number;
  if (Math.abs(D) > 1e-12 * Math.max(1, Math.abs(S[4]) * S[0])) {
    const col = (i: number) => A.map((r, k) => r.map((v, j) => (j === i ? T[k] : v)));
    a = det3(col(0)) / D; b = det3(col(1)) / D; c = det3(col(2)) / D;
  } else { a = P[0][1]; b = 0; c = (P[P.length - 1][1] - a) / (qMax * qMax || 1); }
  const h = (q: number) => a + b * q + c * q * q;
  const qd = dutyLps > 0 && dutyLps < qMax * 1.05 ? dutyLps : qMax * 0.65;
  const q3 = Math.max(qMax, qd * 1.15);
  const r = (v: number) => Math.round(v * 100) / 100;
  return [[0, r(Math.max(h(0), h(qd)))], [r(qd), r(h(qd))], [r(q3), r(Math.max(0.1, h(q3)))]];
}

/** Catalogue material id for a material name read from a drawing. */
export function materialId(name: string): string {
  const s = name.toLowerCase();
  if (/duct|\bdi\b|dci/.test(s)) return 'di';
  if (/stain/.test(s)) return 'ss';
  if (/steel|\bms\b|\bcs\b/.test(s)) return 'steel';
  if (/hdpe|pe ?100|\bpe\b|polyeth/.test(s)) return 'pe100';
  if (/pvc-?o|opvc/.test(s)) return 'pvco';
  if (/pvc/.test(s)) return 'pvcu';
  if (/grp|gre|frp|glass/.test(s)) return 'grp';
  if (/pccp|prestress/.test(s)) return 'pccp';
  if (/concrete|rcc/.test(s)) return 'rc';
  if (/cast/.test(s)) return 'ci';
  return 'di';
}

export interface IntakeState { docs: { id: string; name: string; kind: DocKind; pages: number }[]; evidence: Evidence[]; gaps: Gap[]; summaries: Record<string, string>; trace?: BuildBasis['trace'] }
export const emptyIntake = (): IntakeState => ({ docs: [], evidence: [], gaps: [], summaries: {} });

/** Build the model from the basis: the wizard lays out the line, then devices from the drawings go in by chainage. */
export async function buildFromBasis(b: BuildBasis, name: string): Promise<{ net: Network; notes: string[] }> {
  const { buildFromWizard } = await import('./wizard');
  const { applyAirValvePlan } = await import('./airValvePlan');
  if (b.profile.length < 2) throw new Error('The long section needs at least two points (chainage and level).');
  const out = await buildFromWizard({ kind: b.kind, name, profile: b.profile, startLevel: b.startLevel, endLevel: b.endLevel, diameterMm: b.diameterMm, material: materialId(b.material), pressureClassM: b.classM, flowLps: b.flowLps, pumps: b.pumps, speedRpm: b.speedRpm, closureS: b.closureS, operation: b.kind === 'pumped' ? 'trip' : 'closure' });
  let net = out.net;
  const notes = [...out.notes];
  // a pump curve from the data sheet replaces the estimate; otherwise a stated duty head scales it
  if (b.kind === 'pumped' && b.curve && net.pumps.length) {
    net = { ...net, pumps: net.pumps.map((p) => ({ ...p, curve: b.curve!.map(([q, h]) => [q / 1000, h] as [number, number]) })) };
    notes.push(`Pump curve from the data sheet: ${b.curve.map(([q, h]) => `${q.toFixed(0)} L/s at ${h.toFixed(1)} m`).join(', ')}`);
  } else if (b.kind === 'pumped' && b.dutyHead && net.pumps.length) {
    net = { ...net, pumps: net.pumps.map((p) => { const k = b.dutyHead! / (p.curve[1]?.[1] || b.dutyHead!); return { ...p, curve: p.curve.map(([q, h]) => [q, h * k] as [number, number]) }; }) };
    notes.push(`Pump duty head ${b.dutyHead} m from the documents`);
  }
  if (b.kind === 'pumped' && b.inertia) { net = { ...net, pumps: net.pumps.map((p) => ({ ...p, inertia: b.inertia! })) }; notes.push(`Inertia ${b.inertia} kg·m² from the data sheet`); }
  // air valves shown on the drawings: at their chainage (a node of the line if one is within 1 m, else on the pipe)
  const at = locateChainage(net, b.profile, b.kind);
  const items = b.airValves.map((v, i) => ({ v, i, loc: at(v.chainage) })).filter((x) => x.loc);
  const onNodes = items.filter((x) => 'node' in x.loc!);
  for (const { loc, v } of onNodes) net = { ...net, nodes: net.nodes.map((n) => (n.id === (loc as { node: string }).node ? { ...n, airValve: { inDiameter: 0.1, outDiameter: 0.1, type: 'double' as const, smallDiameter: 0.003, ...(n.airValve ?? {}), ...(v.diameterMm ? { inDiameter: v.diameterMm / 1000, outDiameter: v.diameterMm / 1000 } : {}) } } : n)) };
  const onPipes = items.filter((x) => 'pipe' in x.loc!);
  if (onPipes.length) {
    const plan = onPipes.map(({ loc, v, i }) => ({ id: `AV-D${i + 1}`, at: loc as { pipe: string; s: number }, z: 0, reasons: ['shown on the drawings'], type: 'double' as const, inDiameter: (v.diameterMm ?? 100) / 1000, outDiameter: (v.diameterMm ?? 100) / 1000, smallDiameter: 0.003, qDrain: 0, qFill: 0, critical: false }));
    // the level at a point on a pipe: interpolate the long section
    for (const p of plan) p.z = levelAt(b.profile, b.airValves[Number(p.id.slice(4)) - 1].chainage);
    net = applyAirValvePlan(net, plan as never).net;
  }
  if (items.length) notes.push(`${items.length} air valve(s) placed where the drawings show them`);
  return { net, notes };
}

export function levelAt(profile: [number, number][], ch: number): number {
  for (let k = 0; k + 1 < profile.length; k++) if (ch >= profile[k][0] && ch <= profile[k + 1][0]) { const w = (ch - profile[k][0]) / (profile[k + 1][0] - profile[k][0] || 1); return profile[k][1] + w * (profile[k + 1][1] - profile[k][1]); }
  return ch < profile[0][0] ? profile[0][1] : profile[profile.length - 1][1];
}

/** Chainage → a node of the line (within 1 m) or a point along one of its pipes. */
export function locateChainage(net: Network, profile: [number, number][], kind: 'pumped' | 'gravity') {
  const ids = profile.map(([ch], k) => (k === 0 ? (kind === 'pumped' ? 'PS-D' : 'R-UP') : k === profile.length - 1 ? (kind === 'pumped' ? 'TANK' : 'V-UP') : `CH${Math.round(ch)}`));
  return (ch: number): { node: string } | { pipe: string; s: number } | null => {
    if (ch < profile[0][0] - 1 || ch > profile[profile.length - 1][0] + 1) return null;
    for (let k = 0; k < profile.length; k++) if (Math.abs(profile[k][0] - ch) <= 1) return { node: ids[k] };
    for (let k = 0; k + 1 < profile.length; k++) {
      if (ch < profile[k][0] || ch > profile[k + 1][0]) continue;
      const p = net.pipes.find((x) => (x.from === ids[k] && x.to === ids[k + 1]) || (x.from === ids[k + 1] && x.to === ids[k]));
      if (!p) return null;
      const w = (ch - profile[k][0]) / (profile[k + 1][0] - profile[k][0]);
      return { pipe: p.id, s: (p.from === ids[k] ? w : 1 - w) * p.length };
    }
    return null;
  };
}

export interface VerifyItem { what: string; ok: boolean; detail: string }
/** Check the built model against what the documents say: flow, pressures along the line, the class. */
export async function verifyModel(net: Network, b: BuildBasis): Promise<VerifyItem[]> {
  const { solveSteady } = await import('../engine/steady');
  const out: VerifyItem[] = [];
  let st;
  try { st = solveSteady(net); } catch (e) { return [{ what: 'Steady state', ok: false, detail: (e as Error).message }]; }
  const q = (b.kind === 'pumped' ? net.pumps.reduce((a, p) => a + (st.flows.get(p.id) ?? 0), 0) : Math.abs(st.flows.get(net.pipes[0]?.id) ?? 0)) * 1000;
  const dq = (q - b.flowLps) / b.flowLps;
  out.push({ what: 'Flow against the design flow', ok: Math.abs(dq) <= 0.1, detail: `${q.toFixed(0)} L/s in the model, ${b.flowLps} L/s in the documents (${dq >= 0 ? '+' : ''}${(dq * 100).toFixed(0)} %)${Math.abs(dq) > 0.1 ? (b.dutyHead ? ' — the stated pump duty head and the line do not agree; check the levels, the diameter and the roughness, or the duty point' : ' — check the levels, the diameter and the roughness') : ''}` });
  let pmin = Infinity, pmax = -Infinity, at = '', atMax = '';
  for (const n of net.nodes) { if (n.kind === 'reservoir') continue; const p = (st.heads.get(n.id) ?? 0) - n.elev; if (p < pmin) { pmin = p; at = n.id; } if (p > pmax) { pmax = p; atMax = n.id; } }
  out.push({ what: 'Steady pressure stays positive', ok: pmin > 2, detail: `lowest ${pmin.toFixed(1)} m at ${at}${pmin <= 2 ? ' — the hydraulic grade line is near or below the pipe; air valves there may admit air in normal operation' : ''}` });
  out.push({ what: 'Steady pressure within the class', ok: pmax < b.classM, detail: `highest ${pmax.toFixed(1)} m at ${atMax}, class ${b.classM} m` });
  if (b.curve && b.dutyHead) {
    const d = (b.curve[1][1] - b.dutyHead) / b.dutyHead;
    out.push({ what: 'Pump curve against the stated duty point', ok: Math.abs(d) <= 0.05, detail: `the curve gives ${b.curve[1][1]} m at ${b.curve[1][0]} L/s; the documents state ${b.dutyHead} m (${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)} %)${Math.abs(d) > 0.05 ? ' — check the impeller diameter or speed of the curve read' : ''}` });
  }
  const v = (b.flowLps / 1000) / ((Math.PI / 4) * (b.diameterMm / 1000) ** 2);
  out.push({ what: 'Velocity', ok: v > 0.3 && v < 2.5, detail: `${v.toFixed(2)} m/s at the design flow` });
  return out;
}

/** Chainage of every node along a single line from its start node (walks pipes, pumps and valves in order). */
export function lineChainage(net: Network, start: string): Map<string, number> {
  const ch = new Map<string, number>([[start, 0]]);
  const links = [...net.pipes.map((p) => ({ a: p.from, b: p.to, L: p.length })), ...net.pumps.map((p) => ({ a: p.from, b: p.to, L: 0 })), ...net.valves.map((v) => ({ a: v.from, b: v.to, L: 0 }))];
  const q = [start];
  while (q.length) {
    const n = q.shift()!;
    for (const l of links) {
      const o = l.a === n ? l.b : l.b === n ? l.a : null;
      if (o && !ch.has(o)) { ch.set(o, ch.get(n)! + l.L); q.push(o); }
    }
  }
  return ch;
}
export function chainageAt(net: Network, ch: Map<string, number>, at: { node: string } | { pipe: string; s: number }): number | undefined {
  if ('node' in at) return ch.get(at.node);
  const p = net.pipes.find((x) => x.id === at.pipe);
  if (!p) return undefined;
  const a = ch.get(p.from), b = ch.get(p.to);
  if (a === undefined || b === undefined) return undefined;
  return a <= b ? a + at.s : a - at.s;
}
export type { Network };
