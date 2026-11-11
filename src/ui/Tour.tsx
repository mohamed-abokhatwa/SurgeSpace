// One-minute tour: a spotlight on each part of the workspace with a short note. Offered once on the first visit
// (a small card that does not block work), and from the start page and Help.
import { useEffect, useLayoutEffect, useState } from 'react';
import { tr } from '../app/i18n';

const STEPS: { sel: string; title: string; text: string }[] = [
  { sel: '.ribbon', title: 'Build the network', text: 'Place sources, pipes, pumps, valves and protection devices from the ribbon. The AI group builds, reviews and protects for you.' },
  { sel: '.map-wrap', title: 'The drawing', text: 'Click to select, drag to move, scroll to zoom. After a run the pipes show the pressures; Space plays the surge.' },
  { sel: '.pane.left', title: 'Explorer and operations', text: 'Every element by type, and Operations: what happens in the surge run — a pump trip, a valve closure, a start.' },
  { sel: '.pane.right', title: 'Properties and Copilot', text: 'Edit what you select. The Copilot tab is an AI engineer that works through the same commands you use.' },
  { sel: '.ribbon .rb.run', title: 'Run', text: 'F5 runs the surge analysis: steady state, surge run and design checks, with the envelope growing as it goes.' },
  { sel: '.dock', title: 'Results', text: 'Long-section profile, graphs, design checks, data sheets, cases, protection sizing, uncertainty and daily operation.' },
  { sel: '', title: 'Find anything', text: 'Ctrl+K opens the command palette: every command, element and setting by name. File → Start page brings you back to the start.' },
];

export function Tour({ onClose }: { onClose: () => void }) {
  const [k, setK] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const st = STEPS[k];
  useLayoutEffect(() => {
    const el = st.sel ? document.querySelector(st.sel) : null;
    const upd = () => setBox(el ? el.getBoundingClientRect() : null);
    upd();
    window.addEventListener('resize', upd);
    return () => window.removeEventListener('resize', upd);
  }, [st.sel]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); if (k < STEPS.length - 1) setK(k + 1); else onClose(); }
      else if (e.key === 'ArrowLeft') setK(Math.max(0, k - 1));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [k, onClose]);
  const pad = 6, vw = window.innerWidth, vh = window.innerHeight;
  const hole = box ? { left: box.left - pad, top: box.top - pad, width: box.width + 2 * pad, height: box.height + 2 * pad } : null;
  // place the note beside the highlighted area, inside the window
  const cw = 330, ch = 170;
  let pos: { left: number; top: number };
  if (!hole) pos = { left: vw / 2 - cw / 2, top: vh / 2 - ch / 2 };
  else if (hole.top + hole.height + ch + 12 < vh) pos = { left: Math.min(Math.max(hole.left, 12), vw - cw - 12), top: hole.top + hole.height + 12 };
  else if (hole.left - cw - 12 > 0) pos = { left: hole.left - cw - 12, top: Math.min(Math.max(hole.top, 12), vh - ch - 12) };
  else if (hole.left + hole.width + cw + 12 < vw) pos = { left: hole.left + hole.width + 12, top: Math.min(Math.max(hole.top, 12), vh - ch - 12) };
  else pos = { left: vw / 2 - cw / 2, top: Math.max(hole.top - ch - 12, 12) };
  return (
    <div className="tour" role="dialog" aria-label="Tour">
      <div className="tour-hole" style={hole ?? { left: vw / 2, top: vh / 2, width: 0, height: 0 }} />
      <div className="tour-card card" style={{ left: pos.left, top: pos.top, width: cw }}>
        <div className="tour-step mono small muted">{k + 1} / {STEPS.length}</div>
        <b>{tr(st.title)}</b>
        <p>{tr(st.text)}</p>
        <div className="tour-nav">
          <button className="btn ghost small" onClick={onClose}>{tr('Skip')}</button>
          <span style={{ flex: 1 }} />
          {k > 0 && <button className="btn small" onClick={() => setK(k - 1)}>{tr('Back')}</button>}
          <button className="btn small primary" onClick={() => (k < STEPS.length - 1 ? setK(k + 1) : onClose())}>{k < STEPS.length - 1 ? tr('Next') : tr('Done')}</button>
        </div>
      </div>
    </div>
  );
}

/** First visit: a small, non-blocking invitation to take the tour. */
export function TourInvite({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div className="tour-invite card" role="status">
      <b>{tr('New to SurgeSpace?')}</b>
      <span className="small muted">{tr('A one-minute tour of the workspace.')}</span>
      <div className="row" style={{ gap: 6 }}><button className="btn small primary" onClick={onStart}>{tr('Take the tour')}</button><button className="btn small ghost" onClick={onDismiss}>{tr('No thanks')}</button></div>
    </div>
  );
}
