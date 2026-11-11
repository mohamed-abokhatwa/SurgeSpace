// Drawing canvas: the network editor and the animated results map in one.
// Drawn on a <canvas> so networks with thousands of pipes animate smoothly. Pipes are polylines (bends allowed),
// coordinates are real map coordinates (m or ft), with a world-aligned grid, scale bar and north arrow.
// Tools: select / move, pan, and one tool per element in the palette (nodes, links, protection devices).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PipeEnvelope, TransientResult } from '../engine/transient';
import { HB, HV, area, type Network, type NetNode } from '../engine/types';
import { pressureColor } from './util';
import { EL, deviceDefaults, nodeDevices, valveKind, type ElementKind } from '../app/elements';
import { addLink, addNode, addPipe, insertOnPipe, moveNodes, nearestFraction, pipePath, splitPipe, type ElRef, type ElementDefaults } from '../app/edit';
import { fmtQ, getUnits, toShow, uLabel } from '../app/units';
import { computeContours } from '../app/contours';

export type ColorMode = 'surge' | 'pressure' | 'max' | 'min' | 'steady' | 'plain';
export type Selection = ElRef | null;
export type Tool = 'select' | 'pan' | ElementKind;
export type ColorBy = 'none' | 'diameter' | 'material' | 'class' | 'wavespeed' | 'velocity' | 'elevation';
export type ValueLabel = 'none' | 'elevation' | 'demand' | 'diameter' | 'length' | 'steadyPressure' | 'maxPressure' | 'minPressure' | 'flow' | 'velocity';
export type ContourBy = 'none' | 'elevation' | 'steadyPressure' | 'maxPressure' | 'minPressure' | 'maxHead';
export interface ViewOpts { ids: boolean; values: ValueLabel; grid: boolean; snap: boolean; colorBy: ColorBy; north: boolean; contour?: ContourBy }

interface Theme { text: string; muted: string; faint: string; panel: string; line: string; line1: string; accent: string; cyan: string; warn: string; bad: string; good: string; neutral: string; bg: string; dark: boolean }
const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string) => cs.getPropertyValue(k).trim();
  const dark = cs.colorScheme.includes('dark') || v('--bg').toLowerCase() === '#07111f' || v('--bg').toLowerCase() === '#0b1220';
  return { text: v('--text'), muted: v('--muted'), faint: v('--faint'), panel: v('--panel'), line: v('--line-2'), line1: v('--line'), accent: v('--accent'), cyan: v('--cyan'), warn: v('--warn'), bad: v('--bad'), good: v('--good'), bg: v('--bg'), neutral: dark ? '#55657b' : '#9aa7b8', dark };
}
function divergingLut(neutral: string, dark: boolean): string[] {
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lo = dark ? hex('#4f9dff') : hex('#1d4ed8'), lo2 = dark ? hex('#9cc7ff') : hex('#60a5fa');
  const hi2 = dark ? hex('#ffa38a') : hex('#f87171'), hi = dark ? hex('#ff4d4d') : hex('#b91c1c');
  const mid = hex(neutral);
  const out: string[] = [];
  for (let k = 0; k <= 256; k++) {
    const t = k / 128 - 1, a = Math.abs(t);
    const [c0, c1, w] = a < 0.45 ? [mid, t < 0 ? lo2 : hi2, a / 0.45] : [t < 0 ? lo2 : hi2, t < 0 ? lo : hi, (a - 0.45) / 0.55];
    const c = c0.map((v, i) => Math.round(v + (c1[i] - v) * w));
    out.push(`rgb(${c[0]},${c[1]},${c[2]})`);
  }
  return out;
}
export function surgeScale(result: TransientResult): number {
  let s = 0;
  for (const id in result.frameHeads) {
    const hs = result.frameHeads[id], ns = result.frameSamples[id].length, nf = hs.length / ns;
    for (let f = 1; f < nf; f++) for (let k = 0; k < ns; k++) s = Math.max(s, Math.abs(hs[f * ns + k] - hs[k]));
  }
  return s || 1;
}

