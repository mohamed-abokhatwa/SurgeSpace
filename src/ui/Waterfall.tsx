// Waterfall view: the pressure along the long section at successive times, stacked in depth (chainage × time ×
// pressure), the classic way to see where and when the surge peaks and how the waves travel and reflect.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { TransientResult } from '../engine/transient';
import type { Network } from '../engine/types';
import { findPath, pressureColor } from './util';
import { unitOf, useUnits } from '../app/units';

export function Waterfall({ net, result, a, b, framePos, height = 300 }: { net: Network; result: TransientResult; a: string; b: string; framePos: number; height?: number }) {
  const units = useUnits();
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(700);
  const [slices, setSlices] = useState(48);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // samples along the route: chainage, elevation, and where to read the head in each frame
  const route = useMemo(() => {
    const path = findPath(net, a, b);
    if (!path) return null;
    const ch: number[] = [], z: number[] = [], src: { arr: Float32Array; ns: number; k: number }[] = [];
    let c = 0;
    for (const h of path) {
      if (h.kind !== 'pipe') continue;
      const pipe = net.pipes.find((p) => p.id === h.id)!, ss = result.frameSamples[h.id], hs = result.frameHeads[h.id], env = result.envelopes.find((e) => e.id === h.id);
      if (!ss || !hs || !env) { c += pipe.length; continue; }
      const ns = ss.length, ks = [...Array(ns).keys()];
      if (h.reversed) ks.reverse();
      for (const k of ks) {
        const s = h.reversed ? pipe.length - ss[k] : ss[k];
        ch.push(c + s);
        const ze = env.z[Math.min(env.z.length - 1, Math.round((ss[k] / pipe.length) * (env.z.length - 1)))];
        z.push(ze);
        src.push({ arr: hs, ns, k });
      }
      c += pipe.length;
    }
    return ch.length > 1 ? { ch, z, src, L: c } : null;
  }, [net, result, a, b]);
  useEffect(() => {
    const c = cvs.current;
    if (!c || !route) return;
    const dpr = window.devicePixelRatio || 1, H = height;
    c.width = Math.round(w * dpr); c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);
    const css = getComputedStyle(document.documentElement);
    const col = (v: string) => css.getPropertyValue(v).trim() || '#888';
    const panel = col('--panel'), muted = col('--muted'), line = col('--line-2'), text = col('--text'), accent = col('--accent');
    const nF = result.times.length, n = route.ch.length;
    const S = Math.max(8, Math.min(slices, nF));
    const frames = Array.from({ length: S }, (_, i) => Math.round((i * (nF - 1)) / (S - 1)));
    // pressure head at every slice
    const P = frames.map((f) => route.src.map(({ arr, ns, k }, i) => arr[f * ns + k] - route.z[i]));
    let lo = Infinity, hi = -Infinity;
    for (const row of P) for (const v of row) { if (v < lo) lo = v; if (v > hi) hi = v; }
    lo = Math.min(lo, 0); hi = Math.max(hi, 1);
    // projection: chainage to the right, time into depth (up and right), pressure up
    const m = { l: 56, r: 30, t: 34, b: 34 };
    const depthX = Math.min(150, w * 0.18), depthY = Math.min(100, H * 0.32);
    const pw = w - m.l - m.r - depthX, ph = H - m.t - m.b - depthY;
    const X = (s: number, ti: number) => m.l + (s / route.L) * pw + (ti / (S - 1)) * depthX;
    const Y = (p: number, ti: number) => m.t + depthY + ph - ((p - lo) / (hi - lo)) * ph - (ti / (S - 1)) * depthY;
    // floor grid
    ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.globalAlpha = 0.6;
    for (let g = 0; g <= 4; g++) { const ti = (g / 4) * (S - 1); ctx.beginPath(); ctx.moveTo(X(0, ti), Y(lo, ti)); ctx.lineTo(X(route.L, ti), Y(lo, ti)); ctx.stroke(); }
    for (let g = 0; g <= 5; g++) { const s = (g / 5) * route.L; ctx.beginPath(); ctx.moveTo(X(s, 0), Y(lo, 0)); ctx.lineTo(X(s, S - 1), Y(lo, S - 1)); ctx.stroke(); }
    ctx.globalAlpha = 1;
    const fNow = Math.max(0, Math.min(nF - 1, framePos));
    const nowSlice = (fNow / (nF - 1)) * (S - 1);
    const step = Math.max(1, Math.floor(n / Math.max(80, pw / 3)));
    // back to front, so nearer slices hide the ones behind
    for (let ti = S - 1; ti >= 0; ti--) {
      const row = P[ti];
      ctx.beginPath();
      ctx.moveTo(X(route.ch[0], ti), Y(lo, ti));
      for (let i = 0; i < n; i += step) ctx.lineTo(X(route.ch[i], ti), Y(row[i], ti));
      ctx.lineTo(X(route.ch[n - 1], ti), Y(row[n - 1], ti));
      ctx.lineTo(X(route.ch[n - 1], ti), Y(lo, ti));
      ctx.closePath();
      ctx.fillStyle = panel; ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
      // the line coloured by pressure, segment by segment
      for (let i = 0; i + step < n; i += step) {
        const j = Math.min(n - 1, i + step);
        ctx.strokeStyle = pressureColor(Math.round((row[i] + row[j]) / 2));
        ctx.lineWidth = Math.abs(ti - nowSlice) < 0.5 ? 2.6 : 1.3;
        ctx.beginPath(); ctx.moveTo(X(route.ch[i], ti), Y(row[i], ti)); ctx.lineTo(X(route.ch[j], ti), Y(row[j], ti)); ctx.stroke();
      }
    }
    // the current moment, from the animation
    if (framePos > 0) {
      const f0 = Math.floor(fNow), f1 = Math.min(nF - 1, f0 + 1), wf = fNow - f0;
      ctx.strokeStyle = accent; ctx.lineWidth = 2.4; ctx.beginPath();
      for (let i = 0; i < n; i += step) { const { arr, ns, k } = route.src[i]; const v = arr[f0 * ns + k] + (arr[f1 * ns + k] - arr[f0 * ns + k]) * wf - route.z[i]; const x = X(route.ch[i], nowSlice), y = Y(v, nowSlice); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    }
    // axes
    const fH = unitOf('pressureHead', units), fL = unitOf('length', units);
    ctx.fillStyle = muted; ctx.font = '11px IBM Plex Sans, system-ui';
    ctx.strokeStyle = line; ctx.beginPath(); ctx.moveTo(m.l, Y(hi, 0)); ctx.lineTo(m.l, Y(lo, 0)); ctx.lineTo(X(route.L, 0), Y(lo, 0)); ctx.stroke();
    for (let g = 0; g <= 4; g++) { const v = lo + ((hi - lo) * g) / 4; ctx.textAlign = 'right'; ctx.fillText(String(Math.round(v * fH.f) || 0), m.l - 6, Y(v, 0) + 4); }
    ctx.textAlign = 'center';
    for (let g = 0; g <= 5; g++) { const s = (g / 5) * route.L; ctx.fillText((s * fL.f).toFixed(0), X(s, 0), Y(lo, 0) + 15); }
    ctx.fillText(`Chainage (${fL.u})`, m.l + pw / 2, H - 4);
    ctx.textAlign = 'left';
    const tEnd = result.times[nF - 1];
    ctx.fillText(`0 s`, X(route.L, 0) + 6, Y(lo, 0) + 4);
    ctx.fillText(`${tEnd.toFixed(0)} s`, X(route.L, S - 1) + 6, Y(lo, S - 1) + 4);
    ctx.save(); ctx.translate(X(route.L, (S - 1) / 2) + 18, Y(lo, (S - 1) / 2)); ctx.rotate(-Math.atan2(depthY, depthX)); ctx.fillText('time →', 0, 0); ctx.restore();
    ctx.save(); ctx.translate(14, m.t + depthY + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = text; ctx.fillText(`Pressure head (${fH.u})`, 0, 0); ctx.restore();
  }, [route, result, w, height, slices, framePos, units]);
  if (!route) return <div className="empty">No route between {a} and {b}.</div>;
  return (
    <div ref={wrap} className="waterfall">
      <canvas ref={cvs} style={{ width: '100%', height, display: 'block' }} aria-label="Pressure along the route over time" />
      <div className="wf-ctl small muted">
        <span>Slices</span>
        <input type="range" min={12} max={120} value={slices} onChange={(e) => setSlices(Number(e.target.value))} aria-label="Number of time slices" />
        <span className="mono">{slices}</span>
        <span>· colour = pressure, highlighted line = the animation time</span>
      </div>
    </div>
  );
}
