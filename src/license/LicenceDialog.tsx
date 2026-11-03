import { useState, useSyncExternalStore } from 'react';
import { dayToDate } from './core';
import { activate, askMoreTime, checkIn, DEMO, demoIssue, getLicence, planLabel, removeLicence, requestLicence, sendFeedback, startTrial, subscribeLicence } from './licence';

export const useLicence = () => useSyncExternalStore(subscribeLicence, getLicence);

const date = (d: number | null | undefined) => (d === null || d === undefined ? 'perpetual' : dayToDate(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));
type Msg = { ok: boolean; text: string } | null;

export function LicenceDialog({ reason, onClose }: { reason?: string; onClose: () => void }) {
  const lic = useLicence();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [copied, setCopied] = useState(false);
  const [panel, setPanel] = useState<'none' | 'more' | 'request' | 'remove'>('none');
  const [more, setMore] = useState({ note: '', reply: '' });
  const [req, setReq] = useState({ kind: 'personal', name: '', company: '', email: '', note: '' });
  const run = async (f: () => Promise<{ ok: boolean; message: string }>, after?: () => void) => {
    setBusy(true); setMsg(null);
    try { const r = await f(); setMsg({ ok: r.ok, text: r.message }); if (r.ok) after?.(); } finally { setBusy(false); }
  };
  const p = lic.payload;
  const licensed = lic.source === 'licence';

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Licence" style={{ width: 'min(700px, 100%)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>SurgeSpace licence</h3>
          <button className="btn ghost" onClick={onClose} aria-label="Close">×</button>
        </div>
        {reason && <div className="hint" style={{ marginTop: 10, borderStyle: 'solid', borderColor: 'var(--accent)', color: 'var(--text)' }}>{reason}</div>}

        <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div>
              <div className="small muted">Current plan</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{planLabel(lic)}</div>
            </div>
            {licensed && p && (
              <div className="small" style={{ textAlign: 'right' }}>
                <div><b>{p.n}</b></div>
                <div className="muted mono">{lic.code}</div>
                <div className="muted">Until {date(p.x)}</div>
                {lic.lastCheckin && <div className="muted">Last check-in {new Date(lic.lastCheckin).toLocaleString()}</div>}
              </div>
            )}
            {lic.source === 'trial' && p && <div className="small muted" style={{ textAlign: 'right' }}>Evaluation runs to {date(p.e)}</div>}
          </div>
          {lic.notice && <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{lic.notice}</div>}
          <div className="row small" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="muted">Machine ID</span>
            <code className="mono" style={{ userSelect: 'all' }}>{lic.machineId || '…'}</code>
            <button className="btn small ghost" onClick={() => void navigator.clipboard.writeText(lic.machineId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {})}>{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>

        {licensed ? (
          <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy} onClick={() => void run(() => checkIn(true))}>Check licence now</button>
            {panel === 'remove' ? (
              <>
                <span className="small">Remove the licence from this computer? To use it on another computer, Engineering Workspace frees it on the server.</span>
                <button className="btn small" onClick={() => { setPanel('none'); void removeLicence().then(() => setMsg({ ok: true, text: 'Licence removed from this computer.' })); }}>Yes, remove</button>
                <button className="btn small ghost" onClick={() => setPanel('none')}>Cancel</button>
              </>
            ) : <button className="btn ghost" onClick={() => setPanel('remove')}>Remove from this computer</button>}
          </div>
        ) : (
          <>
            <form className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); void run(() => activate(code)); }}>
              <label className="field" style={{ flex: 1, minWidth: 240 }}><span>Licence code</span>
                <input className="mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="SSL-XXXX-XXXX-XXXX" spellCheck={false} autoComplete="off" />
              </label>
              <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy || !code.trim()} type="submit">Activate</button>
            </form>
            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {!lic.trialUsed && <button className="btn" disabled={busy} onClick={() => void run(startTrial)}>Start 14-day evaluation</button>}
              {lic.trialUsed && <button className="btn" onClick={() => setPanel(panel === 'more' ? 'none' : 'more')}>Ask for more evaluation time</button>}
              <button className="btn ghost" onClick={() => setPanel(panel === 'request' ? 'none' : 'request')}>Request a licence</button>
            </div>
            {panel === 'more' && (
              <form className="card" style={{ boxShadow: 'none', marginTop: 10, display: 'grid', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void run(() => askMoreTime(more.note, more.reply), () => setPanel('none')); }}>
                <span className="small muted">The first request adds 7 days straight away. After that, Engineering Workspace decides, and the extra days arrive in the app by themselves.</span>
                <label className="field"><span>What are you evaluating? (optional)</span><input value={more.note} onChange={(e) => setMore({ ...more, note: e.target.value })} /></label>
                <label className="field"><span>Your email, for a reply (optional)</span><input type="email" value={more.reply} onChange={(e) => setMore({ ...more, reply: e.target.value })} /></label>
                <div><button className="btn primary" disabled={busy} type="submit">Ask for more time</button></div>
              </form>
            )}
            {panel === 'request' && (
              <form className="card" style={{ boxShadow: 'none', marginTop: 10, display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }} onSubmit={(e) => { e.preventDefault(); void run(() => requestLicence(req), () => setPanel('none')); }}>
                <label className="field"><span>Asking for</span><select value={req.kind} onChange={(e) => setReq({ ...req, kind: e.target.value })}><option value="personal">Personal licence (1 computer)</option><option value="company">Company licence (several computers)</option><option value="question">A question</option></select></label>
                <label className="field"><span>Email</span><input type="email" required value={req.email} onChange={(e) => setReq({ ...req, email: e.target.value })} /></label>
                <label className="field"><span>Name</span><input required value={req.name} onChange={(e) => setReq({ ...req, name: e.target.value })} /></label>
                <label className="field"><span>Company (optional)</span><input value={req.company} onChange={(e) => setReq({ ...req, company: e.target.value })} /></label>
                <label className="field" style={{ gridColumn: '1 / -1' }}><span>Message (optional)</span><input value={req.note} onChange={(e) => setReq({ ...req, note: e.target.value })} placeholder="e.g. 3 computers, 1 year" /></label>
                <div style={{ gridColumn: '1 / -1' }}><button className="btn primary" disabled={busy} type="submit">Send request</button> <span className="small muted">Your Machine ID is included.</span></div>
              </form>
            )}
          </>
        )}
        {msg && <div className="small" style={{ marginTop: 10, color: msg.ok ? 'var(--good)' : 'var(--bad)' }} role="status">{msg.text}</div>}

        <table className="grid" style={{ marginTop: 16 }}>
          <thead><tr><th>Feature</th><th>Free</th><th>Licence / evaluation</th></tr></thead>
          <tbody>
            <tr><td>Built-in examples, map, animation, profile</td><td>✓</td><td>✓</td></tr>
            <tr><td>Your own models</td><td>Up to 25 pipes</td><td>Unlimited</td></tr>
            <tr><td>Automatic surge vessel and air valve sizing</td><td>—</td><td>✓</td></tr>
            <tr><td>Uncertainty (worst-case) analysis</td><td>—</td><td>✓</td></tr>
            <tr><td>Export to EPANET and CSV</td><td>—</td><td>✓</td></tr>
            <tr><td>Works offline</td><td>✓</td><td>✓ (checks in daily when online; up to 60 days offline)</td></tr>
          </tbody>
        </table>

        {DEMO && !licensed && (
          <div className="hint" style={{ marginTop: 12 }}>
            Preview build: the licence server runs inside this page. <button className="btn small" onClick={() => void demoIssue().then(setCode)}>Issue a demo licence code</button> (as you would on the admin page), then press Activate.
          </div>
        )}
      </div>
    </div>
  );
}

