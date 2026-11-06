// Operations: what happens during the run. Any number of operations, each with its own pumps or valves and
// timing (e.g. trip pump 1 at 1 s, trip pump 2 at 4 s, close the line valve over 30 s from 10 s).
import type { Network, TransientEvent, EventKind } from '../engine/types';
import { PairsField } from './ValveEditors';
import { valveKind, EL } from '../app/elements';

type SetNet = (f: (n: Network) => Network, label?: string) => void;
const num = (s: string) => (s.trim() === '' ? NaN : Number(s));

const KINDS: { kind: EventKind; mode?: 'trip' | 'ramp' | 'start'; label: string; hint: string }[] = [
  { kind: 'pumpTrip', mode: 'trip', label: 'Pump power failure', hint: 'Power is lost; the pump runs down on its inertia.' },
  { kind: 'pumpTrip', mode: 'ramp', label: 'Pump controlled stop', hint: 'A drive (VFD / soft starter) brings the speed down to zero over the ramp time.' },
  { kind: 'pumpTrip', mode: 'start', label: 'Pump start-up', hint: 'Off in the steady state; speed rises to full over the ramp time.' },
  { kind: 'valveClose', label: 'Valve closing', hint: 'Valve moves towards its final stroke, by stroke time and law or by an operating curve.' },
  { kind: 'valveOpen', label: 'Valve opening', hint: 'Valve opens from its steady stroke.' },
];
const keyOf = (e: TransientEvent) => (e.kind === 'pumpTrip' ? `pumpTrip:${e.pumpMode ?? 'trip'}` : e.kind);

function OperationCard({ net, ev, index, onChange, onRemove }: { net: Network; ev: TransientEvent; index: number; onChange: (e: TransientEvent) => void; onRemove?: () => void }) {
  const set = (p: Partial<TransientEvent>) => onChange({ ...ev, ...p });
  const isPump = ev.kind === 'pumpTrip';
  const cands = isPump ? net.pumps.map((p) => ({ id: p.id, sub: 'pump' })) : net.valves.filter((v) => !v.orifice).map((v) => ({ id: v.id, sub: EL[valveKind(v)].short }));
  const k = KINDS.find((x) => `${x.kind}${x.mode ? ':' + x.mode : ''}` === keyOf(ev));
  return (
    <div className="op-card">
      <div className="op-head">
        <span className="op-num">{index + 1}</span>
        <select value={keyOf(ev)} onChange={(e) => {
          const [kind, mode] = e.target.value.split(':') as [EventKind, 'trip' | 'ramp' | 'start' | undefined];
          const pump = kind === 'pumpTrip';
          set({ kind, pumpMode: pump ? mode : undefined, targets: pump === isPump ? ev.targets : pump ? net.pumps.filter((p) => p.on).map((p) => p.id) : net.valves.slice(0, 1).map((v) => v.id), duration: ev.duration ?? 5, curve: pump ? undefined : ev.curve });
        }}>
          {KINDS.map((x) => <option key={x.label} value={`${x.kind}${x.mode ? ':' + x.mode : ''}`}>{x.label}</option>)}
        </select>
        {onRemove && <button className="btn ghost small" onClick={onRemove} aria-label="Remove operation" title="Remove">×</button>}
      </div>
      {k && <p className="hint" style={{ margin: '4px 0 8px' }}>{k.hint}</p>}
      <div className="field"><span>{isPump ? 'Pumps' : 'Valves'}</span></div>
      <div className="chips">
        {cands.map((c) => {
          const on = ev.targets.includes(c.id);
          return <button key={c.id} className={`chip ${on ? 'on' : ''}`} onClick={() => set({ targets: on ? ev.targets.filter((x) => x !== c.id) : [...ev.targets, c.id] })}>{c.id} <em>{c.sub}</em></button>;
        })}
        {!cands.length && <span className="muted small">No {isPump ? 'pumps' : 'valves'} in the model — add one with the drawing tools.</span>}
      </div>
      <div className="grid2" style={{ marginTop: 8 }}>
        <label className="field"><span>Starts at <em className="unit">s</em></span><input type="number" step="0.1" value={ev.start} onChange={(e) => set({ start: num(e.target.value) || 0 })} /></label>
        {isPump && (ev.pumpMode ?? 'trip') !== 'trip' && <label className="field"><span>Ramp time <em className="unit">s</em></span><input type="number" step="0.5" value={ev.duration ?? 5} onChange={(e) => set({ duration: num(e.target.value) || 0 })} /></label>}
        {!isPump && (
          <label className="field"><span>Movement</span>
            <select value={ev.curve ? 'curve' : 'stroke'} onChange={(e) => set({ curve: e.target.value === 'curve' ? [[0, ev.kind === 'valveClose' ? 1 : 0], [(ev.duration ?? 5) / 2, 0.2], [ev.duration ?? 5, ev.finalOpening ?? (ev.kind === 'valveClose' ? 0 : 1)]] : undefined })}>
              <option value="stroke">Stroke time and law</option>
              <option value="curve">Operating curve (time, stroke)</option>
            </select>
          </label>
        )}
        {!isPump && !ev.curve && <label className="field"><span>Stroke time <em className="unit">s</em></span><input type="number" step="0.1" value={ev.duration ?? 5} onChange={(e) => set({ duration: num(e.target.value) || 0 })} /></label>}
        {!isPump && !ev.curve && <label className="field"><span>Final stroke <em className="unit">0–1</em></span><input type="number" step="0.05" min={0} max={1} value={ev.finalOpening ?? (ev.kind === 'valveClose' ? 0 : 1)} onChange={(e) => set({ finalOpening: num(e.target.value) })} /></label>}
        {!isPump && !ev.curve && (
          <label className="field"><span>Stroke law</span>
            <select value={ev.exponent ?? 1} onChange={(e) => set({ exponent: num(e.target.value) })}>
              <option value={0.5}>Fast start (0.5)</option>
              <option value={1}>Linear (1)</option>
              <option value={2}>Slow end (2)</option>
              <option value={3}>Very slow end (3)</option>
            </select>
          </label>
        )}
      </div>
      {!isPump && ev.curve && <PairsField key={ev.curve.length} label="Time from start (s), stroke (0 shut – 1 open)" value={ev.curve} onChange={(c) => set({ curve: c.length >= 2 ? c : ev.curve })} rows={6} />}
    </div>
  );
}

