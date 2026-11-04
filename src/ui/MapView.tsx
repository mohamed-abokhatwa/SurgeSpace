// Network map drawn on a canvas so that networks with thousands of pipes animate smoothly.
// Modes: surge (change from steady: red rise, blue drop — waves are visible as they travel),
// pressure now, and the max / min / steady envelopes. Flow dashes move with the local velocity.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PipeEnvelope, TransientResult } from '../engine/transient';
import { area, type Network } from '../engine/types';
import { fmt, pressureColor } from './util';

export type ColorMode = 'surge' | 'pressure' | 'max' | 'min' | 'steady' | 'plain';
export type Selection = { type: 'node' | 'pipe' | 'pump' | 'valve'; id: string } | null;

interface Theme { text: string; muted: string; faint: string; panel: string; line: string; accent: string; cyan: string; warn: string; bad: string; neutral: string; dark: boolean }

function readTheme(): Theme {
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string) => cs.getPropertyValue(k).trim();
  const dark = cs.colorScheme.includes('dark') || v('--bg').toLowerCase() === '#07111f';
  return { text: v('--text'), muted: v('--muted'), faint: v('--faint'), panel: v('--panel'), line: v('--line-2'), accent: v('--accent'), cyan: v('--cyan'), warn: v('--warn'), bad: v('--bad'), neutral: dark ? '#55657b' : '#9aa7b8', dark };
}

/** Diverging lookup table: −1 (drop, blue) … 0 (neutral) … +1 (rise, red). */
function divergingLut(neutral: string, dark: boolean): string[] {
  const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lo = dark ? hex('#4f9dff') : hex('#1d4ed8');
  const lo2 = dark ? hex('#9cc7ff') : hex('#60a5fa');
  const hi2 = dark ? hex('#ffa38a') : hex('#f87171');
  const hi = dark ? hex('#ff4d4d') : hex('#b91c1c');
  const mid = hex(neutral);
  const out: string[] = [];
  for (let k = 0; k <= 256; k++) {
    const t = k / 128 - 1;
    const a = Math.abs(t);
    const [c0, c1, w] = a < 0.45 ? [mid, t < 0 ? lo2 : hi2, a / 0.45] : [t < 0 ? lo2 : hi2, t < 0 ? lo : hi, (a - 0.45) / 0.55];
    const c = c0.map((v, i) => Math.round(v + (c1[i] - v) * w));
    out.push(`rgb(${c[0]},${c[1]},${c[2]})`);
  }
  return out;
}

export function surgeScale(result: TransientResult): number {
  let s = 0;
  for (const id in result.frameHeads) {
    const hs = result.frameHeads[id];
    const ns = result.frameSamples[id].length;
    const nf = hs.length / ns;
    for (let f = 1; f < nf; f++) for (let k = 0; k < ns; k++) s = Math.max(s, Math.abs(hs[f * ns + k] - hs[k]));
  }
  return s || 1;
}