export function TellUsDialog({ where, onClose }: { where: string; onClose: () => void }) {
  const [f, setF] = useState({ message: '', detail: '', reply_to: '', level: 'info' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <div className="modal-back" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Tell us" style={{ width: 'min(520px, 100%)', display: 'grid', gap: 10 }}
        onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await sendFeedback({ ...f, where }); setBusy(false); setMsg({ ok: r.ok, text: r.message }); if (r.ok) setTimeout(onClose, 1400); }}>
        <div className="row" style={{ justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>Tell us</h3><button type="button" className="btn ghost" onClick={onClose} aria-label="Close">×</button></div>
        <span className="small muted">A question, an idea or a problem: it goes straight to Engineering Workspace.</span>
        <label className="field"><span>Type</span><select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}><option value="info">Question or idea</option><option value="problem">Something went wrong</option></select></label>
        <label className="field"><span>In one line</span><input required maxLength={200} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
        <label className="field"><span>Details (optional)</span><textarea rows={4} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} style={{ fontFamily: 'var(--sans)' }} /></label>
        <label className="field"><span>Your email, for a reply (optional)</span><input type="email" value={f.reply_to} onChange={(e) => setF({ ...f, reply_to: e.target.value })} /></label>
        <div className="row"><button className="btn primary" disabled={busy} type="submit">Send</button>{msg && <span className="small" style={{ color: msg.ok ? 'var(--good)' : 'var(--bad)' }}>{msg.text}</span>}</div>
      </form>
    </div>
  );
}
