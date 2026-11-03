import { useState, useSyncExternalStore } from 'react';
import { dayToDate } from './core';
import { checkOnline, DEMO, demoCode, enterCode, getLicence, LICENCE_EMAIL, openExternal, planLabel, removeCode, requestEmail, startTrial, subscribeLicence } from './licence';

export const useLicence = () => useSyncExternalStore(subscribeLicence, getLicence);

const date = (d: number | null | undefined) => (d === null || d === undefined ? 'No end date' : dayToDate(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }));

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export function LicenceDialog({ reason, onClose }: { reason?: string; onClose: () => void }) {
  const lic = useLicence();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const run = async (f: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true); setMsg(null);
    try { const r = await f(); setMsg({ ok: r.ok, text: r.message }); } finally { setBusy(false); }
  };
  const doCopy = async (what: string, text: string) => { if (await copy(text)) { setCopied(what); setTimeout(() => setCopied(''), 1800); } };
  const mail = requestEmail(lic.machineId);
  const mailto = `mailto:${mail.to}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`;
  const p = lic.payload;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Licence" style={{ width: 'min(680px, 100%)' }}>
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
            {lic.source === 'code' && p && (
              <div className="small" style={{ textAlign: 'right' }}>
                <div><b>{p.n}</b></div>
                <div className="muted">Licence {p.l} · valid until {date(p.e)}</div>
                {lic.lastCheck !== undefined && <div className="muted">Last online check {date(lic.lastCheck)}</div>}
              </div>
            )}
          </div>
          {lic.notice && <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{lic.notice}</div>}
        </div>

        <div className="label" style={{ marginTop: 16 }}>Machine ID of this computer</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <code className="machine-id" style={{ userSelect: 'all' }}>{lic.machineId || '…'}</code>
          <button className="btn small" onClick={() => doCopy('id', lic.machineId)}>{copied === 'id' ? 'Copied' : 'Copy'}</button>
        </div>

        {lic.source !== 'code' && (
          <ol className="steps">
            <li>
              <b>Send the Machine ID</b> to <span className="mono" style={{ userSelect: 'all' }}>{LICENCE_EMAIL}</span> with your name or company and the licence you want.
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <button className="btn small" onClick={() => void openExternal(mailto)}>Open email</button>
                <button className="btn small ghost" onClick={() => doCopy('mail', `To: ${mail.to}\nSubject: ${mail.subject}\n\n${mail.body}`)}>{copied === 'mail' ? 'Copied' : 'Copy email text'}</button>
              </div>
            </li>
            <li>
              <b>Paste the activation code</b> from the reply:
              <form onSubmit={(e) => { e.preventDefault(); void run(() => enterCode(code)); }} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                <textarea rows={3} value={code} onChange={(e) => setCode(e.target.value)} placeholder="SSA-…" spellCheck={false} aria-label="Activation code" />
                <div><button className="btn primary" disabled={busy || !code.trim()} type="submit">Activate</button></div>
              </form>
            </li>
          </ol>
        )}

        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {lic.source === 'none' && !lic.trialUsed && (
            <button className="btn" disabled={busy} onClick={() => void run(startTrial)}>Start 14-day free trial</button>
          )}
          {lic.source === 'code' && <button className="btn" disabled={busy} onClick={() => void run(() => checkOnline(true))}>Check licence now</button>}
          {lic.source === 'code' && (confirmRemove ? (
            <>
              <span className="small">Remove the licence from this computer? You will need a new code to activate it again.</span>
              <button className="btn small" onClick={() => { setConfirmRemove(false); void removeCode().then(() => setMsg({ ok: true, text: 'Licence removed from this computer.' })); }}>Yes, remove</button>
              <button className="btn small ghost" onClick={() => setConfirmRemove(false)}>Cancel</button>
            </>
          ) : <button className="btn ghost" onClick={() => setConfirmRemove(true)}>Remove from this computer</button>)}
          {lic.source === 'code' && <span className="small muted">Moving to a new computer? Send the new Machine ID to {LICENCE_EMAIL}.</span>}
        </div>
        {msg && <div className="small" style={{ marginTop: 10, color: msg.ok ? 'var(--good)' : 'var(--bad)' }} role="status">{msg.text}</div>}

        <table className="grid" style={{ marginTop: 16 }}>
          <thead><tr><th>Feature</th><th>Free</th><th>Pro / trial</th></tr></thead>
          <tbody>
            <tr><td>Built-in examples, map, animation, profile</td><td>✓</td><td>✓</td></tr>
            <tr><td>Your own models</td><td>Up to 25 pipes</td><td>Unlimited</td></tr>
            <tr><td>Automatic surge vessel and air valve sizing</td><td>—</td><td>✓</td></tr>
            <tr><td>Uncertainty (worst-case) analysis</td><td>—</td><td>✓</td></tr>
            <tr><td>Export to EPANET and CSV</td><td>—</td><td>✓</td></tr>
          </tbody>
        </table>

        {DEMO && (
          <div className="hint" style={{ marginTop: 12 }}>
            Preview build: there is no real signing key yet, so you can make a demo code for this computer here, as the licence tool would.
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => void demoCode(12).then(setCode)}>Make a 1-year demo code</button>
              <button className="btn small ghost" onClick={() => void demoCode(0).then(setCode)}>No end date</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
