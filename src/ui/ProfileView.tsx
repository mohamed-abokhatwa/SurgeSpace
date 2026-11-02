import { useMemo } from 'react';
import type { PipeEnvelope, TransientResult } from '../engine/transient';
import { HB, HV, type Network } from '../engine/types';
import { Chart, type Band, type Marker, type Series } from './Chart';
import { findPath } from './util';

export interface ProfileData {
  ch: number[];
  z: number[];
  steady: number[];
  max: number[];
  min: number[];
  uMax?: number[];
  uMin?: number[];
  cls: number[];
  markers: Marker[];
  pieces: { pipe: string; c0: number; L: number; reversed: boolean }[];
}

export function buildProfile(net: Network, r: TransientResult, a: string, b: string, uEnv?: PipeEnvelope[]): ProfileData | null {
  const path = findPath(net, a, b);
  if (!path) return null;
  const out: ProfileData = { ch: [], z: [], steady: [], max: [], min: [], cls: [], markers: [], pieces: [] };
  if (uEnv) { out.uMax = []; out.uMin = []; }
  let c = 0;
  out.markers.push({ x: 0, label: a });
  for (const h of path) {
    if (h.kind === 'pipe') {
      const e = r.envelopes.find((x) => x.id === h.id);
      const ue = uEnv?.find((x) => x.id === h.id);
      const pipe = net.pipes.find((p) => p.id === h.id)!;
      if (!e) continue;
      const n = e.s.length;
      const stride = Math.max(1, Math.floor(n / 400));
      const idxs: number[] = [];
      for (let i = 0; i < n; i += stride) idxs.push(i);
      if (idxs[idxs.length - 1] !== n - 1) idxs.push(n - 1);
      if (h.reversed) idxs.reverse();
      for (const i of idxs) {
        const s = h.reversed ? pipe.length - e.s[i] : e.s[i];
        out.ch.push(c + s);
        out.z.push(e.z[i]);
        out.steady.push(e.hSteady[i]);
        out.max.push(e.hMax[i]);
        out.min.push(e.hMin[i]);
        out.cls.push(e.z[i] + (pipe.pressureClass ?? 100));
        if (ue) { out.uMax!.push(ue.hMax[i]); out.uMin!.push(ue.hMin[i]); }
      }
      out.pieces.push({ pipe: h.id, c0: c, L: pipe.length, reversed: h.reversed });
      c += pipe.length;
    } else {
      out.markers.push({ x: c, label: h.id });
    }
    if (path.length < 30 && h.kind === 'pipe') out.markers.push({ x: c, label: h.to });
  }
  return out;
}