// ── colour by attribute ──
const SEQ = ['#2563eb', '#0891b2', '#059669', '#65a30d', '#ca8a04', '#ea580c', '#dc2626'];
const CAT = ['#2563eb', '#ea580c', '#059669', '#9333ea', '#ca8a04', '#db2777', '#0891b2', '#64748b', '#16a34a', '#b91c1c'];
export interface ColorLegend { title: string; items: { color: string; label: string }[] }
/** Colour function per pipe for an attribute, and its legend. */
export function colorByPipes(net: Network, result: TransientResult | null, by: ColorBy): { color: (pipeId: string) => string | null; legend: ColorLegend | null } {
  if (by === 'none') return { color: () => null, legend: null };
  const u = getUnits();
  if (by === 'material') {
    const mats = [...new Set(net.pipes.map((p) => p.material || 'Not set'))];
    const map = new Map(mats.map((m, i) => [m, CAT[i % CAT.length]]));
    return { color: (id) => map.get(net.pipes.find((p) => p.id === id)?.material || 'Not set') ?? null, legend: { title: 'Material', items: mats.map((m) => ({ color: map.get(m)!, label: m })) } };
  }
  const val = (id: string): number => {
    const p = net.pipes.find((x) => x.id === id);
    if (!p) return NaN;
    if (by === 'diameter') return p.diameter;
    if (by === 'class') return p.pressureClass ?? NaN;
    if (by === 'wavespeed') return p.wavespeed;
    if (by === 'elevation') { const a = net.nodes.find((n) => n.id === p.from)?.elev ?? 0, b = net.nodes.find((n) => n.id === p.to)?.elev ?? 0; return (a + b) / 2; }
    if (by === 'velocity') { const q = result?.steady.flows[p.id]; return q === undefined ? NaN : Math.abs(q) / area(p.diameter); }
    return NaN;
  };
  const vals = [...new Set(net.pipes.map((p) => val(p.id)).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!vals.length) return { color: () => null, legend: { title: 'No values', items: [] } };
  const q = by === 'diameter' ? 'diameter' : by === 'velocity' ? 'velocity' : by === 'wavespeed' ? 'wavespeed' : by === 'class' ? 'pressureHead' : 'elevation';
  const title = { diameter: 'Diameter', class: 'Pressure class', wavespeed: 'Wave speed', elevation: 'Mean elevation', velocity: 'Steady velocity' }[by];
  // discrete values (few) get one colour each; otherwise 7 equal bins
  if (vals.length <= 7) {
    const map = new Map(vals.map((v, i) => [v, SEQ[Math.round((i * (SEQ.length - 1)) / Math.max(vals.length - 1, 1))]]));
    return { color: (id) => map.get(val(id)) ?? null, legend: { title: `${title} (${uLabel(q, u)})`, items: vals.map((v) => ({ color: map.get(v)!, label: (+toShow(v, q, u).toPrecision(4)).toLocaleString() })) } };
  }
  const lo = vals[0], hi = vals[vals.length - 1], n = SEQ.length;
  const bin = (v: number) => Math.min(n - 1, Math.floor(((v - lo) / Math.max(hi - lo, 1e-12)) * n));
  return {
    color: (id) => { const v = val(id); return Number.isFinite(v) ? SEQ[bin(v)] : null; },
    legend: { title: `${title} (${uLabel(q, u)})`, items: SEQ.map((c, i) => ({ color: c, label: `${(+toShow(lo + ((hi - lo) * i) / n, q, u).toPrecision(3)).toLocaleString()} – ${(+toShow(lo + ((hi - lo) * (i + 1)) / n, q, u).toPrecision(3)).toLocaleString()}` })) },
  };
}

interface GeoPipe { id: string; pts: { x: number; y: number }[]; cum: number[]; L: number; w: number; area: number; closed: boolean; cls: number; zA: number; zB: number; cv: boolean }
interface Geo { pos: Map<string, { x: number; y: number }>; pipes: GeoPipe[]; bounds: { x0: number; y0: number; x1: number; y1: number }; typical: number; nodeClass: Map<string, number> }

/** Nice grid step (world units) for a scale in px per unit. */
function gridStep(s: number) {
  const target = 40 / s;
  const p = 10 ** Math.floor(Math.log10(target));
  for (const m of [1, 2, 5, 10]) if (m * p >= target) return m * p;
  return 10 * p;
}

type DrawState =
  | { kind: 'pipe'; from: string | null; verts: { x: number; y: number }[] }
  | { kind: 'link'; from: string | null }
  | null;

type Preview = { kind: 'node'; ids: string[]; dx: number; dy: number } | { kind: 'vertex'; pipe: string; vertex: number; dx: number; dy: number } | null;

export function Canvas({
  net: netIn, result, envelopes, framePos, mode, selected, onSelect, route, flowDashes, playing, sScale = 1,
  tool, onEdit, view: vo, defaults, onCursor, fitKey, onContext, onToolEnd, colorFn, bottomInset = 0, probe, onProbe, tankFill,
}: {
  net: Network;
  result: TransientResult | null;
  envelopes?: PipeEnvelope[];
  framePos: number;
  mode: ColorMode;
  selected: ElRef[];
  onSelect: (refs: ElRef[], additive?: boolean) => void;
  route: Set<string>;
  flowDashes: boolean;
  playing: boolean;
  sScale?: number;
  tool: Tool;
  /** Apply an edit (one undo step). `select` = what to select afterwards. */
  onEdit: (f: (n: Network) => Network, select?: ElRef[], label?: string) => void;
  view: ViewOpts;
  defaults: ElementDefaults;
  onCursor?: (w: { x: number; y: number } | null) => void;
  fitKey?: number;
  onContext?: (e: { x: number; y: number; ref: ElRef | null; world: { x: number; y: number }; u?: number }) => void;
  onToolEnd?: () => void;
  colorFn?: (pipeId: string) => string | null;
  /** Space taken by overlays at the bottom (player), px. */
  bottomInset?: number;
  /** A point on a pipe highlighted from another view (profile, graphs). */
  probe?: { pipe: string; s: number } | null;
  /** Hovering a pipe reports the point under the pointer (for the profile and graphs). */
  onProbe?: (p: { pipe: string; s: number } | null) => void;
  /** Daily operation: storage tank fill (0–1) at the time shown. */
  tankFill?: (nodeId: string) => number | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400, dpr: 1 });
  const [theme, setTheme] = useState<Theme | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; sel: ElRef } | null>(null);
  const [drawing, setDrawing] = useState<DrawState>(null);
  const cursor = useRef<{ x: number; y: number } | null>(null); // screen
  const box = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const editing = !result || mode === 'plain';
  // while dragging, the canvas shows the moved model; the edit is committed on release (one undo step)
  const [pv, setPv] = useState<Preview>(null);
  const net = useMemo(() => {
    if (!pv) return netIn;
    if (pv.kind === 'node') return moveNodes(netIn, pv.ids, pv.dx, pv.dy);
    return { ...netIn, pipes: netIn.pipes.map((pp) => (pp.id !== pv.pipe || !pp.vertices ? pp : { ...pp, vertices: pp.vertices.map((v, i) => (i === pv.vertex ? { x: v.x + pv.dx, y: v.y + pv.dy } : v)) })) };
  }, [netIn, pv]);

  useEffect(() => {
    const upd = () => setTheme(readTheme());
    upd();
    const mo = new MutationObserver(upd);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', upd);
    return () => { mo.disconnect(); mq.removeEventListener('change', upd); };
  }, []);
  const lut = useMemo(() => (theme ? divergingLut(theme.neutral, theme.dark) : []), [theme]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight, dpr: Math.min(window.devicePixelRatio || 1, 2) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // leaving a drawing tool cancels the pipe being drawn
  useEffect(() => { setDrawing(null); }, [tool]);

  const geo: Geo = useMemo(() => {
    const pos = new Map(net.nodes.map((n) => [n.id, { x: n.x, y: -n.y }]));
    const elev = new Map(net.nodes.map((n) => [n.id, n.elev]));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const grow = (p: { x: number; y: number }) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); };
    pos.forEach(grow);
    if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 100; y1 = 100; }
    const pipes: GeoPipe[] = net.pipes.flatMap((p) => {
      const a = pos.get(p.from), b = pos.get(p.to);
      if (!a || !b) return [];
      const pts = [a, ...(p.vertices ?? []).map((v) => ({ x: v.x, y: -v.y })), b];
      pts.forEach(grow);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const tot = cum[cum.length - 1] || 1;
      return [{ id: p.id, pts, cum: cum.map((c) => c / tot), L: p.length, w: Math.max(0.7, Math.min(2.2, p.diameter / 0.35)), area: area(p.diameter), closed: !!p.closed, cls: p.pressureClass ?? 100, zA: elev.get(p.from) ?? 0, zB: elev.get(p.to) ?? 0, cv: !!p.checkValve }];
    });
    const lens = pipes.map((p) => Math.hypot(p.pts[p.pts.length - 1].x - p.pts[0].x, p.pts[p.pts.length - 1].y - p.pts[0].y)).filter((v) => v > 0).sort((a, b) => a - b);
    const nodeClass = new Map<string, number>();
    for (const p of net.pipes) for (const id of [p.from, p.to]) nodeClass.set(id, Math.max(nodeClass.get(id) ?? 0, p.pressureClass ?? 100));
    return { pos, pipes, bounds: { x0, y0, x1, y1 }, typical: lens[lens.length >> 1] || 1, nodeClass };
  }, [net.nodes, net.pipes]);

  const view = useRef({ ox: 0, oy: 0, s: 1 });
  const fitted = useRef(false);
  const fit = useCallback(() => {
    const { x0, y0, x1, y1 } = geo.bounds;
    const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
    const padL = 40, padR = 70, padT = 60, padB = 110;
    let s = Math.min((size.w - padL - padR) / w, (size.h - padT - padB) / h);
    if (!Number.isFinite(s) || s <= 0) s = 1;
    if (net.nodes.length <= 1) s = Math.min(s, 2);
    view.current = { s, ox: x0 - (size.w - w * s) / 2 / s + (padL - padR) / 2 / s, oy: y0 - (padT + (size.h - padT - padB - h * s) / 2) / s };
  }, [geo.bounds, size.w, size.h, net.nodes.length]);
  // fit when the model is replaced (fitKey), or the first time; not on every edit
  const userMoved = useRef(false);
  useEffect(() => { fit(); fitted.current = true; userMoved.current = false; }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // follow size changes until the user pans or zooms
  useEffect(() => { if (!userMoved.current) fit(); }, [size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // contour lines of a node value
  const contourBy = vo.contour ?? 'none';
  const contours = useMemo(() => {
    if (contourBy === 'none') return null;
    if (contourBy !== 'elevation' && !result) return null;
    const pts = netIn.nodes.filter((n) => n.kind === 'junction' || contourBy === 'elevation').map((n) => {
      const v = contourBy === 'elevation' ? n.elev : contourBy === 'steadyPressure' ? (result!.steady.heads[n.id] ?? NaN) - n.elev
        : contourBy === 'maxPressure' ? result!.nodeMax[n.id] - n.elev : contourBy === 'minPressure' ? result!.nodeMin[n.id] - n.elev : result!.nodeMax[n.id];
      return { x: n.x, y: -n.y, v };
    });
    return computeContours(pts);
  }, [contourBy, netIn.nodes, result]);
  // background picture
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);
  const bgSrc = netIn.background?.src;
  useEffect(() => {
    if (!bgSrc) { setBgImg(null); return; }
    const im = new Image();
    im.onload = () => setBgImg(im);
    im.src = bgSrc;
  }, [bgSrc]);
  const envMap = useMemo(() => new Map((envelopes ?? result?.envelopes ?? []).map((e) => [e.id, e])), [envelopes, result]);
  const pumpGroups = useMemo(() => {
    const g = new Map<string, string[]>();
    net.pumps.forEach((p) => g.set(`${p.from}>${p.to}`, [...(g.get(`${p.from}>${p.to}`) ?? []), p.id]));
    return [...g.entries()].map(([k, ids]) => ({ from: k.split('>')[0], to: k.split('>')[1], ids }));
  }, [net.pumps]);
  const selSet = useMemo(() => new Set(selected.map((r) => `${r.type}:${r.id}`)), [selected]);

  const anim = useRef({ phase: new Map<string, number>(), rotor: new Map<string, number>(), last: performance.now(), reveal: 0, needMore: false });
  // results sweep in across the drawing when a run finishes
  useEffect(() => { if (result) anim.current.reveal = performance.now(); }, [result]);
  const props = useRef({ framePos, mode, route, flowDashes, playing, drawing, tool, vo, selSet, probe });
  props.current = { framePos, mode, route, flowDashes, playing, drawing, tool, vo, selSet, probe };

  const toWorld = (sx: number, sy: number) => ({ x: view.current.ox + sx / view.current.s, y: -(view.current.oy + sy / view.current.s) });
  const snapW = (q: { x: number; y: number }) => {
    if (!props.current.vo.snap) return q;
    const st = gridStep(view.current.s) / 2;
    return { x: Math.round(q.x / st) * st, y: Math.round(q.y / st) * st };
  };

  const draw = useCallback(() => {
    const c = cvs.current;
    if (!c || !theme) return;
    const ctx = c.getContext('2d')!;
    const { w, h, dpr } = size;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // opaque background, so exported pictures and recorded films look like the screen
    ctx.fillStyle = theme.bg || '#f4f6fa'; ctx.fillRect(0, 0, w, h);
    const { s, ox, oy } = view.current;
    const X = (x: number) => (x - ox) * s, Y = (y: number) => (y - oy) * s;
    const { framePos: fp, mode: md, route: rt, flowDashes: dashes, drawing: dr, vo: opt, selSet: ss } = props.current;
    const sel = (type: string, id: string) => ss.has(`${type}:${id}`);
    const now = performance.now();
    const dtReal = Math.min(0.1, (now - anim.current.last) / 1000);
    anim.current.last = now;
    const nF = result ? result.times.length : 0;
    const f0 = Math.max(0, Math.min(nF - 1, Math.floor(fp)));
    const f1 = Math.min(nF - 1, f0 + 1);
    const wf = Math.max(0, Math.min(1, fp - f0));
    const live = !!result && (md === 'surge' || md === 'pressure');
    const tNow = result ? result.times[f0] + (result.times[f1] - result.times[f0]) * wf : 0;
    const baseW = Math.max(2, Math.min(5.5, (geo.typical * s) / 40));
    const units = getUnits();

    // ── world grid ──
    if (opt.grid) {
      const st = gridStep(s);
      const wx0 = ox, wx1 = ox + w / s, wy0 = oy, wy1 = oy + h / s;
      ctx.lineWidth = 1;
      for (const [step, alpha] of [[st, theme.dark ? 0.05 : 0.055], [st * 5, theme.dark ? 0.1 : 0.1]] as const) {
        ctx.strokeStyle = theme.dark ? `rgba(140,180,230,${alpha})` : `rgba(20,50,90,${alpha})`;
        ctx.beginPath();
        for (let gx = Math.ceil(wx0 / step) * step; gx <= wx1; gx += step) { const x = Math.round(X(gx)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
        for (let gy = Math.ceil(wy0 / step) * step; gy <= wy1; gy += step) { const y = Math.round(Y(gy)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(w, y); }
        ctx.stroke();
      }
    }

    // background picture under everything else
    const bg = net.background;
    if (bg?.visible && bgImg) {
      ctx.globalAlpha = Math.max(0.05, Math.min(1, bg.opacity));
      ctx.drawImage(bgImg, X(bg.x0), Y(-bg.y1), (bg.x1 - bg.x0) * s, (bg.y1 - bg.y0) * s);
      ctx.globalAlpha = 1;
      if (bg.attribution) {
        ctx.font = '10px sans-serif';
        const tw = ctx.measureText(bg.attribution).width;
        ctx.fillStyle = theme.dark ? 'rgba(7,17,31,0.7)' : 'rgba(255,255,255,0.75)';
        ctx.fillRect(size.w - tw - 10, size.h - bottomInset - 16, tw + 8, 14);
        ctx.fillStyle = theme.dark ? '#cbd5e1' : '#334155';
        ctx.fillText(bg.attribution, size.w - tw - 6, size.h - bottomInset - 5);
      }
    }
    // notes on the drawing
    for (const a of net.annotations ?? []) {
      ctx.font = '12px sans-serif';
      const lines = a.text.split('\n');
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 10, h = lines.length * 15 + 6;
      const x = X(a.x), y = Y(-a.y);
      ctx.fillStyle = theme.dark ? 'rgba(12,26,44,0.85)' : 'rgba(255,253,235,0.95)';
      ctx.strokeStyle = theme.dark ? '#f59e0b' : '#d97706';
      ctx.fillRect(x, y - h, w, h); ctx.strokeRect(x, y - h, w, h);
      ctx.fillStyle = theme.dark ? '#fde68a' : '#78350f';
      lines.forEach((l, k) => ctx.fillText(l, x + 5, y - h + 15 + k * 15));
    }
    // contours (under the pipes)
    if (contours) {
      const q = contourBy === 'elevation' ? 'elevation' : contourBy === 'maxHead' ? 'head' : 'pressureHead';
      const pal = ['#2563eb', '#0891b2', '#059669', '#65a30d', '#ca8a04', '#ea580c', '#dc2626', '#be185d', '#7c3aed', '#4338ca'];
      const nL = contours.levels.length;
      const byK: Path2D[] = contours.levels.map(() => new Path2D());
      for (const g of contours.segs) { byK[g.k].moveTo(X(g.x1), Y(g.y1)); byK[g.k].lineTo(X(g.x2), Y(g.y2)); }
      ctx.lineWidth = 1.3; ctx.setLineDash([]);
      byK.forEach((p2, k) => { ctx.strokeStyle = pal[Math.round((k * (pal.length - 1)) / Math.max(nL - 1, 1))]; ctx.globalAlpha = 0.75; ctx.stroke(p2); });
      ctx.globalAlpha = 1;
      // a label on every ~40th segment of each level
      ctx.font = '600 10px IBM Plex Sans, system-ui';
      const seen = new Map<number, number>();
      for (const g of contours.segs) {
        const c = (seen.get(g.k) ?? 0) + 1; seen.set(g.k, c);
        if (c % 40 !== 5) continue;
        const sx2 = X((g.x1 + g.x2) / 2), sy2 = Y((g.y1 + g.y2) / 2);
        if (sx2 < 0 || sx2 > w || sy2 < 0 || sy2 > h) continue;
        const txt = toShow(contours.levels[g.k], q, units).toFixed(0);
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = theme.dark ? 'rgba(7,17,31,0.85)' : 'rgba(255,255,255,0.9)'; ctx.fillRect(sx2 - tw / 2 - 2, sy2 - 6, tw + 4, 12);
        ctx.fillStyle = pal[Math.round((g.k * (pal.length - 1)) / Math.max(nL - 1, 1))]; ctx.textAlign = 'center'; ctx.fillText(txt, sx2, sy2 + 4); ctx.textAlign = 'left';
      }
    }
    // screen polylines
    const SP = new Map<string, number[]>();
    for (const p of geo.pipes) { const a: number[] = []; for (const q of p.pts) a.push(X(q.x), Y(q.y)); SP.set(p.id, a); }
    const at = (p: GeoPipe, sp: number[], u: number): [number, number, number] => {
      const cum = p.cum;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < u) i++;
      const t = (u - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      const tt = Math.max(0, Math.min(1, t));
      return [sp[2 * i - 2] + (sp[2 * i] - sp[2 * i - 2]) * tt, sp[2 * i - 1] + (sp[2 * i + 1] - sp[2 * i - 1]) * tt, i];
    };
    const sub = (path: Path2D | CanvasRenderingContext2D, p: GeoPipe, sp: number[], u0: number, u1: number) => {
      const [x0, y0, i0] = at(p, sp, u0);
      const [x1, y1, i1] = at(p, sp, u1);
      path.moveTo(x0, y0);
      for (let i = i0; i < i1; i++) path.lineTo(sp[2 * i], sp[2 * i + 1]);
      path.lineTo(x1, y1);
    };
    const full = (path: Path2D | CanvasRenderingContext2D, sp: number[]) => { path.moveTo(sp[0], sp[1]); for (let i = 2; i < sp.length; i += 2) path.lineTo(sp[i], sp[i + 1]); };

    // route highlight
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const p of geo.pipes) {
      if (!rt.has(p.id)) continue;
      ctx.strokeStyle = theme.accent; ctx.globalAlpha = 0.13; ctx.lineWidth = baseW * p.w + 8;
      ctx.beginPath(); full(ctx, SP.get(p.id)!); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const groups = new Map<string, { col: string; w: number; path: Path2D }>();
    const grp = (col: string, wpx: number) => {
      const wq = Math.round(wpx * 2) / 2, key = col + '|' + wq;
      let g = groups.get(key);
      if (!g) { g = { col, w: wq, path: new Path2D() }; groups.set(key, g); }
      return g.path;
    };
    const dashGroups = new Map<string, { w: number; d: number; gap: number; off: number; path: Path2D }>();
    const casing = new Path2D();
    let casingW = 0;
    for (const p of geo.pipes) {
      const sp = SP.get(p.id)!;
      let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
      for (let i = 0; i < sp.length; i += 2) { mnx = Math.min(mnx, sp[i]); mxx = Math.max(mxx, sp[i]); mny = Math.min(mny, sp[i + 1]); mxy = Math.max(mxy, sp[i + 1]); }
      if (mxx < -20 || mnx > w + 20 || mxy < -20 || mny > h + 20) continue;
      const lw = baseW * p.w;
      if (sel('pipe', p.id)) { ctx.strokeStyle = theme.accent; ctx.globalAlpha = 0.35; ctx.lineWidth = lw + 9; ctx.beginPath(); full(ctx, sp); ctx.stroke(); ctx.globalAlpha = 1; }
      if (p.closed) {
        ctx.setLineDash([5, 5]); ctx.strokeStyle = theme.faint; ctx.lineWidth = lw;
        ctx.beginPath(); full(ctx, sp); ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      let screenLen = 0;
      for (let i = 2; i < sp.length; i += 2) screenLen += Math.hypot(sp[i] - sp[i - 2], sp[i + 1] - sp[i - 1]);
      if (!result || md === 'plain') {
        const col = colorFn?.(p.id) ?? (theme.dark ? '#7f93ad' : '#5b6b80');
        full(casing, sp); casingW = Math.max(casingW, lw + 2.5);
        full(grp(col, lw), sp);
        continue;
      }
      const env = envMap.get(p.id);
      const zAt = (u: number) => {
        if (!env) return p.zA + (p.zB - p.zA) * u;
        const sx = u * p.L, xs = env.s, zs = env.z;
        let i = 1;
        while (i < xs.length - 1 && xs[i] < sx) i++;
        const t = (sx - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
        return zs[i - 1] + (zs[i] - zs[i - 1]) * Math.max(0, Math.min(1, t));
      };
      if (live) {
        const sm = result.frameSamples[p.id], hs = result.frameHeads[p.id];
        if (!sm || !hs) continue;
        const ns = sm.length;
        const step = Math.max(1, Math.floor((ns - 1) / Math.max(1, screenLen / 3)));
        let k = 0;
        while (k < ns - 1) {
          const k2 = Math.min(ns - 1, k + step);
          const hA = hs[f0 * ns + k] + (hs[f1 * ns + k] - hs[f0 * ns + k]) * wf;
          const hB = hs[f0 * ns + k2] + (hs[f1 * ns + k2] - hs[f0 * ns + k2]) * wf;
          const u0 = sm[k] / p.L, u1 = sm[k2] / p.L;
          if (md === 'surge') {
            const d = ((hA + hB) / 2 - (hs[k] + hs[k2]) / 2) / sScale;
            const t = Math.sign(d) * Math.min(1, Math.abs(d)) ** 0.75;
            sub(grp(lut[Math.round((t + 1) * 128)], lw + Math.abs(t) * lw * 0.9), p, sp, u0, u1);
          } else sub(grp(pressureColor(Math.round((hA + hB) / 2 - zAt((u0 + u1) / 2)), p.cls), lw), p, sp, u0, u1);
          k = k2;
        }
      } else if (env) {
        const n = env.s.length;
        const nSeg = Math.max(1, Math.min(n - 1, Math.floor(screenLen / 4), 40));
        const arr = md === 'max' ? env.hMax : md === 'min' ? env.hMin : env.hSteady;
        for (let g = 0; g < nSeg; g++) {
          const i0 = Math.floor((g * (n - 1)) / nSeg), i1 = Math.floor(((g + 1) * (n - 1)) / nSeg);
          let pv = md === 'max' ? -Infinity : Infinity;
          for (let i = i0; i <= i1; i++) { const v = arr[i] - env.z[i]; pv = md === 'max' ? Math.max(pv, v) : md === 'min' ? Math.min(pv, v) : v; }
          sub(grp(pressureColor(Math.round(pv), p.cls), lw), p, sp, env.s[i0] / p.L, env.s[i1] / p.L);
        }
      }
      if (live && dashes && screenLen > 14) {
        const qs = result.frameFlows?.[p.id];
        if (qs) {
          const q = qs[f0] + (qs[f1] - qs[f0]) * wf;
          const v = q / p.area;
          const ph = anim.current.phase.get(p.id) ?? Math.random() * 20;
          const speedPx = Math.sign(v) * Math.min(90, 34 * Math.sqrt(Math.abs(v)));
          const dLen = Math.max(3, Math.round(lw * 1.6)), gap = Math.max(7, Math.round(lw * 3.5)), P = dLen + gap;
          const nph = (((ph + speedPx * dtReal) % P) + P) % P;
          anim.current.phase.set(p.id, nph);
          if (Math.abs(v) > 0.02) {
            const off = Math.round((nph / P) * 12) / 12 * P;
            const wq = Math.max(1, Math.round(lw * 0.42 * 2) / 2);
            const key = `${wq}|${dLen}|${gap}|${off}`;
            let g = dashGroups.get(key);
            if (!g) { g = { w: wq, d: dLen, gap, off, path: new Path2D() }; dashGroups.set(key, g); }
            full(g.path, sp);
          }
        }
      }
    }
    if (casingW) { ctx.strokeStyle = theme.dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.95)'; ctx.lineWidth = casingW; ctx.stroke(casing); }
    ctx.lineCap = !result || md === 'plain' ? 'round' : 'butt';
    const rvT = result && md !== 'plain' && !reduceMotion ? (now - anim.current.reveal) / 700 : 1;
    if (rvT < 1) {
      // reveal: neutral pipes, the result colours sweeping across from the left with a bright leading edge
      const e = 1 - (1 - Math.max(0, rvT)) ** 3, xe = -40 + (w + 80) * e;
      for (const g of groups.values()) { ctx.strokeStyle = theme.dark ? '#41516a' : '#b8c2cf'; ctx.lineWidth = g.w; ctx.stroke(g.path); }
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, Math.max(0, xe), h); ctx.clip();
      for (const g of groups.values()) { ctx.strokeStyle = g.col; ctx.lineWidth = g.w; ctx.stroke(g.path); }
      ctx.restore();
      const gr = ctx.createLinearGradient(xe - 40, 0, xe, 0);
      gr.addColorStop(0, 'rgba(255,122,26,0)'); gr.addColorStop(1, theme.dark ? 'rgba(255,122,26,0.22)' : 'rgba(255,122,26,0.16)');
      ctx.fillStyle = gr; ctx.fillRect(xe - 40, 0, 40, h);
      anim.current.needMore = true;
    } else for (const g of groups.values()) { ctx.strokeStyle = g.col; ctx.lineWidth = g.w; ctx.stroke(g.path); }
    // vapour cavities: bubbles along pipe stretches at vapour pressure in this frame
    if (live && result) {
      const vapP = HV - HB + 0.4;
      ctx.fillStyle = theme.dark ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = theme.dark ? 'rgba(92,200,255,0.9)' : 'rgba(10,106,176,0.8)';
      ctx.lineWidth = 1;
      for (const p of geo.pipes) {
        const sm = result.frameSamples[p.id], hs = result.frameHeads[p.id], env = envMap.get(p.id);
        const sp = SP.get(p.id);
        if (!sm || !hs || !env || !sp) continue;
        const ns = sm.length;
        for (let k = 0; k < ns; k++) {
          const hk = hs[f0 * ns + k];
          const zk = env.z[Math.min(env.z.length - 1, Math.round((k / Math.max(ns - 1, 1)) * (env.z.length - 1)))];
          if (hk - zk > vapP) continue;
          const [px2, py2] = at(p, sp, sm[k] / p.L); const pt = { x: px2, y: py2 };
          const rr = Math.max(2, Math.min(5, baseW * 0.9)) * (0.8 + 0.25 * Math.sin(now / 140 + k));
          ctx.beginPath(); ctx.arc(pt.x, pt.y - baseW, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
    }
    // probe from the profile or graphs: a pulsing marker at the point
    const pr = props.current.probe;
    if (pr) {
      const gp = geo.pipes.find((q) => q.id === pr.pipe), sp = SP.get(pr.pipe);
      if (gp && sp) {
        const [px3, py3] = at(gp, sp, Math.max(0, Math.min(1, pr.s / gp.L))); const pt = { x: px3, y: py3 };
        const pulse = (now % 1200) / 1200;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 6 + pulse * 14, 0, Math.PI * 2); ctx.strokeStyle = theme.accent; ctx.globalAlpha = 1 - pulse; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2); ctx.fillStyle = theme.accent; ctx.fill(); ctx.strokeStyle = theme.panel; ctx.lineWidth = 2; ctx.stroke();
        anim.current.needMore = true;
      }
    }
    ctx.lineCap = 'round';
    if (dashGroups.size) {
      ctx.save();
      ctx.strokeStyle = theme.dark ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.9)';
      for (const g of dashGroups.values()) { ctx.setLineDash([g.d, g.gap]); ctx.lineDashOffset = -g.off; ctx.lineWidth = g.w; ctx.stroke(g.path); }
      ctx.restore();
    }
    // bend handles on selected pipes (editing)
    if (editing) for (const p of geo.pipes) {
      if (!sel('pipe', p.id) || p.pts.length <= 2) continue;
      const sp = SP.get(p.id)!;
      for (let i = 2; i < sp.length - 2; i += 2) { ctx.fillStyle = theme.panel; ctx.strokeStyle = theme.accent; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.rect(sp[i] - 3.5, sp[i + 1] - 3.5, 7, 7); ctx.fill(); ctx.stroke(); }
    }

    // pumps
    const r0 = Math.max(8, Math.min(15, baseW * 3.2));
    for (const g of pumpGroups) {
      const a = geo.pos.get(g.from), b = geo.pos.get(g.to);
      if (!a || !b) continue;
      const mx = (X(a.x) + X(b.x)) / 2, my = (Y(a.y) + Y(b.y)) / 2;
      const ang = Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x));
      const ps = result?.pumps[g.ids[0]];
      const alpha = ps ? ps.speed[f0] + (ps.speed[f1] - ps.speed[f0]) * wf : 1;
      const rot = (anim.current.rotor.get(g.ids[0]) ?? 0) + (live ? alpha * 9 * dtReal : 0);
      anim.current.rotor.set(g.ids[0], rot);
      const isS = g.ids.some((id) => sel('pump', id));
      ctx.strokeStyle = theme.muted; ctx.lineWidth = baseW;
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
      if (isS) { ctx.beginPath(); ctx.arc(mx, my, r0 + 5, 0, Math.PI * 2); ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = theme.panel; ctx.strokeStyle = isS ? theme.accent : theme.text; ctx.lineWidth = isS ? 2.5 : 1.7;
      ctx.beginPath(); ctx.arc(mx, my, r0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.save(); ctx.translate(mx, my);
      if (live) {
        ctx.rotate(rot);
        ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.35 + 0.65 * Math.max(0, Math.min(1, alpha));
        for (let k = 0; k < 3; k++) { ctx.rotate((Math.PI * 2) / 3); ctx.beginPath(); ctx.ellipse(r0 * 0.38, 0, r0 * 0.42, r0 * 0.17, 0.5, 0, Math.PI * 2); ctx.fill(); }
      } else {
        ctx.rotate(ang); ctx.fillStyle = theme.accent;
        ctx.beginPath(); ctx.moveTo(-r0 * 0.45, -r0 * 0.5); ctx.lineTo(r0 * 0.6, 0); ctx.lineTo(-r0 * 0.45, r0 * 0.5); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      if (g.ids.length > 1) { ctx.fillStyle = theme.muted; ctx.font = '600 11px IBM Plex Sans, system-ui'; ctx.fillText(`×${g.ids.length}`, mx + r0 + 2, my - r0 + 2); }
    }

    // valves (line valves bow-tie; control valves with a letter; NRV with a bar; orifice as a plate)
    for (const v of net.valves) {
      const a = geo.pos.get(v.from), b = geo.pos.get(v.to);
      if (!a || !b) continue;
      const mx = (X(a.x) + X(b.x)) / 2, my = (Y(a.y) + Y(b.y)) / 2;
      const ang = Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x));
      const vr = result?.valves[v.id];
      const open = vr ? vr.opening[f0] + (vr.opening[f1] - vr.opening[f0]) * wf : v.opening;
      const r = r0 * 0.85;
      const isS = sel('valve', v.id);
      const kind = valveKind(v);
      ctx.strokeStyle = theme.muted; ctx.lineWidth = baseW;
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
      if (isS) { ctx.beginPath(); ctx.arc(mx, my, r + 7, 0, Math.PI * 2); ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
      if (kind === 'turbine') {
        const rt = r0 * 1.05;
        ctx.restore(); ctx.save(); ctx.translate(mx, my);
        ctx.beginPath(); ctx.arc(0, 0, rt, 0, Math.PI * 2); ctx.fillStyle = theme.panel; ctx.fill();
        ctx.strokeStyle = isS ? theme.accent : theme.cyan; ctx.lineWidth = isS ? 2.5 : 1.8; ctx.stroke();
        const spin = (anim.current.rotor.get(v.id) ?? 0) + (live ? (1 - Math.min(1, open)) * 6 * dtReal + 2 * dtReal : 0);
        anim.current.rotor.set(v.id, spin);
        ctx.rotate(spin);
        ctx.strokeStyle = theme.cyan; ctx.lineWidth = 1.6;
        for (let k = 0; k < 4; k++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(rt * 0.55, -rt * 0.15, rt * 0.7, rt * 0.35); ctx.stroke(); }
        if (open < 0.999) { ctx.rotate(-spin); ctx.fillStyle = theme.bad; ctx.globalAlpha = 0.8; ctx.fillRect(-rt, rt + 3, 2 * rt * (1 - open), 3); ctx.globalAlpha = 1; }
      } else if (kind === 'orifice') {
        ctx.fillStyle = theme.panel; ctx.fillRect(-2.5, -r, 5, 2 * r);
        ctx.strokeStyle = isS ? theme.accent : theme.text; ctx.lineWidth = 1.6; ctx.strokeRect(-2.5, -r, 5, 2 * r);
        ctx.clearRect(-2, -r * 0.3, 4, r * 0.6); ctx.fillStyle = theme.muted; ctx.fillRect(-0.5, -r * 0.3, 1, r * 0.6);
      } else {
        ctx.beginPath(); ctx.moveTo(-r, -r * 0.7); ctx.lineTo(r, r * 0.7); ctx.lineTo(r, -r * 0.7); ctx.lineTo(-r, r * 0.7); ctx.closePath();
        ctx.fillStyle = open > 0.01 ? theme.panel : theme.bad; ctx.fill();
        if (open > 0.01 && open < 0.999) { ctx.fillStyle = theme.bad; ctx.globalAlpha = 0.85; ctx.fillRect(-r * 0.12, -r * 0.7 * (1 - open), r * 0.24, r * 1.4 * (1 - open)); ctx.globalAlpha = 1; }
        ctx.strokeStyle = isS ? theme.accent : theme.text; ctx.lineWidth = isS ? 2.4 : 1.5; ctx.stroke();
        if (kind === 'nrv') { ctx.beginPath(); ctx.moveTo(r, -r * 0.9); ctx.lineTo(r, r * 0.9); ctx.lineWidth = 2.2; ctx.stroke(); }
      }
      ctx.restore();
      if (kind === 'prv' || kind === 'psv' || kind === 'fcv') {
        ctx.fillStyle = theme.cyan; ctx.beginPath(); ctx.roundRect(mx - 13, my - r - 15, 26, 12, 3); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 9px IBM Plex Sans, system-ui'; ctx.textAlign = 'center'; ctx.fillText(kind.toUpperCase(), mx, my - r - 6); ctx.textAlign = 'left';
      }
    }

    // non-return valves on pipes: arrow near the start pointing the allowed way, dark when shut
    for (const p of geo.pipes) {
      if (!p.cv) continue;
      const sp = SP.get(p.id)!;
      const ax = sp[0], ay = sp[1], bx = sp[2], by = sp[3];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const off = Math.min(22, len * 0.3);
      const cx = ax + ((bx - ax) * off) / len, cy = ay + ((by - ay) * off) / len;
      const ang = Math.atan2(by - ay, bx - ax);
      const cv = result?.checkValves?.[p.id];
      const shut = !!cv && live && cv.opening[f0] < 0.01;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath();
      ctx.fillStyle = shut ? theme.bad : theme.panel; ctx.fill();
      ctx.strokeStyle = sel('pipe', p.id) ? theme.accent : theme.text; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(6, 6); ctx.stroke();
      ctx.restore();
    }

    // nodes and devices
    const many = net.nodes.length > 400;
    const showIds = opt.ids && (net.nodes.length < 120 || geo.typical * s > 60);
    for (const n of net.nodes) {
      const p = geo.pos.get(n.id)!;
      const x = X(p.x), y = Y(p.y);
      if (x < -40 || x > w + 40 || y < -50 || y > h + 40) continue;
      const isS = sel('node', n.id);
      if (isS) { ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2); ctx.fillStyle = theme.accent; ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1; }
      if (n.kind === 'reservoir') {
        const r = r0 * 1.05;
        ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.65); ctx.lineTo(x + r, y - r * 0.65); ctx.lineTo(x + r * 0.78, y + r * 0.7); ctx.lineTo(x - r * 0.78, y + r * 0.7); ctx.closePath();
        ctx.fillStyle = theme.panel; ctx.fill();
        ctx.save(); ctx.clip();
        const wave = n.headSchedule ? Math.sin(now / 500) * 2.5 : Math.sin(now / 600) * 1.2;
        const tf = n.storage ? tankFill?.(n.id) ?? null : null;
        if (tf !== null) {
          // storage tank in daily operation: the water level at the time shown
          const top = y - r * 0.65, bot = y + r * 0.7;
          ctx.fillStyle = theme.cyan; ctx.globalAlpha = 0.55; ctx.fillRect(x - r, bot - (bot - top) * Math.max(0, Math.min(1, tf)), 2 * r, (bot - top) * Math.max(0, Math.min(1, tf)) + 1); ctx.restore();
          ctx.globalAlpha = 1; ctx.fillStyle = theme.text; ctx.font = '600 10px IBM Plex Mono, monospace'; ctx.fillText(`${Math.round(tf * 100)}%`, x + r + 3, y + 4);
        } else { ctx.fillStyle = theme.cyan; ctx.globalAlpha = 0.4; ctx.fillRect(x - r, y - r * 0.2 + wave, 2 * r, r * 1.2); ctx.restore(); }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = isS ? theme.accent : theme.cyan; ctx.lineWidth = 2; ctx.stroke();
        if (n.headSchedule) { ctx.strokeStyle = theme.cyan; ctx.lineWidth = 1.4; ctx.beginPath(); for (let k = 0; k <= 12; k++) { const xx = x - r * 0.7 + (k / 12) * r * 1.4, yy = y - r * 0.95 + Math.sin((k / 12) * Math.PI * 2) * 2.5; k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); } ctx.stroke(); }
      } else {
        let pNow = NaN;
        if (live) { const hh = result.nodeHead[n.id]; if (hh) pNow = hh[f0] + (hh[f1] - hh[f0]) * wf - n.elev; }
        if (Number.isFinite(pNow) && (pNow < net.settings.minPressure || pNow > (geo.nodeClass.get(n.id) ?? 100))) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 160);
          ctx.beginPath(); ctx.arc(x, y, (many ? 4 : 6) + 3 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = pNow < net.settings.minPressure ? 'rgba(220,38,38,0.3)' : 'rgba(168,85,247,0.3)'; ctx.fill();
        }
        if (!many || isS || n.vessel || n.airValve || geo.typical * s > 30) {
          const r = isS ? 5.5 : net.nodes.length > 80 ? 2.6 : 4;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = Number.isFinite(pNow) && md === 'pressure' ? pressureColor(pNow) : theme.panel; ctx.fill();
          ctx.strokeStyle = isS ? theme.accent : theme.text; ctx.lineWidth = isS ? 2.4 : 1.3; ctx.stroke();
          if ((n.demand ?? 0) > 0 && !many) { ctx.strokeStyle = theme.muted; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + 9, y + 9); ctx.moveTo(x + 9, y + 5); ctx.lineTo(x + 9, y + 9); ctx.lineTo(x + 5, y + 9); ctx.stroke(); }
        }
      }
      if (n.vessel) {
        const vw = 13, vh = 25;
        ctx.strokeStyle = theme.accent; ctx.lineWidth = 1.7;
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y - 8); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(x - vw / 2, y - 8 - vh, vw, vh, 6.5); ctx.fillStyle = theme.panel; ctx.fill(); ctx.stroke();
        const vr = result?.vessels[n.id];
        const water = vr ? 1 - (vr.gas[f0] + (vr.gas[f1] - vr.gas[f0]) * wf) / vr.volume : 1 - n.vessel.gasVolume / n.vessel.volume;
        ctx.save(); ctx.beginPath(); ctx.roundRect(x - vw / 2 + 1.5, y - 8 - vh + 1.5, vw - 3, vh - 3, 5); ctx.clip();
        ctx.fillStyle = theme.cyan; ctx.globalAlpha = 0.75; ctx.fillRect(x - vw / 2, y - 8 - (vh - 3) * Math.max(0, Math.min(1, water)) - 1.5, vw, vh); ctx.restore();
        if (n.vessel.bladder) { ctx.strokeStyle = theme.accent; ctx.lineWidth = 1; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x - vw / 2 + 2, y - 8 - vh * 0.55); ctx.lineTo(x + vw / 2 - 2, y - 8 - vh * 0.55); ctx.stroke(); ctx.setLineDash([]); }
      }
      if (n.airValve) {
        const av = result?.airValves[n.id];
        const air = av ? av.air[f0] : 0;
        const off = !!n.airValve.treatAsJunction;
        ctx.save();
        if (off) { ctx.globalAlpha = 0.45; ctx.setLineDash([2, 2]); }
        const dxv = n.vessel ? 14 : 0;
        ctx.strokeStyle = off ? theme.faint : theme.warn; ctx.lineWidth = 1.6;
        if (dxv) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dxv, y - 6); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(x + dxv, y - 6); ctx.lineTo(x + dxv + 6.5, y - 18); ctx.lineTo(x + dxv - 6.5, y - 18); ctx.closePath();
        ctx.fillStyle = air > 1e-4 && live ? theme.warn : theme.panel; ctx.fill(); ctx.stroke();
        if (n.airValve.type === 'threeStage') { ctx.beginPath(); ctx.moveTo(x + dxv - 4, y - 14); ctx.lineTo(x + dxv + 4, y - 14); ctx.stroke(); }
        ctx.restore();
        if (air > 1e-4 && live) { ctx.beginPath(); ctx.arc(x + dxv, y - 22, 2 + 2 * Math.abs(Math.sin(now / 200)), 0, Math.PI * 2); ctx.strokeStyle = theme.warn; ctx.stroke(); }
      }
      if (n.tank) {
        const tk = result?.tanks[n.id];
        const tw = 14, th = 25, bx = x + 9, by = y - 8 - th;
        const span = n.tank.topElev - n.tank.bottomElev || 1;
        const lvl = tk ? tk.level[f0] + (tk.level[f1] - tk.level[f0]) * wf : (n.tank.oneWay ? n.tank.initialLevel ?? n.tank.bottomElev + 0.9 * span : n.tank.topElev - 0.3 * span);
        const frac = Math.max(0, Math.min(1, (lvl - n.tank.bottomElev) / span));
        ctx.strokeStyle = theme.cyan; ctx.lineWidth = 1.7;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx + tw / 2, y); ctx.lineTo(bx + tw / 2, by + th); ctx.stroke();
        ctx.fillStyle = theme.cyan; ctx.globalAlpha = 0.6; ctx.fillRect(bx, by + th * (1 - frac), tw, th * frac); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by + th); ctx.lineTo(bx + tw, by + th); ctx.lineTo(bx + tw, by); ctx.stroke();
        if (n.tank.oneWay) { ctx.fillStyle = theme.cyan; ctx.beginPath(); ctx.moveTo(bx + tw / 2 - 4, y - 3); ctx.lineTo(bx + tw / 2 + 4, y - 3); ctx.lineTo(bx + tw / 2, y + 3); ctx.closePath(); ctx.fill(); }
      }
      for (const [dev, flowArr, dx] of [[n.sav, result?.savs[n.id]?.flow, -18], [n.relief, result?.reliefs[n.id]?.flow, n.sav ? -34 : -18]] as const) {
        if (!dev) continue;
        const flowing = !!flowArr && flowArr[f0] > 1e-5 && live;
        const vx = x + dx, vy = y - 12;
        ctx.strokeStyle = dev === n.relief ? theme.bad : theme.accent; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(vx, vy + 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(vx - 5, vy - 4); ctx.lineTo(vx + 5, vy + 4); ctx.lineTo(vx + 5, vy - 4); ctx.lineTo(vx - 5, vy + 4); ctx.closePath();
        ctx.fillStyle = flowing ? (dev === n.relief ? theme.bad : theme.accent) : theme.panel; ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(vx, vy - 5); ctx.lineTo(vx, vy - 12); ctx.moveTo(vx - 3, vy - 9); ctx.lineTo(vx, vy - 12); ctx.lineTo(vx + 3, vy - 9); ctx.stroke();
      }
      if (n.outlet) {
        const o = result?.outlets?.[n.id];
        const flowing = !!o && live && o.flow[f0] > 1e-5;
        const ox2 = x + 10, oy2 = y + 6;
        ctx.strokeStyle = n.outlet.trigger === 'pressure' ? theme.bad : theme.cyan; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ox2, oy2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ox2 - 4, oy2); ctx.lineTo(ox2 + 4, oy2); ctx.lineTo(ox2 + 2, oy2 + 6); ctx.lineTo(ox2 - 2, oy2 + 6); ctx.closePath();
        ctx.fillStyle = flowing ? ctx.strokeStyle : theme.panel; ctx.fill(); ctx.stroke();
        if (n.outlet.trigger === 'pressure' && !flowing) { ctx.beginPath(); ctx.moveTo(ox2 - 4, oy2 + 3); ctx.lineTo(ox2 + 4, oy2 + 3); ctx.stroke(); }
        if (flowing) for (let k = 0; k < 3; k++) { const u = ((now / 400) + k / 3) % 1; ctx.beginPath(); ctx.arc(ox2 + (k - 1) * 2, oy2 + 8 + u * 8, 1.2, 0, Math.PI * 2); ctx.fillStyle = theme.cyan; ctx.globalAlpha = 1 - u; ctx.fill(); ctx.globalAlpha = 1; }
      }
    }

    // labels: ids and values, on a soft background so they stay readable over pipes
    ctx.font = '11px IBM Plex Sans, system-ui';
    const pill = (text: string, x: number, y: number, col: string, bold = false) => {
      ctx.font = `${bold ? 600 : 400} 11px IBM Plex Sans, system-ui`;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = theme.dark ? 'rgba(12,26,44,0.78)' : 'rgba(255,255,255,0.82)';
      ctx.fillRect(x - 2, y - 10, tw + 4, 13);
      ctx.fillStyle = col; ctx.fillText(text, x, y);
    };
    const nodeVal = (n: NetNode): string | null => {
      const v = opt.values;
      if (v === 'elevation') return fmtQ(n.elev, 'elevation', 1, units);
      if (v === 'demand' && n.kind === 'junction') return (n.demand ?? 0) ? fmtQ(n.demand, 'flow', 1, units) : null;
      if (!result || n.kind === 'reservoir') return n.kind === 'reservoir' && v === 'steadyPressure' ? fmtQ(n.head, 'head', 1, units) : null;
      if (v === 'steadyPressure') return fmtQ((result.steady.heads[n.id] ?? NaN) - n.elev, 'pressureHead', 1, units);
      if (v === 'maxPressure') return fmtQ(result.nodeMax[n.id] - n.elev, 'pressureHead', 1, units);
      if (v === 'minPressure') return fmtQ(result.nodeMin[n.id] - n.elev, 'pressureHead', 1, units);
      return null;
    };
    const pipeVal = (id: string): string | null => {
      const p = net.pipes.find((x) => x.id === id)!;
      const v = opt.values;
      if (v === 'diameter') return fmtQ(p.diameter, 'diameter', 0, units);
      if (v === 'length') return fmtQ(p.length, 'length', 0, units);
      if (v === 'flow' && result) return fmtQ(result.steady.flows[id], 'flow', 1, units);
      if (v === 'velocity' && result) return fmtQ(Math.abs(result.steady.flows[id] ?? 0) / area(p.diameter), 'velocity', 2, units);
      return null;
    };
    const showVals = opt.values !== 'none' && (net.nodes.length < 250 || geo.typical * s > 60);
    if (showIds || showVals) {
      for (const n of net.nodes) {
        const p = geo.pos.get(n.id)!;
        const x = X(p.x), y = Y(p.y);
        if (x < -40 || x > w + 40 || y < -40 || y > h + 40) continue;
        const dev = n.kind === 'reservoir' ? 14 : 7;
        if (showIds || sel('node', n.id)) pill(n.label ? `${n.id} · ${n.label}` : n.id, x + dev, y + 15, sel('node', n.id) ? theme.accent : theme.muted, sel('node', n.id));
        const val = showVals ? nodeVal(n) : null;
        if (val) pill(val, x + dev, y + 28, theme.cyan);
      }
      for (const p of geo.pipes) {
        const ids = showIds && net.pipes.length < 150;
        const val = showVals ? pipeVal(p.id) : null;
        if (!ids && !val && !sel('pipe', p.id)) continue;
        const sp = SP.get(p.id)!;
        const [mx, my] = at(p, sp, 0.5);
        if (mx < -40 || mx > w + 40 || my < -40 || my > h + 40) continue;
        const txt = [ids || sel('pipe', p.id) ? p.id : null, val].filter(Boolean).join(' · ');
        if (txt) pill(txt, mx + 6, my - 6, sel('pipe', p.id) ? theme.accent : theme.faint, sel('pipe', p.id));
      }
      if (showIds) {
        for (const pu of net.pumps) { const a = geo.pos.get(pu.from), b = geo.pos.get(pu.to); if (a && b && pumpGroups.find((g) => g.ids[0] === pu.id)) pill(pu.id, (X(a.x) + X(b.x)) / 2 - 10, (Y(a.y) + Y(b.y)) / 2 + r0 + 14, theme.muted); }
        for (const v of net.valves) { const a = geo.pos.get(v.from), b = geo.pos.get(v.to); if (a && b) pill(v.id, (X(a.x) + X(b.x)) / 2 - 10, (Y(a.y) + Y(b.y)) / 2 + r0 + 12, theme.muted); }
      }
    }

    // slams
    if (result && live && result.slams?.length) {
      ctx.font = '600 11px IBM Plex Sans, system-ui';
      for (const sl of result.slams) {
        const age = tNow - sl.t;
        if (age < 0 || age > 1.2 || sl.joukowsky < 0.5) continue;
        const pp = geo.pos.get(sl.node) ?? geo.pos.get(net.pipes.find((q) => q.id === sl.id)?.from ?? '') ?? (() => { const pu = net.pumps.find((q) => q.id === sl.id); return pu ? geo.pos.get(pu.to) : undefined; })();
        if (!pp) continue;
        const x = X(pp.x), y = Y(pp.y), u = age / 1.2;
        for (let k = 0; k < 2; k++) {
          const uu = Math.min(1, u * 1.6 + k * 0.25);
          ctx.beginPath(); ctx.arc(x, y, 6 + uu * 34, 0, Math.PI * 2);
          ctx.strokeStyle = theme.bad; ctx.globalAlpha = (1 - uu) * 0.9; ctx.lineWidth = 3 - k; ctx.stroke();
        }
        ctx.globalAlpha = Math.max(0, 1 - u);
        const label = `${sl.kind === 'airValve' ? 'Air-valve' : 'Check-valve'} slam +${toShow(sl.joukowsky, 'head', units).toFixed(0)} ${uLabel('head', units)}`;
        const tw2 = ctx.measureText(label).width + 10;
        ctx.fillStyle = theme.bad; ctx.beginPath(); ctx.roundRect(x + 14, y - 34, tw2, 18, 4); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(label, x + 19, y - 21);
        ctx.globalAlpha = 1;
      }
    }
    // operation pulses: rings spread from each operated pump or valve when its operation starts
    if (result && live) {
      for (const ev of [net.event, ...(net.extraEvents ?? [])]) {
        if (!ev || ev.kind === 'none') continue;
        const dtE = tNow - ev.start;
        if (dtE < 0 || dtE >= 2.5) continue;
        const id = ev.targets[0];
        const el = net.pumps.find((q) => q.id === id) ?? net.valves.find((q) => q.id === id);
        if (!el) continue;
        const a = geo.pos.get(el.from), b = geo.pos.get(el.to);
        if (!a || !b) continue;
        const qx = (X(a.x) + X(b.x)) / 2, qy = (Y(a.y) + Y(b.y)) / 2;
        for (let k = 0; k < 3; k++) {
          const u = (dtE * 1.2 + k / 3) % 1;
          ctx.beginPath(); ctx.arc(qx, qy, r0 + u * 46, 0, Math.PI * 2);
          ctx.strokeStyle = theme.accent; ctx.globalAlpha = (1 - u) * Math.max(0, 1 - dtE / 2.5); ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // ── tool overlays: rubber band, snap marker, selection box ──
    const cur = cursor.current;
    if (dr && cur) {
      const from = (dr.kind === 'pipe' || dr.kind === 'link') && dr.from ? geo.pos.get(dr.from) : null;
      if (from) {
        ctx.setLineDash([6, 4]); ctx.strokeStyle = theme.accent; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(X(from.x), Y(from.y));
        if (dr.kind === 'pipe') for (const v of dr.verts) ctx.lineTo(X(v.x), Y(-v.y));
        const cw = snapW(toWorld(cur.x, cur.y));
        ctx.lineTo(X(cw.x), Y(-cw.y)); ctx.stroke(); ctx.setLineDash([]);
        if (dr.kind === 'pipe') for (const v of dr.verts) { ctx.fillStyle = theme.accent; ctx.fillRect(X(v.x) - 3, Y(-v.y) - 3, 6, 6); }
        // length readout
        let Lp = 0, last = { x: from.x, y: -from.y };
        for (const v of dr.kind === 'pipe' ? dr.verts : []) { Lp += Math.hypot(v.x - last.x, v.y - last.y); last = v; }
        Lp += Math.hypot(cw.x - last.x, cw.y - last.y);
        pill(fmtQ(Lp, 'length', 1, units), cur.x + 14, cur.y + 24, theme.accent, true);
      }
    }
    if (cur && props.current.tool !== 'select' && props.current.tool !== 'pan') {
      const cw = snapW(toWorld(cur.x, cur.y));
      const sx = X(cw.x), sy = Y(-cw.y);
      ctx.strokeStyle = theme.accent; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx - 7, sy); ctx.lineTo(sx + 7, sy); ctx.moveTo(sx, sy - 7); ctx.lineTo(sx, sy + 7); ctx.stroke();
    }
    const bx = box.current;
    if (bx) {
      ctx.fillStyle = theme.dark ? 'rgba(255,122,26,0.08)' : 'rgba(224,98,12,0.07)'; ctx.strokeStyle = theme.accent; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      const x0 = Math.min(bx.x0, bx.x1), y0 = Math.min(bx.y0, bx.y1);
      ctx.fillRect(x0, y0, Math.abs(bx.x1 - bx.x0), Math.abs(bx.y1 - bx.y0)); ctx.strokeRect(x0, y0, Math.abs(bx.x1 - bx.x0), Math.abs(bx.y1 - bx.y0)); ctx.setLineDash([]);
    }

    // ── scale bar and north arrow ──
    {
      const targetPx = 110, uf = toShow(1, 'length', units), ul = uLabel('length', units);
      const worldPerPx = 1 / s;
      const raw = targetPx * worldPerPx * uf;
      const p10 = 10 ** Math.floor(Math.log10(raw));
      const nice = [1, 2, 5, 10].map((m) => m * p10).find((v) => v >= raw * 0.6) ?? raw;
      const px = (nice / uf) * s;
      const x0 = 16, y0 = h - 18 - bottomInset;
      ctx.fillStyle = theme.dark ? 'rgba(12,26,44,0.7)' : 'rgba(255,255,255,0.8)'; ctx.fillRect(x0 - 6, y0 - 20, px + 60, 28);
      ctx.strokeStyle = theme.text; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + px, y0); ctx.lineTo(x0 + px, y0 - 5); ctx.moveTo(x0 + px / 2, y0 - 3); ctx.lineTo(x0 + px / 2, y0); ctx.stroke();
      ctx.fillStyle = theme.text; ctx.font = '600 10.5px IBM Plex Mono, monospace'; ctx.fillText(`${nice.toLocaleString()} ${ul}`, x0 + px + 6, y0 + 1);
      if (opt.north) {
        const nx = 30, ny = y0 - 42;
        ctx.fillStyle = theme.text; ctx.beginPath(); ctx.moveTo(nx, ny - 14); ctx.lineTo(nx + 6, ny + 4); ctx.lineTo(nx, ny); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = theme.text; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(nx, ny - 14); ctx.lineTo(nx - 6, ny + 4); ctx.lineTo(nx, ny); ctx.stroke();
        ctx.font = '700 10px IBM Plex Sans, system-ui'; ctx.textAlign = 'center'; ctx.fillText('N', nx, ny + 16); ctx.textAlign = 'left';
      }
    }
  }, [theme, size, geo, result, envMap, sScale, lut, pumpGroups, net, editing, colorFn, bottomInset, bgImg, contours, contourBy, tankFill]); // eslint-disable-line react-hooks/exhaustive-deps

  const liveFrame = mode === 'surge' || mode === 'pressure' ? framePos : -1;
  useEffect(() => {
    let raf = 0;
    const continuous = !!result && (mode === 'surge' || mode === 'pressure') && (flowDashes || playing);
    const loop = () => { anim.current.needMore = false; draw(); if (continuous || anim.current.needMore) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, liveFrame, mode, selected, route, flowDashes, playing, result, vo, drawing, tool, probe]);

  // ── hit testing ──
  const pick = (sx: number, sy: number, only?: 'node' | 'pipe'): { ref: ElRef; u?: number; vertex?: number } | null => {
    const { s, ox, oy } = view.current;
    const X = (x: number) => (x - ox) * s, Y = (y: number) => (y - oy) * s;
    let best: { ref: ElRef; u?: number; vertex?: number } | null = null, bd = 12;
    if (only !== 'pipe') for (const n of net.nodes) {
      const p = geo.pos.get(n.id)!;
      const d = Math.hypot(X(p.x) - sx, Y(p.y) - sy) - (n.kind === 'reservoir' ? 7 : 2);
      if (d < bd) { bd = d; best = { ref: { type: 'node', id: n.id } }; }
    }
    if (best || only === 'node') return best;
    bd = 14;
    const mid = (from: string, to: string) => { const a = geo.pos.get(from), b = geo.pos.get(to); return a && b ? { x: (X(a.x) + X(b.x)) / 2, y: (Y(a.y) + Y(b.y)) / 2 } : { x: 1e9, y: 1e9 }; };
    if (!only) {
      for (const p of net.pumps) { const m = mid(p.from, p.to); const d = Math.hypot(m.x - sx, m.y - sy); if (d < bd) { bd = d; best = { ref: { type: 'pump', id: p.id } }; } }
      for (const v of net.valves) { const m = mid(v.from, v.to); const d = Math.hypot(m.x - sx, m.y - sy); if (d < bd) { bd = d; best = { ref: { type: 'valve', id: v.id } }; } }
      if (best) return best;
    }
    // bend handles of selected pipes
    for (const p of geo.pipes) {
      if (!selSet.has(`pipe:${p.id}`)) continue;
      for (let i = 1; i < p.pts.length - 1; i++) if (Math.hypot(X(p.pts[i].x) - sx, Y(p.pts[i].y) - sy) < 7) return { ref: { type: 'pipe', id: p.id }, vertex: i - 1 };
    }
    bd = 8;
    for (const p of geo.pipes) {
      const sp = p.pts.map((q) => ({ x: X(q.x), y: Y(q.y) }));
      const nf = nearestFraction(sp, { x: sx, y: sy });
      if (nf.d < bd) { bd = nf.d; best = { ref: { type: 'pipe', id: p.id }, u: nf.u }; }
    }
    return best;
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  type Drag = { x: number; y: number; ox: number; oy: number; moved: boolean; kind: 'pan' | 'node' | 'vertex' | 'box'; ids?: string[]; pipe?: string; vertex?: number; last?: { x: number; y: number }; additive?: boolean; pinch?: { d: number; s: number; cx: number; cy: number } };
  const drag = useRef<Drag | null>(null);
  const zoomAt = (sx: number, sy: number, k: number) => {
    const v = view.current;
    const wx = v.ox + sx / v.s, wy = v.oy + sy / v.s;
    const s = Math.max(1e-6, Math.min(1e6, v.s * k));
    view.current = { s, ox: wx - sx / s, oy: wy - sy / s };
    userMoved.current = true;
    draw();
  };
  const local = (e: { clientX: number; clientY: number }) => { const r = cvs.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  useEffect(() => {
    const c = cvs.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, e.deltaY > 0 ? 1 / 1.15 : 1.15); };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  });
  // Esc ends drawing; Enter too
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Escape' || e.key === 'Enter') && drawing) { e.preventDefault(); e.stopPropagation(); setDrawing(null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [drawing]);

  // ── tool actions ──
  const clickTool = (sp: { x: number; y: number }, shift: boolean) => {
    const t = tool as ElementKind;
    const info = EL[t];
    if (!info) return;
    const hit = pick(sp.x, sp.y, info.placement === 'device' || info.placement === 'node' ? undefined : undefined);
    const wq = snapW(toWorld(sp.x, sp.y));
    if (info.placement === 'node') {
      if (hit?.ref.type === 'pipe' && hit.u !== undefined && t === 'junction') {
        onEdit((n) => splitPipe(n, hit.ref.id, hit.u!, defaults).net, undefined, 'Split pipe');
        return;
      }
      if (hit?.ref.type === 'node') { onSelect([hit.ref]); return; }
      let id = '';
      onEdit((n) => { const r = addNode(n, wq, t, defaults); id = r.id; return r.net; }, undefined, `Add ${info.name.toLowerCase()}`);
      setTimeout(() => id && onSelect([{ type: 'node', id }]), 0);
      return;
    }
    if (info.placement === 'device') {
      if (hit?.ref.type === 'node') {
        const n0 = net.nodes.find((x) => x.id === hit.ref.id)!;
        if (n0.kind === 'reservoir') return;
        const D = net.pipes.find((p) => p.from === n0.id || p.to === n0.id)?.diameter ?? defaults.pipeDiameter;
        onEdit((n) => ({ ...n, nodes: n.nodes.map((x) => (x.id === n0.id ? { ...x, ...deviceDefaults(t, x, D) } : x)) }), [hit.ref], `Add ${info.name.toLowerCase()}`);
        return;
      }
      if (hit?.ref.type === 'pipe' && hit.u !== undefined) {
        let r: ElRef | null = null;
        onEdit((n) => { const o = insertOnPipe(n, hit.ref.id, t, hit.u!, defaults); r = { type: o.type, id: o.id }; return o.net; }, undefined, `Insert ${info.name.toLowerCase()}`);
        setTimeout(() => r && onSelect([r]), 0);
        return;
      }
      let id = '';
      onEdit((n) => { const r = addNode(n, wq, t, defaults); id = r.id; return r.net; }, undefined, `Add ${info.name.toLowerCase()}`);
      setTimeout(() => id && onSelect([{ type: 'node', id }]), 0);
      return;
    }
    // links
    if (t === 'pipe') {
      const d = drawing?.kind === 'pipe' ? drawing : { kind: 'pipe' as const, from: null, verts: [] };
      if (shift && d.from) { setDrawing({ ...d, verts: [...d.verts, wq] }); return; }
      let endId: string | null = null;
      let pre: (n: Network) => Network = (n) => n;
      if (hit?.ref.type === 'node') endId = hit.ref.id;
      else if (hit?.ref.type === 'pipe' && hit.u !== undefined) {
        // end on an existing pipe: split it and connect there
        const sp2 = splitPipe(net, hit.ref.id, hit.u, defaults);
        endId = sp2.node;
        pre = (n) => splitPipe(n, hit.ref.id, hit.u!, defaults).net;
      } else {
        const r = addNode(net, wq, 'junction', defaults);
        endId = r.id;
        pre = (n) => addNode(n, wq, 'junction', defaults).net;
      }
      if (!d.from) {
        if (pre !== undefined && !(hit?.ref.type === 'node')) onEdit(pre, [{ type: 'node', id: endId! }], 'Add junction');
        setDrawing({ kind: 'pipe', from: endId, verts: [] });
        return;
      }
      if (endId === d.from) return;
      const from = d.from, verts = d.verts;
      let pid = '';
      onEdit((n) => { const n1 = pre(n); const r = addPipe(n1, from, endId!, verts, defaults); pid = r.id; return r.net; }, undefined, 'Draw pipe');
      setTimeout(() => pid && onSelect([{ type: 'pipe', id: pid }]), 0);
      setDrawing({ kind: 'pipe', from: endId, verts: [] });
      return;
    }
    // pump / valves: on a pipe → insert; else node to node
    if (hit?.ref.type === 'pipe' && hit.u !== undefined && !(drawing?.kind === 'link' && drawing.from)) {
      if (t === 'nrv') {
        onEdit((n) => ({ ...n, pipes: n.pipes.map((p) => (p.id === hit.ref.id ? { ...p, checkValve: p.checkValve ?? { mode: 'ideal', kOpen: 1 } } : p)) }), [hit.ref], 'Add non-return valve');
        return;
      }
      let r: ElRef | null = null;
      onEdit((n) => { const o = insertOnPipe(n, hit.ref.id, t, hit.u!, defaults); r = { type: o.type, id: o.id }; return o.net; }, undefined, `Insert ${info.name.toLowerCase()}`);
      setTimeout(() => r && onSelect([r]), 0);
      return;
    }
    if (hit?.ref.type === 'node') {
      const d = drawing?.kind === 'link' ? drawing : { kind: 'link' as const, from: null };
      if (!d.from) { setDrawing({ kind: 'link', from: hit.ref.id }); return; }
      if (d.from === hit.ref.id) return;
      const from = d.from;
      let r: ElRef | null = null;
      onEdit((n) => { const o = addLink(n, t, from, hit.ref.id, defaults); r = { type: t === 'pump' ? 'pump' : 'valve', id: o.id }; return o.net; }, undefined, `Add ${info.name.toLowerCase()}`);
      setTimeout(() => r && onSelect([r]), 0);
      setDrawing(null);
    }
  };

  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const u = getUnits();
    const f = Math.max(0, Math.min((result?.times.length ?? 1) - 1, Math.round(framePos)));
    const { sel } = hover;
    const lines: [string, string][] = [];
    let title = '';
    if (sel.type === 'node') {
      const n = net.nodes.find((x) => x.id === sel.id);
      if (!n) return null;
      const devs = nodeDevices(n).map((k) => EL[k].short);
      title = `${n.kind === 'reservoir' ? (n.headSchedule ? 'Varying-level source' : 'Source') : devs.length ? devs.join(' + ') : 'Junction'} ${n.id}`;
      lines.push(['Elevation', fmtQ(n.elev, 'elevation', 2, u)]);
      if (n.kind === 'reservoir') lines.push(['Water level', fmtQ(n.head ?? n.elev, 'head', 2, u)]);
      else if (n.demand) lines.push(['Demand', fmtQ(n.demand, 'flow', 2, u)]);
      if (result && n.kind !== 'reservoir') {
        const hh = result.nodeHead[n.id];
        if (hh) { lines.push(['Pressure now', fmtQ(hh[f] - n.elev, 'pressureHead', 1, u)]); lines.push(['Steady', fmtQ(hh[0] - n.elev, 'pressureHead', 1, u)]); }
        lines.push(['Max / min', `${fmtQ(result.nodeMax[n.id] - n.elev, 'pressureHead', 1, u)} / ${fmtQ(result.nodeMin[n.id] - n.elev, 'pressureHead', 1, u)}`]);
      }
    } else if (sel.type === 'pipe') {
      const p = net.pipes.find((x) => x.id === sel.id);
      if (!p) return null;
      title = `Pipe ${p.id}`;
      lines.push(['Diameter · length', `${fmtQ(p.diameter, 'diameter', 0, u)} · ${fmtQ(p.length, 'length', 0, u)}`]);
      lines.push(['Wave speed', fmtQ(p.wavespeed, 'wavespeed', 0, u)]);
      const q = result?.frameFlows?.[p.id];
      if (q) lines.push(['Velocity now', fmtQ(q[f] / area(p.diameter), 'velocity', 2, u)]);
      const e = envMap.get(p.id);
      if (e) {
        let mx = -Infinity, mn = Infinity;
        for (let i = 0; i < e.s.length; i++) { mx = Math.max(mx, e.hMax[i] - e.z[i]); mn = Math.min(mn, e.hMin[i] - e.z[i]); }
        lines.push(['Max / min pressure', `${fmtQ(mx, 'pressureHead', 1, u)} / ${fmtQ(mn, 'pressureHead', 1, u)}`]);
      }
    } else if (sel.type === 'pump') {
      title = `Pump ${sel.id}`;
      const ps = result?.pumps[sel.id];
      if (ps) { lines.push(['Speed now', `${(ps.speed[f] * 100).toFixed(0)} %`]); lines.push(['Flow now', fmtQ(ps.flow[f], 'flow', 1, u)]); }
    } else {
      const v = net.valves.find((x) => x.id === sel.id);
      title = `${v ? EL[valveKind(v)].name : 'Valve'} ${sel.id}`;
      const vr = result?.valves[sel.id];
      if (vr) lines.push(['Opening now', `${(vr.opening[f] * 100).toFixed(0)} %`]);
    }
    return { title, lines };
  }, [hover, result, framePos, net, envMap]);

  const cursorStyle = tool === 'pan' || (tool === 'select' && !hover) ? (drag.current?.kind === 'pan' ? 'grabbing' : tool === 'pan' ? 'grab' : 'default') : tool === 'select' ? (editing ? 'move' : 'pointer') : 'crosshair';
  void onToolEnd;
  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={cvs} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: cursorStyle }}
        aria-label="Network drawing. Drag to pan, scroll to zoom, double-click empty space to fit."
        onContextMenu={(e) => {
          e.preventDefault();
          if (drawing) { setDrawing(null); return; }
          const p = local(e);
          const hit = pick(p.x, p.y);
          onContext?.({ x: e.clientX, y: e.clientY, ref: hit?.ref ?? null, world: toWorld(p.x, p.y), u: hit?.u });
        }}
        onPointerDown={(e) => {
          if (e.button === 2) return;
          const p = local(e);
          pointers.current.set(e.pointerId, p);
          (e.target as Element).setPointerCapture?.(e.pointerId);
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            drag.current = { x: p.x, y: p.y, ox: view.current.ox, oy: view.current.oy, moved: true, kind: 'pan', pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.current.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 } };
            return;
          }
          const base = { x: p.x, y: p.y, ox: view.current.ox, oy: view.current.oy, moved: false };
          if (tool === 'select' || e.button === 1) {
            const hit = e.button === 1 ? null : pick(p.x, p.y);
            if (hit?.vertex !== undefined && editing) { drag.current = { ...base, kind: 'vertex', pipe: hit.ref.id, vertex: hit.vertex }; return; }
            if (hit?.ref.type === 'node' && editing) {
              const already = selSet.has(`node:${hit.ref.id}`);
              const ids = already ? selected.filter((r) => r.type === 'node').map((r) => r.id) : [hit.ref.id];
              drag.current = { ...base, kind: 'node', ids, additive: e.shiftKey || e.ctrlKey || e.metaKey, last: toWorld(p.x, p.y) };
              return;
            }
            if (!hit && (e.shiftKey || e.ctrlKey || e.metaKey)) { drag.current = { ...base, kind: 'box', additive: true }; box.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; return; }
            drag.current = { ...base, kind: 'pan', additive: e.shiftKey || e.ctrlKey || e.metaKey };
            return;
          }
          drag.current = { ...base, kind: 'pan' };
        }}
        onPointerMove={(e) => {
          const p = local(e);
          cursor.current = p;
          onCursor?.(toWorld(p.x, p.y));
          const d = drag.current;
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
          if (d?.pinch && pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const k = Math.hypot(a.x - b.x, a.y - b.y) / d.pinch.d;
            const s = d.pinch.s * k;
            const wx = d.ox + d.pinch.cx / d.pinch.s, wy = d.oy + d.pinch.cy / d.pinch.s;
            view.current = { s, ox: wx - d.pinch.cx / s, oy: wy - d.pinch.cy / s };
            draw();
            return;
          }
          if (d) {
            if (Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 3) d.moved = true;
            if (!d.moved) return;
            if (d.kind === 'pan') { userMoved.current = true; view.current = { ...view.current, ox: d.ox - (p.x - d.x) / view.current.s, oy: d.oy - (p.y - d.y) / view.current.s }; draw(); setHover(null); }
            else if (d.kind === 'box') { box.current = { ...box.current!, x1: p.x, y1: p.y }; draw(); }
            else if (d.kind === 'node' || d.kind === 'vertex') {
              // live preview: move in the canvas only; commit on release as one undo step
              const w0 = toWorld(d.x, d.y), w1 = snapW(toWorld(p.x, p.y));
              const s0 = d.kind === 'node' && d.ids?.length === 1 ? (() => { const n0 = netIn.nodes.find((x) => x.id === d.ids![0])!; return { x: w1.x - n0.x, y: w1.y - n0.y }; })() : { x: w1.x - w0.x, y: w1.y - w0.y };
              setPv(d.kind === 'node' ? { kind: 'node', ids: d.ids!, dx: s0.x, dy: s0.y } : { kind: 'vertex', pipe: d.pipe!, vertex: d.vertex!, dx: s0.x, dy: s0.y });
              setHover(null);
            }
            return;
          }
          if (tool !== 'pan') {
            const hit = pick(p.x, p.y);
            setHover(hit ? { x: p.x, y: p.y, sel: hit.ref } : null);
            if (onProbe) { const gp = hit?.ref.type === 'pipe' ? net.pipes.find((q) => q.id === hit.ref.id) : null; onProbe(gp && hit?.u !== undefined ? { pipe: gp.id, s: hit.u * gp.length } : null); }
          }
          if (tool !== 'select' && tool !== 'pan') draw();
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          const d = drag.current;
          if (pointers.current.size === 0) drag.current = null;
          const p = local(e);
          if (!d) return;
          if (d.kind === 'box') {
            const bx = box.current!;
            box.current = null;
            const x0 = Math.min(bx.x0, bx.x1), x1 = Math.max(bx.x0, bx.x1), y0 = Math.min(bx.y0, bx.y1), y1 = Math.max(bx.y0, bx.y1);
            const { s, ox, oy } = view.current;
            const inside = (q: { x: number; y: number }) => { const sx = (q.x - ox) * s, sy = (q.y - oy) * s; return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1; };
            const refs: ElRef[] = net.nodes.filter((n) => inside(geo.pos.get(n.id)!)).map((n) => ({ type: 'node', id: n.id }));
            for (const pp of geo.pipes) if (inside(pp.pts[0]) && inside(pp.pts[pp.pts.length - 1])) refs.push({ type: 'pipe', id: pp.id });
            for (const pu of net.pumps) if (refs.some((r) => r.id === pu.from) && refs.some((r) => r.id === pu.to)) refs.push({ type: 'pump', id: pu.id });
            for (const v of net.valves) if (refs.some((r) => r.id === v.from) && refs.some((r) => r.id === v.to)) refs.push({ type: 'valve', id: v.id });
            onSelect(refs, true);
            draw();
            return;
          }
          if ((d.kind === 'node' || d.kind === 'vertex') && d.moved && pv) {
            const { dx, dy } = pv;
            setPv(null);
            if (d.kind === 'node') onEdit((n) => moveNodes(n, d.ids!, dx, dy), d.ids!.map((id) => ({ type: 'node' as const, id })), 'Move');
            else onEdit((n) => ({ ...n, pipes: n.pipes.map((pp) => (pp.id !== d.pipe || !pp.vertices ? pp : { ...pp, vertices: pp.vertices.map((v, i) => (i === d.vertex ? { x: v.x + dx, y: v.y + dy } : v)) })) }), undefined, 'Move bend');
            return;
          }
          setPv(null);
          if (d.moved) return;
          if (tool === 'select' || tool === 'pan') {
            if (tool === 'pan') return;
            const hit = pick(p.x, p.y);
            onSelect(hit ? [hit.ref] : [], d.additive);
            return;
          }
          clickTool(p, e.shiftKey);
        }}
        onPointerLeave={() => { setHover(null); cursor.current = null; onCursor?.(null); onProbe?.(null); }}
        onDoubleClick={(e) => {
          const p = local(e);
          if (drawing) { setDrawing(null); return; }
          const hit = pick(p.x, p.y);
          if (tool === 'select' && hit?.ref.type === 'pipe' && hit.u !== undefined && hit.vertex === undefined && editing) {
            // add a bend where double-clicked
            const pp = net.pipes.find((x) => x.id === hit.ref.id)!;
            const w = snapW(toWorld(p.x, p.y));
            const pts = pipePath(net, pp);
            const at2 = nearestFraction(pts, w);
            let run = 0, seg = 0;
            const L = pts.slice(1).reduce((s2, q, i) => s2 + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0);
            for (let i = 1; i < pts.length; i++) { const dd = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); if ((run + dd) / L >= at2.u) { seg = i - 1; break; } run += dd; }
            const verts = [...(pp.vertices ?? [])];
            verts.splice(seg, 0, w);
            onEdit((n) => ({ ...n, pipes: n.pipes.map((x) => (x.id === pp.id ? { ...x, vertices: verts } : x)) }), [hit.ref], 'Add bend');
            return;
          }
          if (!hit) { fit(); draw(); }
        }} />
      <div className="zoom-tools">
        <button className="btn small icon" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)} aria-label="Zoom in" title="Zoom in">+</button>
        <button className="btn small icon" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)} aria-label="Zoom out" title="Zoom out">−</button>
        <button className="btn small icon" onClick={() => { fit(); draw(); }} aria-label="Zoom to fit" title="Zoom to fit (double-click empty space)">⤢</button>
      </div>
      {drawing && (
        <div className="tool-hint">
          {drawing.kind === 'pipe' ? (drawing.from ? <>Drawing from <b>{drawing.from}</b>: click a node, a pipe or empty space · <b>Shift+click</b> adds a bend · <b>Esc</b> or right-click to stop</> : 'Click a node or empty space to start the pipe')
            : drawing.from ? <>From <b>{drawing.from}</b>: click the second node</> : 'Click the first node'}
        </div>
      )}
      {!drawing && tool !== 'select' && tool !== 'pan' && EL[tool as ElementKind] && <div className="tool-hint"><b>{EL[tool as ElementKind].name}</b> · {EL[tool as ElementKind].description} <span className="muted">Esc to finish</span></div>}
      {hover && hoverInfo && !drag.current && (
        <div className="card small hovercard" style={{ left: Math.min(hover.x + 14, size.w - 230), top: Math.min(hover.y + 14, size.h - 130) }}>
          <b>{hoverInfo.title}</b>
          {hoverInfo.lines.map(([k, v]) => <div key={k} className="row" style={{ justifyContent: 'space-between', gap: 12 }}><span className="muted">{k}</span><span className="mono">{v}</span></div>)}
        </div>
      )}
    </div>
  );
}
