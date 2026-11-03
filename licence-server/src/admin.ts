// Admin page for the SurgeSpace licence server (same layout as the Engineering Workspace licences page).
export const ADMIN_HTML = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>SurgeSpace — licences</title>
<style>
  :root{--page:#0A1322;--card:#0F1C30;--line:#20324D;--ink:#EEF2F8;--ink2:#B6C2D3;--ink3:#7D8DA5;
        --brand:#FF7A1A;--ok:#22C55E;--bad:#EF4444;--warn:#FAB219}
  *{box-sizing:border-box}
  body{margin:0;background:var(--page);color:var(--ink);font:14px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;padding:22px max(16px,env(safe-area-inset-left))}
  h1{font-size:19px;margin:0 0 2px;font-weight:600}
  .sub{color:var(--ink3);font-size:12.5px;margin-bottom:18px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:14px;overflow-x:auto}
  .card>p{color:var(--ink2);font-size:13px;margin:2px 0 10px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th{text-align:left;color:var(--ink3);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.07em;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}
  td{padding:8px;border-bottom:1px solid rgba(32,50,77,.6);vertical-align:top}
  tr:last-child td{border-bottom:0}
  code{font:11.5px ui-monospace,Menlo,Consolas,monospace;background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px}
  input,select{background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:7px 9px;font-size:13px;min-width:0}
  button{background:var(--brand);color:#1A0B00;border:0;border-radius:8px;padding:7px 12px;font-weight:600;cursor:pointer;font-size:13px}
  button.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}
  button.bad{background:transparent;color:var(--bad);border:1px solid rgba(239,68,68,.45)}
  .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .muted{color:var(--ink3)} .gold{color:var(--brand)} .bad2{color:var(--bad)}
  .pill{display:inline-block;font-size:10.5px;padding:0 7px;border-radius:999px;border:1px solid currentColor;margin-left:4px;vertical-align:1px}
  .ok{color:var(--ok)} .warn{color:var(--warn)}
  .right{text-align:right;white-space:nowrap}
</style></head><body>
<h1>SurgeSpace — licences</h1>
<div class="sub">A licence covers its computers (personal: one; company: its seats). Free the computer and it moves.</div>

<div id="auth" class="card"><div class="row"><input id="tok" type="password" placeholder="Admin token" style="width:320px" autocomplete="current-password"><button id="go">Open</button></div></div>

<div id="app" style="display:none">
  <div class="card">
    <div class="row">
      <input id="n" placeholder="Customer name" style="width:220px">
      <input id="e" placeholder="e-mail (optional)" style="width:200px">
      <select id="p"><option value="personal">personal</option><option value="company">company</option></select>
      <input id="u" placeholder="paid until: YYYY-MM-DD or empty = perpetual" style="width:290px">
      <input id="s" placeholder="seats" style="width:80px">
      <button id="issue">Issue a licence</button>
    </div>
    <div id="new" style="margin-top:10px"></div>
  </div>

  <div class="card"><table><thead><tr><th>Customer</th><th>Plan</th><th>Code</th><th>Computer</th><th>Last seen</th><th>Until</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>

  <div class="card"><p>Evaluations · each computer by a one-way code, never its name. A computer's first request for more time adds 7 days by itself; a later one waits here.</p>
    <table><thead><tr><th>Computer</th><th>First day</th><th>Runs to</th><th>Added</th><th>Last seen</th><th>Asked</th><th></th></tr></thead><tbody id="trials"></tbody></table></div>

  <div class="card"><p>Licence requests from the app and the website · each one is also emailed when email is set up</p>
    <table><thead><tr><th>When</th><th>Asking for</th><th>Who</th><th>What they wrote</th><th>Mail</th><th></th></tr></thead><tbody id="reqs"></tbody></table></div>

  <div class="card"><p>What people have told us</p>
    <table><thead><tr><th>When</th><th>What they said</th><th>Reply to</th><th>Build</th><th>Where</th></tr></thead><tbody id="fb"></tbody></table></div>
</div>

<script>
const B = '__BASE__';
const T = () => { try { return localStorage.getItem('ss_admin') || ''; } catch { return ''; } };
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t == null ? '' : t).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(p, body) {
  const r = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: { 'x-admin-token': T(), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { try { localStorage.removeItem('ss_admin'); } catch {} $('auth').style.display = ''; $('app').style.display = 'none'; throw new Error('auth'); }
  return r.json();
}
$('go').onclick = () => { try { localStorage.setItem('ss_admin', $('tok').value.trim()); } catch {} load(); };
$('tok').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('issue').onclick = async () => {
  const r = await api('/admin/issue', { name: $('n').value, email: $('e').value, plan: $('p').value, paid_until: $('u').value.trim(), seats: Number($('s').value || 0) });
  $('new').innerHTML = r.code ? '<span class="gold">Give this to ' + esc(r.name) + ':</span> <code style="font-size:14px;user-select:all">' + esc(r.code) + '</code>' : '<span class="bad2">' + esc(r.message || 'refused') + '</span>';
  if (r.code) { $('n').value = $('e').value = $('u').value = $('s').value = ''; }
  load();
};
let LICS = [], REQS = [];
function untilCell(l) {
  const end = l.paid_until ? esc(l.paid_until) : 'perpetual';
  const key = l.machines.length && l.key_runs_to && l.key_runs_to !== l.paid_until ? '<div class="muted" style="font-size:11px" title="The key on the computer runs at most 60 days ahead and moves forward at each daily check-in.">key runs to ' + esc(l.key_runs_to) + '</div>' : '';
  return end + key;
}
async function load() {
  if (!T()) return;
  const r = await api('/admin/licences');
  if (!r.licences) return;
  LICS = r.licences;
  $('auth').style.display = 'none'; $('app').style.display = '';
  $('rows').innerHTML = LICS.map((l) => {
    const state = l.status === 'revoked' ? '<span class="pill bad2">revoked</span>' : l.machines.length ? '<span class="pill ok">in use</span>' : '<span class="pill warn">not activated</span>';
    const comps = l.machines.map((m) => '<div style="margin-bottom:4px"><code>' + esc(m.machine) + '</code>' + (m.hostname ? '<div class="muted">' + esc(m.hostname) + '</div>' : '') + '<div class="muted">' + esc([m.platform, m.version].filter(Boolean).join(' · ')) + '</div></div>').join('') || '<span class="muted">—</span>';
    return '<tr><td><b>' + esc(l.name) + '</b>' + state + (l.email ? '<div class="muted">' + esc(l.email) + '</div>' : '') + '</td>'
      + '<td>' + esc(l.plan) + (l.plan === 'company' ? ' · ' + l.seats + ' seats' : '') + '</td>'
      + '<td><code style="user-select:all">' + esc(l.code) + '</code></td><td>' + comps + '</td>'
      + '<td class="muted">' + esc(l.last_checkin || '—') + '</td><td class="muted" id="until' + l.id + '">' + untilCell(l) + '</td>'
      + '<td class="right">' + (l.status !== 'revoked' ? '<button class="ghost" data-a="extend" data-id="' + l.id + '">Extend</button> ' : '')
      + (l.machines.length ? '<button class="ghost" data-a="release" data-id="' + l.id + '">Free the computer</button> ' : '')
      + (l.status === 'revoked' ? '<button class="ghost" data-a="restore" data-id="' + l.id + '">Restore</button>' : '<button class="bad" data-a="revoke" data-id="' + l.id + '">Revoke</button>') + '</td></tr>';
  }).join('') || '<tr><td colspan="7" class="muted">No licence issued yet.</td></tr>';

  const today = new Date().toISOString().slice(0, 10);
  const tr = await api('/admin/trials');
  $('trials').innerHTML = (tr.trials || []).map((x) => {
    const asked = !!x.asked_at;
    return '<tr><td><code title="' + esc(x.hash) + '">' + esc(x.hash.slice(0, 12)) + '…</code><div class="muted">' + esc([x.platform, x.version].filter(Boolean).join(' · ')) + '</div></td>'
      + '<td class="muted">' + esc(x.first_seen) + '</td><td>' + esc(x.ends) + (x.ends < today ? ' <span class="pill bad2">ended</span>' : ' <span class="pill ok">running</span>') + '</td>'
      + '<td class="muted">' + (x.extra_days ? '+' + esc(x.extra_days) + ' days' + (x.auto_extended ? '<div style="font-size:11px">7 by itself</div>' : '') : '—') + '</td>'
      + '<td class="muted">' + esc(x.last_seen) + '</td>'
      + '<td>' + (asked ? '<span class="pill warn">waiting</span> <span class="muted">' + esc(x.asked_at) + '</span>' : '') + (x.asked_note ? '<div>' + esc(x.asked_note) + '</div>' : (asked ? '' : '<span class="muted">—</span>')) + (x.asked_reply_to ? '<div class="muted">' + esc(x.asked_reply_to) + '</div>' : '') + '</td>'
      + '<td class="right"><button class="ghost" data-a="grant" data-m="' + esc(x.hash) + '" data-d="7">Give 7 days</button> <button class="ghost" data-a="grant" data-m="' + esc(x.hash) + '" data-d="14">14</button>' + (asked ? ' <button class="ghost" data-a="dismiss" data-m="' + esc(x.hash) + '">Set aside</button>' : '') + '</td></tr>';
  }).join('') || '<tr><td colspan="7" class="muted">No evaluation on record yet.</td></tr>';

  const rq = await api('/admin/requests');
  REQS = rq.requests || [];
  $('reqs').innerHTML = REQS.map((x, i) => '<tr><td class="muted" style="white-space:nowrap">' + esc(x.at) + '</td><td>' + esc(x.kind) + '</td>'
    + '<td><b>' + esc(x.name) + '</b><div class="muted">' + esc(x.email) + '</div><div class="muted">' + esc([x.company, x.source].filter(Boolean).join(' · ')) + '</div>' + (x.machine ? '<div class="muted"><code>' + esc(x.machine) + '</code></div>' : '') + '</td>'
    + '<td>' + esc(x.note) + '</td><td>' + (x.mail === 'sent' ? '<span class="pill ok">sent</span>' : x.mail === 'failed' ? '<span class="pill bad2">failed</span>' : '<span class="muted">—</span>') + '</td>'
    + '<td class="right">' + (x.kind !== 'question' ? '<button class="ghost" data-a="prefill" data-i="' + i + '">Prepare the licence</button>' : '') + '</td></tr>').join('') || '<tr><td colspan="6" class="muted">No request yet.</td></tr>';

  const fb = await api('/admin/feedback');
  $('fb').innerHTML = (fb.feedback || []).map((x) => '<tr><td class="muted" style="white-space:nowrap">' + esc(x.at) + (x.level === 'problem' ? ' <span class="warn">⚠</span>' : '') + '</td>'
    + '<td><b>' + esc(x.message) + '</b>' + (x.detail ? '<div class="muted">' + esc(x.detail) + '</div>' : '') + '</td><td>' + esc(x.reply_to) + '</td><td class="muted">' + esc(x.build) + '</td><td class="muted">' + esc(x.place) + '</td></tr>').join('') || '<tr><td colspan="5" class="muted">Nothing yet.</td></tr>';
}
document.addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-a]');
  if (!b) return;
  const a = b.dataset.a, id = Number(b.dataset.id);
  if (a === 'extend') {
    const l = LICS.find((x) => x.id === id);
    $('until' + id).innerHTML = '<div class="row" style="flex-wrap:nowrap"><input type="date" id="xd' + id + '" value="' + esc(l.paid_until || '') + '"><button data-a="save" data-id="' + id + '">Save</button><button class="ghost" data-a="cancel">Cancel</button></div><div class="muted" id="xm' + id + '" style="font-size:11px;margin-top:4px;max-width:270px">The new end date (empty = perpetual). Their app picks it up at its next daily check-in · no new code.</div>';
    return;
  }
  if (a === 'save') { const r = await api('/admin/extend', { id, paid_until: $('xd' + id).value }); if (!r.ok) { $('xm' + id).className = 'bad2'; $('xm' + id).textContent = r.message; return; } return load(); }
  if (a === 'cancel') return load();
  if (a === 'release' && !confirm('Free the computer? The licence can then be activated on another computer.')) return;
  if (a === 'revoke' && !confirm('Revoke this licence? The app stops it at its next check-in.')) return;
  if (a === 'release' || a === 'revoke' || a === 'restore') { await api('/admin/' + a, { id }); return load(); }
  if (a === 'grant') { await api('/admin/trial/grant', { machine: b.dataset.m, days: Number(b.dataset.d) }); return load(); }
  if (a === 'dismiss') { await api('/admin/trial/grant', { machine: b.dataset.m, dismiss: true }); return load(); }
  if (a === 'prefill') {
    const x = REQS[Number(b.dataset.i)];
    $('n').value = x.company ? x.name + ' · ' + x.company : x.name; $('e').value = x.email; $('p').value = x.kind === 'company' ? 'company' : 'personal';
    window.scrollTo({ top: 0, behavior: 'smooth' }); $('n').focus();
  }
});
load().catch(() => {});
</script></body></html>`;