export function ProfileView({ net, result, a, b, framePos, uEnv, showNow }: { net: Network; result: TransientResult; a: string; b: string; framePos: number; uEnv?: PipeEnvelope[]; showNow: boolean }) {
  const prof = useMemo(() => buildProfile(net, result, a, b, uEnv), [net, result, a, b, uEnv]);
  // route samples for the live line: chainage and an index into each pipe's frame data
  const live = useMemo(() => {
    if (!prof) return null;
    const ch: number[] = [], src: { arr: Float32Array; ns: number; k: number }[] = [];
    for (const pc of prof.pieces) {
      const ss = result.frameSamples[pc.pipe], hs = result.frameHeads[pc.pipe];
      if (!ss || !hs) continue;
      const ns = ss.length;
      const ks = [...Array(ns).keys()];
      if (pc.reversed) ks.reverse();
      for (const k of ks) { ch.push(pc.c0 + (pc.reversed ? pc.L - ss[k] : ss[k])); src.push({ arr: hs, ns, k }); }
    }
    const nF = result.times.length;
    // running max / min up to each frame, so the envelope can be seen building up
    const runMax = new Float32Array(nF * ch.length), runMin = new Float32Array(nF * ch.length);
    for (let i = 0; i < ch.length; i++) {
      const { arr, ns, k } = src[i];
      let mx = -Infinity, mn = Infinity;
      for (let f = 0; f < nF; f++) {
        const v = arr[f * ns + k];
        if (v > mx) mx = v;
        if (v < mn) mn = v;
        runMax[f * ch.length + i] = mx;
        runMin[f * ch.length + i] = mn;
      }
    }
    const steady = src.map(({ arr, k }) => arr[k]);
    return { ch, src, runMax, runMin, steady };
  }, [prof, result]);
  const now = useMemo(() => {
    if (!live) return null;
    const nF = result.times.length;
    const f0 = Math.max(0, Math.min(nF - 1, Math.floor(framePos))), f1 = Math.min(nF - 1, f0 + 1), w = framePos - f0;
    const h = live.src.map(({ arr, ns, k }) => arr[f0 * ns + k] + (arr[f1 * ns + k] - arr[f0 * ns + k]) * w);
    const n = live.ch.length;
    return {
      h,
      up: h.map((v, i) => Math.max(v, live.steady[i])),
      dn: h.map((v, i) => Math.min(v, live.steady[i])),
      mx: Array.from(live.runMax.subarray(f0 * n, f0 * n + n)),
      mn: Array.from(live.runMin.subarray(f0 * n, f0 * n + n)),
    };
  }, [live, result, framePos]);
  if (!prof) return <div className="empty">No route between {a} and {b}.</div>;
  const vap = prof.z.map((z) => z - HB + HV);
  const series: Series[] = [
    { name: 'Pipe', color: 'var(--muted)', x: prof.ch, y: prof.z, width: 2, fillBelow: 'color-mix(in srgb, var(--muted) 12%, transparent)' },
    { name: 'Vapour pressure', color: '#dc2626', x: prof.ch, y: vap, dash: '2 3', width: 1 },
    { name: 'Pipe class', color: '#a855f7', x: prof.ch, y: prof.cls, dash: '6 4', width: 1.2, noScale: Math.max(...prof.max) < 0.8 * Math.min(...prof.cls) },
    { name: 'Steady HGL', color: 'var(--good)', x: prof.ch, y: prof.steady, width: 1.6 },
    { name: 'Maximum head', color: '#e11d48', x: prof.ch, y: prof.max, width: showNow ? 1 : 2, dash: showNow ? '3 3' : undefined },
    { name: 'Minimum head', color: '#2563eb', x: prof.ch, y: prof.min, width: showNow ? 1 : 2, dash: showNow ? '3 3' : undefined },
  ];
  const bands: Band[] = [];
  if (prof.uMax && prof.uMin) {
    bands.push({ name: 'Uncertainty (worst case)', color: 'rgba(225,29,72,0.14)', x: prof.ch, lo: prof.max, hi: prof.uMax });
    bands.push({ name: '', color: 'rgba(37,99,235,0.14)', x: prof.ch, lo: prof.uMin, hi: prof.min });
  }
  if (now && live && showNow) {
    bands.push({ name: 'Above steady', color: 'rgba(220,38,38,0.22)', x: live.ch, lo: live.steady, hi: now.up });
    bands.push({ name: 'Below steady', color: 'rgba(37,99,235,0.22)', x: live.ch, lo: now.dn, hi: live.steady });
    series.push({ name: 'Peak so far', color: '#e11d48', x: live.ch, y: now.mx, width: 1.8 });
    series.push({ name: 'Lowest so far', color: '#2563eb', x: live.ch, y: now.mn, width: 1.8 });
    const T = result.times, f0 = Math.min(Math.floor(framePos), T.length - 1), f1 = Math.min(f0 + 1, T.length - 1);
    const t = T[f0] + (T[f1] - T[f0]) * (framePos - f0);
    series.push({ name: `Head at ${t.toFixed(2)} s`, color: 'var(--accent)', x: live.ch, y: now.h, width: 2.4 });
  }
  return <Chart series={series} bands={bands.filter((b) => b.name)} markers={prof.markers} xLabel="Chainage along route (m)" yLabel="Elevation / head (m)" height={250} />;
}