interface Geo {
  pos: Map<string, { x: number; y: number }>;
  pipes: { id: string; ax: number; ay: number; bx: number; by: number; L: number; w: number; area: number; closed: boolean; cls: number; zA: number; zB: number }[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  typical: number; // median pipe length on the map
  nodeClass: Map<string, number>; // highest pressure class of the pipes at each node
}

export function MapView({
  net, result, envelopes, framePos, mode, selection, onSelect, route, flowDashes, playing, sScale = 1,
}: {
  net: Network;
  result: TransientResult | null;
  envelopes?: PipeEnvelope[];
  framePos: number;
  mode: ColorMode;
  selection: Selection;
  onSelect: (s: Selection) => void;
  route: Set<string>;
  flowDashes: boolean;
  playing: boolean;
  /** Largest |H − H steady| in the run (sets the surge colour scale). */
  sScale?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400, dpr: 1 });
  const [theme, setTheme] = useState<Theme | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; sel: NonNullable<Selection> } | null>(null);

  // theme follows the page (data-theme attribute or system setting)
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

  const geo: Geo = useMemo(() => {
    const pos = new Map(net.nodes.map((n) => [n.id, { x: n.x, y: -n.y }]));
    const elev = new Map(net.nodes.map((n) => [n.id, n.elev]));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pos.values()) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
    if (!Number.isFinite(x0)) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
    const pipes = net.pipes.flatMap((p) => {
      const a = pos.get(p.from), b = pos.get(p.to);
      if (!a || !b) return [];
      return [{ id: p.id, ax: a.x, ay: a.y, bx: b.x, by: b.y, L: p.length, w: Math.max(0.7, Math.min(2, p.diameter / 0.35)), area: area(p.diameter), closed: !!p.closed, cls: p.pressureClass ?? 100, zA: elev.get(p.from) ?? 0, zB: elev.get(p.to) ?? 0 }];
    });
    const lens = pipes.map((p) => Math.hypot(p.bx - p.ax, p.by - p.ay)).filter((v) => v > 0).sort((a, b) => a - b);
    const nodeClass = new Map<string, number>();
    for (const p of net.pipes) for (const id of [p.from, p.to]) nodeClass.set(id, Math.max(nodeClass.get(id) ?? 0, p.pressureClass ?? 100));
    return { pos, pipes, bounds: { x0, y0, x1, y1 }, typical: lens[lens.length >> 1] || 1, nodeClass };
  }, [net.nodes, net.pipes]);

  // view: screen = (world − origin) · scale
  const view = useRef({ ox: 0, oy: 0, s: 1 });
  const fit = useCallback(() => {
    const { x0, y0, x1, y1 } = geo.bounds;
    const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
    const padL = 24, padR = 60, padT = 56, padB = 118;
    const s = Math.min((size.w - padL - padR) / w, (size.h - padT - padB) / h);
    view.current = { s, ox: x0 - (size.w - w * s) / 2 / s + (padL - padR) / 2 / s, oy: y0 - (padT + (size.h - padT - padB - h * s) / 2) / s };
  }, [geo, size.w, size.h]);
  useEffect(() => { fit(); }, [fit]);

  const envMap = useMemo(() => new Map((envelopes ?? result?.envelopes ?? []).map((e) => [e.id, e])), [envelopes, result]);
  const pumpGroups = useMemo(() => {
    const g = new Map<string, string[]>();
    net.pumps.forEach((p) => g.set(`${p.from}>${p.to}`, [...(g.get(`${p.from}>${p.to}`) ?? []), p.id]));
    return [...g.entries()].map(([k, ids]) => ({ from: k.split('>')[0], to: k.split('>')[1], ids }));
  }, [net.pumps]);

  // animation state that should not trigger React renders
  const anim = useRef({ phase: new Map<string, number>(), rotor: new Map<string, number>(), last: performance.now() });
  const props = useRef({ framePos, mode, selection, route, flowDashes, playing });
  props.current = { framePos, mode, selection, route, flowDashes, playing };

  const draw = useCallback(() => {
    const c = cvs.current;
    if (!c || !theme) return;
    const ctx = c.getContext('2d')!;
    const { w, h, dpr } = size;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { s, ox, oy } = view.current;
    const X = (x: number) => (x - ox) * s, Y = (y: number) => (y - oy) * s;
    const { framePos: fp, mode: md, selection: sel, route: rt, flowDashes: dashes } = props.current;
    const now = performance.now();
    const dtReal = Math.min(0.1, (now - anim.current.last) / 1000);
    anim.current.last = now;

    const nF = result ? result.times.length : 0;
    const f0 = Math.max(0, Math.min(nF - 1, Math.floor(fp)));
    const f1 = Math.min(nF - 1, f0 + 1);
    const wf = Math.max(0, Math.min(1, fp - f0));
    const live = !!result && (md === 'surge' || md === 'pressure');
    const tNow = result ? result.times[f0] + (result.times[f1] - result.times[f0]) * wf : 0;
    const baseW = Math.max(2, Math.min(5, (geo.typical * s) / 40));

    // route highlight
    ctx.lineCap = 'round';
    for (const p of geo.pipes) {
      if (!rt.has(p.id)) continue;
      ctx.strokeStyle = theme.accent;
      ctx.globalAlpha = 0.13;
      ctx.lineWidth = baseW * p.w + 7;
      ctx.beginPath(); ctx.moveTo(X(p.ax), Y(p.ay)); ctx.lineTo(X(p.bx), Y(p.by)); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // pipes: pieces are grouped by colour and width so a big network needs only a few hundred strokes
    const groups = new Map<string, { col: string; w: number; path: Path2D }>();
    const seg = (col: string, wpx: number, x1: number, y1: number, x2: number, y2: number) => {
      const wq = Math.round(wpx * 2) / 2;
      const key = col + '|' + wq;
      let g = groups.get(key);
      if (!g) { g = { col, w: wq, path: new Path2D() }; groups.set(key, g); }
      g.path.moveTo(x1, y1); g.path.lineTo(x2, y2);
    };
    const dashGroups = new Map<string, { w: number; d: number; gap: number; off: number; path: Path2D }>();
    for (const p of geo.pipes) {
      const ax = X(p.ax), ay = Y(p.ay), bx = X(p.bx), by = Y(p.by);
      if (Math.max(ax, bx) < -20 || Math.min(ax, bx) > w + 20 || Math.max(ay, by) < -20 || Math.min(ay, by) > h + 20) continue;
      const lw = baseW * p.w;
      const isSel = sel?.type === 'pipe' && sel.id === p.id;
      if (isSel) { ctx.strokeStyle = theme.text; ctx.lineWidth = lw + 5; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); }
      if (p.closed) {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = theme.faint; ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.setLineDash([]);
        continue;
      }
      const screenLen = Math.hypot(bx - ax, by - ay);
      if (!result || md === 'plain') { seg(theme.line, lw, ax, ay, bx, by); continue; }
      const env = envMap.get(p.id);
      const zAt = (u: number) => {
        if (!env) return p.zA + (p.zB - p.zA) * u;
        const sx = u * p.L, xs = env.s, zs = env.z;
        let i = 1;
        while (i < xs.length - 1 && xs[i] < sx) i++;
        const t = (sx - xs[i - 1]) / (xs[i] - xs[i - 1] || 1);
        return zs[i - 1] + (zs[i] - zs[i - 1]) * Math.max(0, Math.min(1, t));
      };
      const dx = bx - ax, dy = by - ay;
      if (live) {
        const ss = result.frameSamples[p.id], hs = result.frameHeads[p.id];
        if (!ss || !hs) continue;
        const ns = ss.length;
        const step = Math.max(1, Math.floor((ns - 1) / Math.max(1, screenLen / 3)));
        let k = 0;
        while (k < ns - 1) {
          const k2 = Math.min(ns - 1, k + step);
          const hA = hs[f0 * ns + k] + (hs[f1 * ns + k] - hs[f0 * ns + k]) * wf;
          const hB = hs[f0 * ns + k2] + (hs[f1 * ns + k2] - hs[f0 * ns + k2]) * wf;
          const u0 = ss[k] / p.L, u1 = ss[k2] / p.L;
          if (md === 'surge') {
            const d = ((hA + hB) / 2 - (hs[k] + hs[k2]) / 2) / sScale;
            const t = Math.sign(d) * Math.min(1, Math.abs(d)) ** 0.75;
            seg(lut[Math.round((t + 1) * 128)], lw + Math.abs(t) * lw * 0.9, ax + dx * u0, ay + dy * u0, ax + dx * u1, ay + dy * u1);
          } else {
            seg(pressureColor(Math.round((hA + hB) / 2 - zAt((u0 + u1) / 2)), p.cls), lw, ax + dx * u0, ay + dy * u0, ax + dx * u1, ay + dy * u1);
          }
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
          const u0 = env.s[i0] / p.L, u1 = env.s[i1] / p.L;
          seg(pressureColor(Math.round(pv), p.cls), lw, ax + dx * u0, ay + dy * u0, ax + dx * u1, ay + dy * u1);
        }
      }
      // flow dashes: move with the local velocity, in the flow direction (grouped by phase)
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
            g.path.moveTo(ax, ay); g.path.lineTo(bx, by);
          }
        }
      }
    }
    // butt caps: pieces of one pipe meet end to end, and round caps would double the painting work
    ctx.lineCap = 'butt';
    for (const g of groups.values()) { ctx.strokeStyle = g.col; ctx.lineWidth = g.w; ctx.stroke(g.path); }
    ctx.lineCap = 'round';
    if (dashGroups.size) {
      ctx.save();
      ctx.strokeStyle = theme.dark ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.9)';
      for (const g of dashGroups.values()) { ctx.setLineDash([g.d, g.gap]); ctx.lineDashOffset = -g.off; ctx.lineWidth = g.w; ctx.stroke(g.path); }
      ctx.restore();
    }

    // pumps (impeller turns with speed during the animation)
    const r0 = Math.max(7, Math.min(14, baseW * 3.2));
    for (const g of pumpGroups) {
      const a = geo.pos.get(g.from), b = geo.pos.get(g.to);
      if (!a || !b) continue;
      const mx = (X(a.x) + X(b.x)) / 2, my = (Y(a.y) + Y(b.y)) / 2;
      const ang = Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x));
      const ps = result?.pumps[g.ids[0]];
      const alpha = ps ? ps.speed[f0] + (ps.speed[f1] - ps.speed[f0]) * wf : 1;
      const rot = (anim.current.rotor.get(g.ids[0]) ?? 0) + (live ? alpha * 9 * dtReal : 0);
      anim.current.rotor.set(g.ids[0], rot);
      const isSel = sel?.type === 'pump' && g.ids.includes(sel.id);
      ctx.strokeStyle = theme.muted; ctx.lineWidth = baseW;
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
      ctx.fillStyle = theme.panel; ctx.strokeStyle = isSel ? theme.accent : theme.text; ctx.lineWidth = isSel ? 2.5 : 1.6;
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

    // valves: bow-tie, the dark wedge grows as the valve closes
    for (const v of net.valves) {
      const a = geo.pos.get(v.from), b = geo.pos.get(v.to);
      if (!a || !b) continue;
      const mx = (X(a.x) + X(b.x)) / 2, my = (Y(a.y) + Y(b.y)) / 2;
      const ang = Math.atan2(Y(b.y) - Y(a.y), X(b.x) - X(a.x));
      const vo = result?.valves[v.id];
      const open = vo ? vo.opening[f0] + (vo.opening[f1] - vo.opening[f0]) * wf : v.opening;
      const r = r0 * 0.85;
      const isSel = sel?.type === 'valve' && sel.id === v.id;
      ctx.strokeStyle = theme.muted; ctx.lineWidth = baseW;
      ctx.beginPath(); ctx.moveTo(X(a.x), Y(a.y)); ctx.lineTo(X(b.x), Y(b.y)); ctx.stroke();
      ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
      ctx.beginPath(); ctx.moveTo(-r, -r * 0.7); ctx.lineTo(r, r * 0.7); ctx.lineTo(r, -r * 0.7); ctx.lineTo(-r, r * 0.7); ctx.closePath();
      ctx.fillStyle = open > 0.01 ? theme.panel : theme.bad; ctx.fill();
      if (open > 0.01 && open < 0.999) { ctx.fillStyle = theme.bad; ctx.globalAlpha = 0.85; ctx.fillRect(-r * 0.12, -r * 0.7 * (1 - open), r * 0.24, r * 1.4 * (1 - open)); ctx.globalAlpha = 1; }
      ctx.strokeStyle = isSel ? theme.accent : theme.text; ctx.lineWidth = isSel ? 2.4 : 1.5; ctx.stroke();
      ctx.restore();
    }

    // nodes
    const many = net.nodes.length > 400;
    const showLabels = net.nodes.length < 70 || geo.typical * s > 70;
    ctx.font = '11px IBM Plex Sans, system-ui';
    for (const n of net.nodes) {
      const p = geo.pos.get(n.id)!;
      const x = X(p.x), y = Y(p.y);
      if (x < -30 || x > w + 30 || y < -40 || y > h + 30) continue;
      const isSel = sel?.type === 'node' && sel.id === n.id;
      if (n.kind === 'reservoir') {
        const r = r0 * 0.95;
        ctx.beginPath(); ctx.moveTo(x - r, y - r * 0.6); ctx.lineTo(x + r, y - r * 0.6); ctx.lineTo(x + r * 0.75, y + r * 0.7); ctx.lineTo(x - r * 0.75, y + r * 0.7); ctx.closePath();
        ctx.fillStyle = theme.panel; ctx.fill();
        ctx.save(); ctx.clip(); ctx.fillStyle = theme.cyan; ctx.globalAlpha = 0.35; ctx.fillRect(x - r, y - r * 0.2 + Math.sin(now / 600) * 1.2, 2 * r, r); ctx.restore();
        ctx.strokeStyle = isSel ? theme.accent : theme.cyan; ctx.lineWidth = 2; ctx.stroke();
      } else {
        let pNow = NaN;
        if (live) { const hh = result.nodeHead[n.id]; if (hh) pNow = hh[f0] + (hh[f1] - hh[f0]) * wf - n.elev; }
        // halo where the pressure is beyond limits right now
        if (Number.isFinite(pNow) && (pNow < net.settings.minPressure || pNow > (geo.nodeClass.get(n.id) ?? 100))) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 160);
          ctx.beginPath(); ctx.arc(x, y, (many ? 4 : 6) + 3 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = pNow < net.settings.minPressure ? 'rgba(220,38,38,0.3)' : 'rgba(168,85,247,0.3)'; ctx.fill();
        }
        if (!many || isSel || n.vessel || n.airValve || geo.typical * s > 30) {
          const r = isSel ? 6 : net.nodes.length > 60 ? 2.4 : 4;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = Number.isFinite(pNow) && md === 'pressure' ? pressureColor(pNow) : theme.panel; ctx.fill();
          ctx.strokeStyle = isSel ? theme.accent : theme.text; ctx.lineWidth = isSel ? 2.4 : 1.2; ctx.stroke();
        }
      }
      if (n.vessel) {
        const vw = 12, vh = 24;
        ctx.strokeStyle = theme.accent; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y - 8); ctx.stroke();
        ctx.beginPath(); ctx.roundRect(x - vw / 2, y - 8 - vh, vw, vh, 6); ctx.fillStyle = theme.panel; ctx.fill(); ctx.stroke();
        const vr = result?.vessels[n.id];
        const water = vr ? 1 - (vr.gas[f0] + (vr.gas[f1] - vr.gas[f0]) * wf) / vr.volume : 1 - n.vessel.gasVolume / n.vessel.volume;
        ctx.save(); ctx.beginPath(); ctx.roundRect(x - vw / 2 + 1.5, y - 8 - vh + 1.5, vw - 3, vh - 3, 4.5); ctx.clip();
        ctx.fillStyle = theme.cyan; ctx.globalAlpha = 0.75; ctx.fillRect(x - vw / 2, y - 8 - (vh - 3) * Math.max(0, Math.min(1, water)) - 1.5, vw, vh); ctx.restore();
      }
      if (n.airValve) {
        const av = result?.airValves[n.id];
        const air = av ? av.air[f0] : 0;
        const off = !!n.airValve.treatAsJunction;
        ctx.save();
        if (off) { ctx.globalAlpha = 0.45; ctx.setLineDash([2, 2]); }
        ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y - 17); ctx.lineTo(x - 6, y - 17); ctx.closePath();
        ctx.fillStyle = air > 1e-4 && live ? theme.warn : theme.panel; ctx.fill();
        ctx.strokeStyle = off ? theme.faint : theme.warn; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.restore();
        if (air > 1e-4 && live) { ctx.beginPath(); ctx.arc(x, y - 21, 2 + 2 * Math.abs(Math.sin(now / 200)), 0, Math.PI * 2); ctx.strokeStyle = theme.warn; ctx.stroke(); }
      }
      // open surge tank / one-way tank: open-top box with its water level
      if (n.tank) {
        const tk = result?.tanks[n.id];
        const tw = 14, th = 24, bx = x + 8, by = y - 8 - th;
        const span = n.tank.topElev - n.tank.bottomElev || 1;
        const lvl = tk ? tk.level[f0] + (tk.level[f1] - tk.level[f0]) * wf : (n.tank.oneWay ? n.tank.initialLevel ?? n.tank.bottomElev + 0.9 * span : n.tank.topElev - 0.3 * span);
        const frac = Math.max(0, Math.min(1, (lvl - n.tank.bottomElev) / span));
        ctx.strokeStyle = theme.cyan; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx + tw / 2, y); ctx.lineTo(bx + tw / 2, by + th); ctx.stroke();
        ctx.fillStyle = theme.cyan; ctx.globalAlpha = 0.6; ctx.fillRect(bx, by + th * (1 - frac), tw, th * frac); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx, by + th); ctx.lineTo(bx + tw, by + th); ctx.lineTo(bx + tw, by); ctx.stroke();
        if (n.tank.oneWay) { ctx.fillStyle = theme.cyan; ctx.beginPath(); ctx.moveTo(bx + tw / 2 - 4, y - 3); ctx.lineTo(bx + tw / 2 + 4, y - 3); ctx.lineTo(bx + tw / 2, y + 3); ctx.closePath(); ctx.fill(); }
      }
      // surge anticipation valve and relief valve: small valve symbol with a discharge arrow, lit while flowing
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
      if (showLabels || isSel) { ctx.fillStyle = theme.muted; ctx.fillText(n.id, x + 7, y + 14); }
    }

    // event pulse: rings spread from the valve or pump when the event starts
    if (result && live && net.event.kind !== 'none') {
      const dtE = tNow - net.event.start;
      if (dtE >= 0 && dtE < 2.5) {
        const where: { x: number; y: number }[] = [];
        for (const id of net.event.targets) {
          const el = net.pumps.find((q) => q.id === id) ?? net.valves.find((q) => q.id === id);
          if (!el) continue;
          const a = geo.pos.get(el.from), b = geo.pos.get(el.to);
          if (a && b) where.push({ x: (X(a.x) + X(b.x)) / 2, y: (Y(a.y) + Y(b.y)) / 2 });
        }
        for (const q of where.slice(0, 1)) {
          for (let k = 0; k < 3; k++) {
            const u = (dtE * 1.2 + k / 3) % 1;
            ctx.beginPath(); ctx.arc(q.x, q.y, r0 + u * 46, 0, Math.PI * 2);
            ctx.strokeStyle = theme.accent; ctx.globalAlpha = (1 - u) * Math.max(0, 1 - dtE / 2.5); ctx.lineWidth = 2; ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }
      }
    }
  }, [theme, size, geo, result, envMap, sScale, lut, pumpGroups, net.valves, net.nodes, net.event, net.pumps, net.settings.minPressure]);

  // redraw on any change; keep animating while flow dashes or live playback are on.
  // In the envelope modes the picture does not depend on time, so playback does not trigger redraws.
  const liveFrame = mode === 'surge' || mode === 'pressure' ? framePos : -1;
  useEffect(() => {
    let raf = 0;
    const continuous = !!result && (mode === 'surge' || mode === 'pressure') && (flowDashes || playing);
    const loop = () => {
      const t0 = performance.now();
      draw();
      (window as unknown as { __mapDrawMs?: number }).__mapDrawMs = performance.now() - t0;
      if (continuous) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw, liveFrame, mode, selection, route, flowDashes, playing, result]);

  // ── interaction ──────────────────────────────────────────────────────────
  const pick = (sx: number, sy: number): Selection => {
    const { s, ox, oy } = view.current;
    const X = (x: number) => (x - ox) * s, Y = (y: number) => (y - oy) * s;
    let best: Selection = null, bd = 12;
    for (const n of net.nodes) {
      const p = geo.pos.get(n.id)!;
      const d = Math.hypot(X(p.x) - sx, Y(p.y) - sy) - (n.kind === 'reservoir' ? 6 : 2);
      if (d < bd) { bd = d; best = { type: 'node', id: n.id }; }
    }
    if (best) return best;
    bd = 14;
    const mid = (from: string, to: string) => { const a = geo.pos.get(from)!, b = geo.pos.get(to)!; return { x: (X(a.x) + X(b.x)) / 2, y: (Y(a.y) + Y(b.y)) / 2 }; };
    for (const p of net.pumps) { const m = mid(p.from, p.to); const d = Math.hypot(m.x - sx, m.y - sy); if (d < bd) { bd = d; best = { type: 'pump', id: p.id }; } }
    for (const v of net.valves) { const m = mid(v.from, v.to); const d = Math.hypot(m.x - sx, m.y - sy); if (d < bd) { bd = d; best = { type: 'valve', id: v.id }; } }
    if (best) return best;
    bd = 8;
    for (const p of geo.pipes) {
      const ax = X(p.ax), ay = Y(p.ay), bx = X(p.bx), by = Y(p.by);
      const dx = bx - ax, dy = by - ay;
      const L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((sx - ax) * dx + (sy - ay) * dy) / L2));
      const d = Math.hypot(ax + t * dx - sx, ay + t * dy - sy);
      if (d < bd) { bd = d; best = { type: 'pipe', id: p.id }; }
    }
    return best;
  };
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean; pinch?: { d: number; s: number; cx: number; cy: number } } | null>(null);
  const zoomAt = (sx: number, sy: number, k: number) => {
    const v = view.current;
    const wx = v.ox + sx / v.s, wy = v.oy + sy / v.s;
    const s = v.s * k;
    view.current = { s, ox: wx - sx / s, oy: wy - sy / s };
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

  // values for the hover card
  const hoverInfo = useMemo(() => {
    if (!hover) return null;
    const f = Math.max(0, Math.min((result?.times.length ?? 1) - 1, Math.round(framePos)));
    const { sel } = hover;
    const lines: [string, string][] = [];
    let title = '';
    if (sel.type === 'node') {
      const n = net.nodes.find((x) => x.id === sel.id)!;
      title = `${n.kind === 'reservoir' ? 'Reservoir' : 'Node'} ${n.id}`;
      lines.push(['Elevation', `${fmt(n.elev, 1)} m`]);
      if (result && n.kind !== 'reservoir') {
        const hh = result.nodeHead[n.id];
        if (hh) {
          lines.push(['Pressure now', `${fmt(hh[f] - n.elev, 1)} m`]);
          lines.push(['Steady', `${fmt(hh[0] - n.elev, 1)} m`]);
        }
        lines.push(['Max / min', `${fmt(result.nodeMax[n.id] - n.elev, 1)} / ${fmt(result.nodeMin[n.id] - n.elev, 1)} m`]);
      }
    } else if (sel.type === 'pipe') {
      const p = net.pipes.find((x) => x.id === sel.id)!;
      title = `Pipe ${p.id}`;
      lines.push(['DN · length', `${Math.round(p.diameter * 1000)} mm · ${fmt(p.length, 0)} m`]);
      const q = result?.frameFlows?.[p.id];
      if (q) lines.push(['Velocity now', `${fmt(q[f] / area(p.diameter), 2)} m/s`]);
      const e = envMap.get(p.id);
      if (e) {
        let mx = -Infinity, mn = Infinity;
        for (let i = 0; i < e.s.length; i++) { mx = Math.max(mx, e.hMax[i] - e.z[i]); mn = Math.min(mn, e.hMin[i] - e.z[i]); }
        lines.push(['Max / min pressure', `${fmt(mx, 1)} / ${fmt(mn, 1)} m`]);
      }
    } else if (sel.type === 'pump') {
      title = `Pump ${sel.id}`;
      const ps = result?.pumps[sel.id];
      if (ps) { lines.push(['Speed now', `${fmt(ps.speed[f] * 100, 0)} %`]); lines.push(['Flow now', `${fmt(ps.flow[f] * 1000, 1)} L/s`]); }
    } else {
      title = `Valve ${sel.id}`;
      const vo = result?.valves[sel.id];
      if (vo) lines.push(['Opening now', `${fmt(vo.opening[f] * 100, 0)} %`]);
    }
    return { title, lines };
  }, [hover, result, framePos, net, envMap]);

  return (
    <div ref={wrap} style={{ position: 'absolute', inset: 0 }}>
      <canvas ref={cvs} style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: hover ? 'pointer' : drag.current ? 'grabbing' : 'grab' }}
        aria-label="Network map. Drag to pan, scroll or pinch to zoom, double-click to fit."
        onPointerDown={(e) => {
          const p = local(e);
          pointers.current.set(e.pointerId, p);
          (e.target as Element).setPointerCapture?.(e.pointerId);
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            drag.current = { x: p.x, y: p.y, ox: view.current.ox, oy: view.current.oy, moved: true, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.current.s, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 } };
          } else drag.current = { x: p.x, y: p.y, ox: view.current.ox, oy: view.current.oy, moved: false };
        }}
        onPointerMove={(e) => {
          const p = local(e);
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
            if (d.moved) { view.current = { ...view.current, ox: d.ox - (p.x - d.x) / view.current.s, oy: d.oy - (p.y - d.y) / view.current.s }; draw(); setHover(null); }
            return;
          }
          const hit = pick(p.x, p.y);
          setHover(hit ? { x: p.x, y: p.y, sel: hit } : null);
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          const d = drag.current;
          if (pointers.current.size === 0) drag.current = null;
          if (d && !d.moved) onSelect(pick(local(e).x, local(e).y));
        }}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={() => { fit(); draw(); }} />
      <div className="zoom-tools">
        <button className="btn small" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)} aria-label="Zoom in">+</button>
        <button className="btn small" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)} aria-label="Zoom out">−</button>
        <button className="btn small" onClick={() => { fit(); draw(); }} aria-label="Fit network" title="Fit (double-click map)">⤢</button>
      </div>
      {hover && hoverInfo && (
        <div className="card small hovercard" style={{ left: Math.min(hover.x + 14, size.w - 220), top: Math.min(hover.y + 14, size.h - 120) }}>
          <b>{hoverInfo.title}</b>
          {hoverInfo.lines.map(([k, v]) => <div key={k} className="row" style={{ justifyContent: 'space-between', gap: 12 }}><span className="muted">{k}</span><span className="mono">{v}</span></div>)}
        </div>
      )}
    </div>
  );
}
