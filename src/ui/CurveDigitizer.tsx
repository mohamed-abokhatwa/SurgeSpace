// Read a pump curve off a graph on a page (scanned, image or vector) by hand: two points on each axis with their
// values, then clicks along the curve. Works without AI and on any graph; the points become pump curve items with
// their place on the page.
import { useState, type MouseEvent } from 'react';
import { newId, type Evidence } from '../app/intake';
import { tr } from '../app/i18n';

const FLOW = { lps: { n: 'L/s', k: 1 }, m3h: { n: 'm³/h', k: 1 / 3.6 }, gpm: { n: 'US gpm', k: 0.0630902 }, m3s: { n: 'm³/s', k: 1000 } } as const;
const HEAD = { m: { n: 'm', k: 1 }, ft: { n: 'ft', k: 0.3048 }, bar: { n: 'bar', k: 10.197 }, kpa: { n: 'kPa', k: 0.10197 } } as const;
type Ref = { f: number; v: number };
type Step = 'x1' | 'x2' | 'y1' | 'y2' | 'pts';
const STEP_TEXT: Record<Step, string> = {
  x1: 'Click a labelled point on the flow (horizontal) axis',
  x2: 'Click a second labelled point on the flow axis, far from the first',
  y1: 'Click a labelled point on the head (vertical) axis',
  y2: 'Click a second labelled point on the head axis, far from the first',
  pts: 'Click along the head curve, from shut-off to its end (6–10 points)',
};

/** The calibration: page fractions → flow (L/s) and head (m). */
export function axisMap(x1: Ref, x2: Ref, y1: Ref, y2: Ref, fk: number, hk: number) {
  return (fx: number, fy: number) => ({
    q: (x1.v + ((fx - x1.f) / (x2.f - x1.f)) * (x2.v - x1.v)) * fk,
    h: (y1.v + ((fy - y1.f) / (y2.f - y1.f)) * (y2.v - y1.v)) * hk,
  });
}

export function CurveDigitizer({ doc, page, image, onAdd, onClose }: { doc: string; page: number; image: string; onAdd: (ev: Evidence[]) => void; onClose: () => void }) {
  const [step, setStep] = useState<Step>('x1');
  const [refs, setRefs] = useState<Partial<Record<'x1' | 'x2' | 'y1' | 'y2', Ref>>>({});
  const [pending, setPending] = useState<{ fx: number; fy: number } | null>(null);
  const [val, setVal] = useState('');
  const [pts, setPts] = useState<{ fx: number; fy: number }[]>([]);
  const [fu, setFu] = useState<keyof typeof FLOW>('lps');
  const [hu, setHu] = useState<keyof typeof HEAD>('m');
  const [label, setLabel] = useState('');
  const click = (e: MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    if (step === 'pts') setPts([...pts, { fx, fy }]);
    else { setPending({ fx, fy }); setVal(''); }
  };
  const setRef = () => {
    const v = Number(val.replace(',', '.'));
    if (!pending || !Number.isFinite(v) || step === 'pts') return;
    const f = step.startsWith('x') ? pending.fx : pending.fy;
    setRefs({ ...refs, [step]: { f, v } });
    setPending(null);
    setStep(step === 'x1' ? 'x2' : step === 'x2' ? 'y1' : step === 'y1' ? 'y2' : 'pts');
  };
  const map = refs.x1 && refs.x2 && refs.y1 && refs.y2 ? axisMap(refs.x1, refs.x2, refs.y1, refs.y2, FLOW[fu].k, HEAD[hu].k) : null;
  const read = map ? pts.map((p) => ({ ...p, ...map(p.fx, p.fy) })) : [];
  const add = () => {
    if (!read.length) return;
    onAdd(read.map((p) => ({ id: newId(), type: 'pumpCurvePoint', label: label || undefined, values: { flow_lps: Math.round(Math.max(0, p.q) * 100) / 100, head_m: Math.round(p.h * 100) / 100 }, source: { doc, page, box: [p.fx - 0.004, p.fy - 0.004, p.fx + 0.004, p.fy + 0.004], how: 'user' }, confidence: 1, status: 'accepted' })));
    onClose();
  };
  const marks: { fx: number; fy: number; cls: string; t: string }[] = [
    ...(['x1', 'x2', 'y1', 'y2'] as const).filter((k) => refs[k]).map((k) => ({ fx: k.startsWith('x') ? refs[k]!.f : 0.01, fy: k.startsWith('y') ? refs[k]!.f : 0.99, cls: 'dz-ref', t: `${refs[k]!.v}` })),
    ...pts.map((p, i) => ({ ...p, cls: 'dz-pt', t: `${i + 1}` })),
    ...(pending ? [{ ...pending, cls: 'dz-pending', t: '?' }] : []),
  ];
  return (
    <>
      <div className="dz-panel card" role="group" aria-label={tr('Digitise a pump curve')}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <b>{tr('Digitise a pump curve')}</b>
          <label className="small">{tr('Flow')} <select value={fu} onChange={(e) => setFu(e.target.value as keyof typeof FLOW)} aria-label={tr('Flow unit')}>{Object.entries(FLOW).map(([k, v]) => <option key={k} value={k}>{v.n}</option>)}</select></label>
          <label className="small">{tr('Head')} <select value={hu} onChange={(e) => setHu(e.target.value as keyof typeof HEAD)} aria-label={tr('Head unit')}>{Object.entries(HEAD).map(([k, v]) => <option key={k} value={k}>{v.n}</option>)}</select></label>
          <input className="small" placeholder={tr('Pump or impeller (optional)')} value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: 170 }} aria-label={tr('Pump or impeller')} />
          <span style={{ flex: 1 }} />
          <button className="btn small ghost" onClick={onClose}>{tr('Cancel')}</button>
        </div>
        <div className="dz-step small">{tr(STEP_TEXT[step])}{step === 'pts' && pts.length ? ` · ${pts.length} ${tr('points')}` : ''}</div>
        {/* one row of fixed height, so the graph does not move while clicking */}
        <div className="dz-row">
          {pending ? (
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="small">{step.startsWith('x') ? `${tr('Flow at this point')} (${FLOW[fu].n})` : `${tr('Head at this point')} (${HEAD[hu].n})`}</span>
              <input className="dz-val" type="number" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setRef()} autoFocus aria-label={tr('Axis value')} />
              <button className="btn small primary" onClick={setRef} disabled={val === ''}>{tr('Set')}</button>
            </div>
          ) : step === 'pts' ? (
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="small mono dz-read" title={read.map((p) => `${p.q.toFixed(1)} L/s · ${p.h.toFixed(1)} m`).join('\n')}>{read.length ? read.map((p) => `${p.q.toFixed(0)}·${p.h.toFixed(1)}`).join('  ') + ' (L/s·m)' : ''}</span>
              <span style={{ flex: 1 }} />
              <button className="btn small ghost" disabled={!pts.length} onClick={() => setPts(pts.slice(0, -1))}>{tr('Undo point')}</button>
              <button className="btn small primary" disabled={read.length < 3} onClick={add}>{tr('Add')} {read.length} {tr('points')}</button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="page-view dz-view">
        <img src={image} alt="" draggable={false} />
        <div className="dz-layer" onClick={click} aria-label={tr('Graph')}>
          {marks.map((m, i) => <span key={i} className={`dz-mark ${m.cls}`} style={{ left: `${m.fx * 100}%`, top: `${m.fy * 100}%` }}>{m.t}</span>)}
        </div>
      </div>
    </>
  );
}
