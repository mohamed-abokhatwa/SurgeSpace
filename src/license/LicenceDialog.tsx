import { useEffect, useState, useSyncExternalStore } from 'react';
import { activate, BUY_URL, deactivate, DEMO, demoKey, getLicence, planLabel, refresh, startTrial, storePurchase, subscribeLicence } from './licence';

export const useLicence = () => useSyncExternalStore(subscribeLicence, getLicence);

const fmtDate = (s: number | null | undefined) => (s ? new Date(s * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'No end date');

export function LicenceDialog({ reason, onClose }: { reason?: string; onClose: () => void }) {
  const lic = useLicence();
  const [key, setKey] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [demo, setDemo] = useState<string | null>(null);
  useEffect(() => { if (DEMO) void demoKey().then(setDemo); }, []);
  const run = async (f: () => Promise<{ ok: boolean; message?: string }>, okText: string) => {
    setBusy(true); setMsg(null);
    try { const r = await f(); setMsg({ ok: r.ok, text: r.ok ? r.message ?? okText : r.message ?? 'Something went wrong.' }); }
    finally { setBusy(false); }
  };
  const p = lic.payload;
  const licensed = lic.plan !== 'free';
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Licence" style={{ width: 'min(680px, 100%)' }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>SurgeSpace licence</h3>
          <button className="btn ghost" onClick={onClose} aria-label="Close">×</button>
        </div>
        {reason && <div className="hint" style={{ marginTop: 10, borderStyle: 'solid', borderColor: 'var(--accent)', color: 'var(--text)' }}>{reason}</div>}

        <div className="card" style={{ marginTop: 12, boxShadow: 'none' }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div>
              <div className="small muted">Current plan</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{planLabel(lic)}</div>
            </div>
            {licensed && lic.source !== 'store' && p && (
              <div className="small" style={{ textAlign: 'right' }}>
                <div>{p.name ?? p.email}</div>
                <div className="muted">{p.plan === 'trial' ? `Trial ends ${fmtDate(p.exp)}` : `Valid until ${fmtDate(p.exp)}`} · {p.seats} device{p.seats > 1 ? 's' : ''}</div>
                <div className="muted">Next online check before {fmtDate(p.rby)}</div>
              </div>
            )}
            {lic.source === 'store' && <div className="small muted">Managed by the Microsoft Store</div>}
          </div>
          {lic.notice && <div className="small" style={{ color: 'var(--bad)', marginTop: 8 }}>{lic.notice}</div>}
        </div>

        {lic.source === 'store' ? (
          <div style={{ marginTop: 14 }}>
            {lic.plan === 'free' || lic.plan === 'trial' ? (
              <button className="btn primary" disabled={busy} onClick={() => run(async () => ({ ok: true, message: await storePurchase() }), 'Done')}>Get SurgeSpace Pro in the Microsoft Store</button>
            ) : <p className="small muted">Manage or cancel the subscription in the Microsoft Store app, under Library → Subscriptions.</p>}
          </div>
        ) : licensed ? (
          <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy} onClick={() => run(async () => ({ ok: await refresh(), message: 'Licence checked.' }), 'Licence checked.')}>Check licence now</button>
            <button className="btn" disabled={busy} onClick={() => run(deactivate, 'Deactivated.')}>Deactivate this device</button>
            {lic.plan === 'trial' && <a className="btn primary" href={BUY_URL} target="_blank" rel="noreferrer">Buy a licence</a>}
          </div>
        ) : (
          <div className="grid2" style={{ marginTop: 14, alignItems: 'stretch' }}>
            <form className="card" style={{ boxShadow: 'none', display: 'flex', flexDirection: 'column', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void run(() => startTrial(email), 'Trial started.'); }}>
              <b>Try Pro free for 14 days</b>
              <span className="small muted">Every feature, no card needed. One trial per person and per computer.</span>
              <label className="field"><span>Work email</span><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoComplete="email" /></label>
              <button className="btn primary" disabled={busy} type="submit">Start trial</button>
            </form>
            <form className="card" style={{ boxShadow: 'none', display: 'flex', flexDirection: 'column', gap: 8 }} onSubmit={(e) => { e.preventDefault(); void run(() => activate(key), 'Licence activated.'); }}>
              <b>Activate a licence key</b>
              <span className="small muted">The key from your purchase email. A licence covers 2 computers.</span>
              <label className="field"><span>Licence key</span><input required value={key} onChange={(e) => setKey(e.target.value)} placeholder="SSPC-XXXXX-XXXXX-XXXXX-XXXXX" className="mono" spellCheck={false} autoComplete="off" /></label>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn primary" disabled={busy} type="submit">Activate</button>
                <a className="btn ghost" href={BUY_URL} target="_blank" rel="noreferrer">Buy a licence</a>
              </div>
            </form>
          </div>
        )}
        {msg && <div className="small" style={{ marginTop: 10, color: msg.ok ? 'var(--good)' : 'var(--bad)' }} role="status">{msg.text}</div>}

        <table className="grid" style={{ marginTop: 16 }}>
          <thead><tr><th>Feature</th><th>Free</th><th>Pro / trial</th></tr></thead>
          <tbody>
            <tr><td>Built-in examples, map, animation, profile</td><td>✓</td><td>✓</td></tr>
            <tr><td>Your own models</td><td>Up to 25 pipes</td><td>Unlimited</td></tr>
            <tr><td>Automatic surge vessel and air valve sizing</td><td>—</td><td>✓</td></tr>
            <tr><td>Uncertainty (worst-case) analysis</td><td>—</td><td>✓</td></tr>
            <tr><td>Export to EPANET and CSV</td><td>—</td><td>✓</td></tr>
            <tr><td>Works offline</td><td>✓</td><td>✓ (online check every 30 days)</td></tr>
          </tbody>
        </table>

        {DEMO && lic.source !== 'store' && (
          <div className="hint" style={{ marginTop: 12 }}>
            Preview build: licences are handled by a demo server inside this browser, so you can try every step. Demo key: <span className="mono" style={{ userSelect: 'all' }}>{demo ?? '…'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
