// Start page: what the app opens on. Start a project (blank, wizard, from drawings with AI, import, open), reopen a
// recent project, open an example, see what is new.
import { useEffect, useMemo, useState } from 'react';
import { EXAMPLES } from '../engine/cases';
import type { Network } from '../engine/types';
import { listRecent, removeRecent, timeAgo, type RecentEntry } from '../app/recent';
import { tr } from '../app/i18n';
import { Ic, type ActionIcon } from './Icons';
import { NetThumb } from './Thumb';

export interface StartActions {
  blank: () => void;
  wizard: () => void;
  aiDrawings: () => void;
  importFile: () => void;
  open: () => void;
  recent: (e: RecentEntry) => void;
  example: (id: string) => void;
  workspace: () => void;
  lastSession: () => void;
  help: () => void;
  tour: () => void;
}

const TIPS = [
  'Ctrl+K opens the command palette: every command, element and setting by name.',
  'Child cases keep only their own changes: correct the parent once and every child follows.',
  'Space plays the surge animation; ← and → step through it frame by frame.',
  'Analysis → Optimise protection and pipe classes chooses vessels, air valves and classes together.',
  'Drop a long section from Excel into the New model wizard: chainage and level, one point per line.',
  'The copilot works only through SurgeSpace commands, so every change it makes is one undo step.',
  'Daily operation → “Surge run from this hour” starts a surge case from the worst hour of the day.',
];

export function StartPage({ act, plan, version, showAtStart, setShowAtStart, autosave }: { act: StartActions; plan: string; version: string; showAtStart: boolean; setShowAtStart: (v: boolean) => void; autosave: Network | null }) {
  const [recent, setRecent] = useState<RecentEntry[] | null>(null);
  useEffect(() => { void listRecent().then(setRecent); }, []);
  const examples = useMemo(() => EXAMPLES.map((e) => ({ id: e.id, net: e.make() })), []);
  const tip = useMemo(() => TIPS[Math.floor(Date.now() / 86400000) % TIPS.length], []);
  const card = (icon: ActionIcon, title: string, sub: string, onClick: () => void, cls = '') => (
    <button className={`start-card ${cls}`} onClick={onClick}>
      <span className="start-ic"><Ic name={icon} size={22} /></span>
      <span className="start-tx"><b>{tr(title)}</b><span>{tr(sub)}</span></span>
      {cls === 'feature' && <span className="feature-flow"><i>{tr('Drawings')}</i><s>→</s><i>{tr('Review')}</i><s>→</s><i>{tr('Missing data')}</i><s>→</s><i>{tr('Model')}</i><s>→</s><i>{tr('Protection')}</i></span>}
    </button>
  );
  return (
    <div className="start" role="dialog" aria-label="Start">
      <header className="start-head">
        <div className="start-brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#07111F" /><path d="M3 20 L9 20 L12 7 L16 25 L19 13 L22 20 L29 20" fill="none" stroke="#FF7A1A" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" /></svg>
          <span>Surge<b>Space</b></span>
          <em className="start-ver">{version}</em>
          <em className="start-plan">{plan}</em>
        </div>
        <button className="btn ghost start-go" onClick={act.workspace}>{tr('Go to the workspace')} →</button>
      </header>
      <div className="start-body">
        <main className="start-main">
          <section>
            <h2>{tr('Start a project')}</h2>
            <div className="start-grid">
              {card('ai', 'Build from drawings with AI', 'Plans, long sections, data sheets, DXF or Excel: the copilot reads them, asks for what is missing, builds and tests the model.', act.aiDrawings, 'feature')}
              {card('wave', 'New model wizard', 'A pumped or gravity main from its long section in four short steps.', act.wizard)}
              {card('new', 'Blank model', 'Draw the network yourself.', act.blank)}
              {card('import', 'Import', 'EPANET .inp, spreadsheet, long section, DXF or GIS layer.', act.importFile)}
              {card('open', 'Open project…', 'A SurgeSpace project file (.surge.json).', act.open)}
            </div>
          </section>
          {(autosave?.nodes.length || (recent && recent.length > 0)) ? (
            <section>
              <h2>{tr('Recent')}</h2>
              <div className="thumb-grid">
                {autosave && autosave.nodes.length > 0 && (
                  <button className="thumb-card" onClick={act.lastSession} title="Continue where you left off">
                    <NetThumb net={autosave} />
                    <span className="thumb-tx"><b>{autosave.name || 'Untitled model'}</b><span>{tr('Last session')} · {autosave.pipes.length} pipes</span></span>
                  </button>
                )}
                {(recent ?? []).filter((r) => !autosave || r.name !== autosave.name).slice(0, 7).map((r) => (
                  <div key={r.id} className="thumb-card-wrap">
                    <button className="thumb-card" onClick={() => act.recent(r)}>
                      <NetThumb net={r.net} />
                      <span className="thumb-tx"><b>{r.name}</b><span>{timeAgo(r.when)} · {r.pipes} pipes · {r.how}</span></span>
                    </button>
                    <button className="thumb-x" title="Remove from the list" aria-label={`Remove ${r.name} from recent`} onClick={() => void removeRecent(r.id).then(() => listRecent().then(setRecent))}>×</button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <section>
            <h2>{tr('Examples')}</h2>
            <div className="thumb-grid">
              {examples.map((e) => (
                <button key={e.id} className="thumb-card" onClick={() => act.example(e.id)} title={e.net.description}>
                  <NetThumb net={e.net} />
                  <span className="thumb-tx"><b>{e.net.name}</b><span className="clamp2">{e.net.description}</span></span>
                </button>
              ))}
            </div>
          </section>
        </main>
        <aside className="start-side">
          <div className="side-card">
            <h3>{tr('New in 3.0')}</h3>
            <ul>
              <li>Daily operation and water quality, checked against EPANET 2.2</li>
              <li>Rigid-column engine for slow events and surge tanks</li>
              <li>AI copilot with your own AI account; replies stream as written</li>
              <li>Motor starters, differential surge tanks, turbine runner types</li>
              <li>Leakage and pressure-driven demand</li>
              <li>Least-cost protection with pipe classes</li>
              <li>Live SCADA data, GIS and CAD exchange, Arabic interface</li>
            </ul>
          </div>
          <div className="side-card tip">
            <h3>{tr('Tip')}</h3>
            <p>{tip}</p>
          </div>
          <div className="side-card">
            <h3>{tr('Learn')}</h3>
            <button className="linkbtn" onClick={act.tour}>{tr('Take the 1-minute tour')}</button>
            <button className="linkbtn" onClick={act.help}>{tr('Quick start and tutorials')}</button>
          </div>
        </aside>
      </div>
      <footer className="start-foot">
        <label className="row small"><input type="checkbox" checked={showAtStart} onChange={(e) => setShowAtStart(e.target.checked)} /> {tr('Show this page when SurgeSpace starts')}</label>
        <span className="muted small">File → {tr('Start page')}</span>
      </footer>
    </div>
  );
}