export function OperationsPanel({ net, setNet }: { net: Network; setNet: SetNet }) {
  const list: TransientEvent[] = [net.event, ...(net.extraEvents ?? [])];
  const hasMain = net.event.kind !== 'none';
  const write = (evs: TransientEvent[]) => setNet((n) => {
    const real = evs.filter((e) => e.kind !== 'none');
    return { ...n, event: real[0] ?? { kind: 'none', targets: [], start: 1 }, extraEvents: real.slice(1) };
  }, 'Edit operations');
  const shown = hasMain ? list : list.slice(1);
  const add = (kind: EventKind) => write([...shown, kind === 'pumpTrip'
    ? { kind, pumpMode: 'trip', targets: net.pumps.filter((p) => p.on).map((p) => p.id).slice(0, 1), start: 1 }
    : { kind, targets: net.valves.filter((v) => !v.orifice).slice(0, 1).map((v) => v.id), start: 1, duration: 10, exponent: 1, finalOpening: kind === 'valveClose' ? 0 : 1 }]);
  // timeline sketch
  const T = Math.max(net.settings.duration, 1);
  return (
    <div>
      <p className="hint" style={{ marginTop: 0 }}>Add every pump and valve action of the scenario. Each element follows the first operation that lists it.</p>
      {shown.length === 0 && <div className="empty small" style={{ padding: 16 }}>No operations: the run checks the steady state only.</div>}
      {shown.map((ev, i) => (
        <OperationCard key={i} net={net} ev={ev} index={i} onChange={(e) => write(shown.map((x, k) => (k === i ? e : x)))} onRemove={() => write(shown.filter((_, k) => k !== i))} />
      ))}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <button className="btn small" onClick={() => add('pumpTrip')} disabled={!net.pumps.length}>+ Pump operation</button>
        <button className="btn small" onClick={() => add('valveClose')} disabled={!net.valves.length}>+ Valve operation</button>
      </div>
      {shown.length > 0 && (
        <div className="op-timeline" aria-label="Operations timeline">
          {shown.map((ev, i) => {
            const len = ev.kind === 'pumpTrip' ? ((ev.pumpMode ?? 'trip') === 'trip' ? 0 : ev.duration ?? 0) : ev.curve ? Math.max(...ev.curve.map((c) => c[0])) : ev.duration ?? 0;
            return (
              <div key={i} className="op-row">
                <span className="op-num small">{i + 1}</span>
                <div className="op-track">
                  <div className="op-bar" style={{ left: `${(ev.start / T) * 100}%`, width: `${Math.max(0.8, (len / T) * 100)}%` }} title={`${ev.start} s → ${(ev.start + len).toFixed(1)} s`} />
                </div>
              </div>
            );
          })}
          <div className="op-axis"><span>0 s</span><span>{(T / 2).toFixed(0)} s</span><span>{T} s</span></div>
        </div>
      )}
      <div className="label">Run length</div>
      <div className="grid2">
        <label className="field"><span>Simulation time <em className="unit">s</em></span><input type="number" value={net.settings.duration} onChange={(e) => setNet((n) => ({ ...n, settings: { ...n.settings, duration: Math.max(num(e.target.value) || 1, 0.1) } }))} /></label>
      </div>
    </div>
  );
}
