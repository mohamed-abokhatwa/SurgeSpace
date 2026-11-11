import { useUnits } from '../app/units';
// Report dialog: title-page details, then a preview of the detailed report with Print / Save as PDF and HTML download.
import { useMemo, useRef, useState } from 'react';
import type { Check } from '../engine/analysis';
import type { TransientResult } from '../engine/transient';
import type { Network, ReportInfo } from '../engine/types';
import { buildReport } from '../report/report';
import { download } from './util';

export function ReportDialog({ net, result, checks, route, nodes, version, onSaveInfo, onClose, onDraftAI }: {
  net: Network; result: TransientResult; checks: Check[]; route: [string, string]; nodes: string[]; version: string;
  onSaveInfo: (info: ReportInfo) => void; onClose: () => void;
  /** Ask the AI copilot to draft the narrative (closes the dialog). */
  onDraftAI?: () => void;
}) {
  const units = useUnits();
  const [info, setInfo] = useState<ReportInfo>(net.report ?? {});
  const [made, setMade] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => (made ? buildReport({ ...net, report: info }, result, checks, { version, route, nodes, units }) : ''), [made, net, info, result, checks, version, route, nodes, units]);
  const field = (k: Exclude<keyof ReportInfo, 'narrativeByAI'>, label: string, area = false) => (
    <label className="field" style={area ? { gridColumn: '1 / -1' } : undefined}><span>{label}</span>
      {area ? <textarea rows={3} value={info[k] ?? ''} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />
        : <input value={info[k] ?? ''} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} />}
    </label>
  );
  const fileBase = net.name.replace(/[^\w-]+/g, '_');
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Report">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <b>Detailed report</b>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">×</button>
        </div>
        {!made ? (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>Title page details (kept with the project). The report has the summary of findings, the profile envelope, all input data, results for every node and pipe, the protection devices and slams, all checks, and time histories.</p>
            <div className="grid2">
              {field('projectNo', 'Project no.')}
              {field('client', 'Client')}
              {field('preparedBy', 'Prepared by')}
              {field('checkedBy', 'Checked by')}
              {field('revision', 'Revision')}
              {field('notes', 'Notes', true)}
              <label className="field" style={{ gridColumn: '1 / -1' }}>
                <span className="row" style={{ justifyContent: 'space-between' }}>
                  <span>Narrative (Markdown, optional){info.narrativeByAI ? ' · drafted by AI' : ''}</span>
                  {onDraftAI && <button className="btn small" type="button" onClick={() => { onSaveInfo(info); onDraftAI(); }} title="The AI copilot writes the introduction, method, results discussion and recommendations from your model and results">Draft with AI</button>}
                </span>
                <textarea rows={7} value={info.narrative ?? ''} placeholder="Introduction, method, discussion and recommendations. Appears before the summary of findings." onChange={(e) => setInfo({ ...info, narrative: e.target.value })} />
              </label>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 12 }}>
              <button className="btn primary" onClick={() => { onSaveInfo(info); setMade(true); }}>Create report</button>
              <button className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={() => frame.current?.contentWindow?.print()}>Print / Save as PDF</button>
              <button className="btn" onClick={() => download(`${fileBase}-report.html`, html, 'text/html')}>Download (.html)</button>
              <button className="btn ghost" onClick={() => setMade(false)}>Edit details</button>
              <span className="small muted">To get a PDF, pick “Save as PDF” as the printer.</span>
            </div>
            <iframe ref={frame} title="Report preview" className="report-frame" srcDoc={html} />
          </>
        )}
      </div>
    </div>
  );
}
