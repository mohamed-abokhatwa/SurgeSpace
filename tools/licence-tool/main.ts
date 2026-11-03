// SurgeSpace Licence Tool — runs offline in a browser on the licence manager's own computer.
import { checkCode, dayToDate, fromHex, makeCode, makeStatus, newKeyPair, normaliseMachineId, publicKeyOf, readCode, today, type CodePayload } from '../../src/license/core';

interface Entry { l: string; n: string; email: string; mid: string; p: string; i: number; e: number | null; notes: string; code: string; cancelled?: boolean }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const REG = 'surgespace-tool.register', KEY = 'surgespace-tool.key';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
let priv: Uint8Array | null = null;
let pubHex = '';
let reg: Entry[] = JSON.parse(store.get(REG) ?? '[]');
const saveReg = () => store.set(REG, JSON.stringify(reg));
const fmt = (d: number | null) => (d === null ? 'No end date' : dayToDate(d).toISOString().slice(0, 10));
const download = (name: string, text: string, type = 'text/plain') => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const pickFile = (accept: string) => new Promise<string>((res) => {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept;
  i.onchange = () => i.files?.[0]?.text().then(res);
  i.click();
});

// ── signing key ──
async function useKey(hexKey: string) {
  const k = hexKey.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (k.length !== 64) { alert('That file does not contain a SurgeSpace signing key.'); return; }
  priv = fromHex(k);
  pubHex = await publicKeyOf(k);
  if ($<HTMLInputElement>('remember').checked) store.set(KEY, k); else store.del(KEY);
  $('keyState').innerHTML = `<span class="ok">Signing key loaded</span> · public key ${pubHex.slice(0, 8)}…`;
  $('pubKey').textContent = pubHex;
  $('pubOut').hidden = false;
  $<HTMLButtonElement>('makeBtn').disabled = false;
  void showCheck();
}
$('loadKey').onclick = async () => {
  const t = await pickFile('.txt,.key');
  const m = t.match(/[0-9a-f]{64}/i);
  if (m) await useKey(m[0]); else alert('No signing key found in that file.');
};
$('newKey').onclick = async () => {
  if (priv && !confirm('A key is already loaded. A new key means codes made with the old key will not work in app builds that use the new public key. Continue?')) return;
  const kp = await newKeyPair();
  download('surgespace-signing-key.txt', `SurgeSpace private signing key — KEEP SECRET, never send it to anyone.\nWhoever has this file can make SurgeSpace licences.\n\nPrivate key: ${kp.privateKey}\nPublic key (goes in the app): ${kp.publicKey}\nCreated: ${new Date().toISOString()}\n`);
  await useKey(kp.privateKey);
  alert('The key file "surgespace-signing-key.txt" was downloaded. Keep it safe and make a backup copy. Send only the PUBLIC key to your developer.');
};
$<HTMLInputElement>('remember').onchange = (e) => {
  const on = (e.target as HTMLInputElement).checked;
  if (on && priv) store.set(KEY, Array.from(priv, (b) => b.toString(16).padStart(2, '0')).join('')); else store.del(KEY);
};

// ── issue ──
const nextNumber = () => {
  const y = new Date().getFullYear();
  const n = reg.filter((r) => r.l.startsWith(`SS-${y}-`)).map((r) => Number(r.l.split('-')[2]) || 0);
  return `SS-${y}-${String((n.length ? Math.max(...n) : 0) + 1).padStart(4, '0')}`;
};
$<HTMLInputElement>('lno').value = nextNumber();
$<HTMLButtonElement>('makeBtn').disabled = true;
$<HTMLInputElement>('mid').oninput = () => {
  const v = $<HTMLInputElement>('mid').value;
  const m = normaliseMachineId(v);
  const prev = m ? reg.filter((r) => r.mid === m && !r.cancelled) : [];
  $('midState').innerHTML = !v ? '' : m ? `<span class="ok">Valid: ${m}</span>${prev.length ? ` · <span class="muted">already has ${prev.map((r) => r.l).join(', ')}</span>` : ''}` : '<span class="bad">Not a valid Machine ID (check for a typing mistake)</span>';
};
$<HTMLSelectElement>('dur').onchange = () => { $('untilWrap').hidden = $<HTMLSelectElement>('dur').value !== 'date'; };
let last: Entry | null = null;
$<HTMLFormElement>('issue').onsubmit = async (ev) => {
  ev.preventDefault();
  const msg = $('issueMsg');
  if (!priv) { msg.innerHTML = '<span class="bad">Load the signing key first.</span>'; return; }
  const mid = normaliseMachineId($<HTMLInputElement>('mid').value);
  if (!mid) { msg.innerHTML = '<span class="bad">Check the Machine ID.</span>'; return; }
  const l = $<HTMLInputElement>('lno').value.trim();
  if (reg.some((r) => r.l === l)) { msg.innerHTML = `<span class="bad">Licence number ${l} is already in the register.</span>`; return; }
  const i = today();
  const dur = $<HTMLSelectElement>('dur').value;
  let e: number | null;
  if (dur === 'date') {
    const d = $<HTMLInputElement>('until').valueAsDate;
    if (!d) { msg.innerHTML = '<span class="bad">Pick the last valid day.</span>'; return; }
    e = Math.floor(d.getTime() / 86_400_000);
  } else if (dur === '0') e = null;
  else { const d = new Date(); d.setUTCMonth(d.getUTCMonth() + Number(dur)); e = Math.floor(d.getTime() / 86_400_000) - 1; }
  const p: Omit<CodePayload, 'v'> = { m: mid.replace(/^SS-/, '').replace(/-/g, ''), p: $<HTMLSelectElement>('plan').value as CodePayload['p'], n: $<HTMLInputElement>('name').value.trim(), l, i, e };
  const code = await makeCode(p, priv);
  last = { l, n: p.n, email: $<HTMLInputElement>('email').value.trim(), mid, p: p.p, i, e, notes: $<HTMLInputElement>('notes').value.trim(), code };
  reg.unshift(last);
  saveReg();
  $<HTMLTextAreaElement>('code').value = code;
  $('codeOut').hidden = false;
  msg.innerHTML = `<span class="ok">Code made for ${mid}, valid until ${fmt(e)}.</span>`;
  $<HTMLInputElement>('lno').value = nextNumber();
  render();
};
const copy = async (text: string, note: string) => {
  try { await navigator.clipboard.writeText(text); $('copyMsg').textContent = note; } catch { $('copyMsg').textContent = 'Select the text and copy it manually.'; }
  setTimeout(() => ($('copyMsg').textContent = ''), 2000);
};
$('copyCode').onclick = () => copy($<HTMLTextAreaElement>('code').value, 'Code copied');
$('copyMail').onclick = () => last && copy(
  `Subject: Your SurgeSpace licence ${last.l}\n\nHello,\n\nThank you for choosing SurgeSpace. Here is your activation code for the computer with Machine ID ${last.mid}:\n\n${last.code}\n\nTo activate: open SurgeSpace, click the plan badge next to the SurgeSpace name (top left), paste the code under "Paste the activation code" and press Activate.\n\nLicence: ${last.l}\nLicensee: ${last.n}\nPlan: ${last.p === 'pro' ? 'Pro' : 'Enterprise'}\nValid until: ${fmt(last.e)}\n\nThe code works only on that computer. If you move to a new computer, reply with its Machine ID.\n\nBest regards,\nEngineering Workspace\nhttps://engspace.app`,
  'Reply email copied');

// ── check a code ──
async function showCheck() {
  const v = $<HTMLTextAreaElement>('checkIn').value.trim();
  const out = $('checkOut');
  if (!v) { out.innerHTML = ''; return; }
  if (!priv) { out.innerHTML = '<span class="bad">Load the signing key to check codes.</span>'; return; }
  const pub = fromHex(pubHex);
  const p = await readCode(v, pub);
  if (!p) { out.innerHTML = '<span class="bad">Not a valid code for your key (edited, incomplete or made with another key).</span>'; return; }
  const mid = `SS-${p.m.match(/.{4}/g)!.join('-')}`;
  const c = await checkCode(v, pub, mid, today());
  const r = reg.find((x) => x.l === p.l);
  out.innerHTML = `<div class="${c.ok ? 'ok' : 'bad'}">${c.ok ? 'Valid code' : c.message}</div>
    <div>Licence <b>${p.l}</b> · ${p.n} · ${p.p}</div><div>Machine ${mid}</div><div>Issued ${fmt(p.i)} · last day ${fmt(p.e)}</div>
    ${r ? `<div class="muted">In register${r.cancelled ? ' — CANCELLED' : ''}${r.email ? ` · ${r.email}` : ''}</div>` : '<div class="muted">Not in this register.</div>'}`;
}
$<HTMLTextAreaElement>('checkIn').oninput = () => void showCheck();

// ── register ──
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function render() {
  const q = $<HTMLInputElement>('search').value.toLowerCase();
  const rows = reg.filter((r) => !q || [r.l, r.n, r.email, r.mid, r.notes].join(' ').toLowerCase().includes(q));
  const d = today();
  $('reg').innerHTML = rows.map((r) => `<tr class="${r.cancelled ? 'cancelled' : ''}">
    <td class="mono">${esc(r.l)}</td><td>${esc(r.n)}</td><td>${esc(r.email)}</td><td class="mono">${esc(r.mid)}</td><td>${r.p}</td><td>${fmt(r.i)}</td>
    <td class="${r.e !== null && r.e < d ? 'bad' : ''}">${fmt(r.e)}</td><td>${esc(r.notes)}</td>
    <td><button data-l="${esc(r.l)}" data-act="copy">Code</button> <button data-l="${esc(r.l)}" data-act="${r.cancelled ? 'restore' : 'cancel'}">${r.cancelled ? 'Restore' : 'Cancel'}</button></td></tr>`).join('')
    || '<tr><td colspan="9" class="muted">No licences yet.</td></tr>';
}
$('reg').onclick = (e) => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  const r = reg.find((x) => x.l === b.dataset.l);
  if (!r) return;
  if (b.dataset.act === 'copy') { void navigator.clipboard.writeText(r.code).catch(() => prompt('Copy the code:', r.code)); return; }
  if (b.dataset.act === 'cancel' && !confirm(`Cancel licence ${r.l} (${r.n})? It stops after the next status file is uploaded and the app checks it.`)) return;
  r.cancelled = b.dataset.act === 'cancel';
  saveReg();
  render();
};
$<HTMLInputElement>('search').oninput = render;
const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const COLS: (keyof Entry)[] = ['l', 'n', 'email', 'mid', 'p', 'i', 'e', 'notes', 'cancelled', 'code'];
$('exportCsv').onclick = () => download(`surgespace-licences-${new Date().toISOString().slice(0, 10)}.csv`,
  ['licence,licensee,email,machine_id,plan,issued,last_day,notes,cancelled,code', ...reg.map((r) => COLS.map((c) => csvCell(c === 'i' ? fmt(r.i) : c === 'e' ? fmt(r.e) : r[c])).join(','))].join('\n'), 'text/csv');
$('importCsv').onclick = async () => {
  const t = await pickFile('.csv');
  const rows = t.split(/\r?\n/).slice(1).filter(Boolean).map((line) => [...line.matchAll(/"((?:[^"]|"")*)"|([^,]+)|(?<=,|^)(?=,|$)/g)].map((m) => (m[1] ?? m[2] ?? '').replace(/""/g, '"')));
  const day = (s: string) => (s === 'No end date' || !s ? null : Math.floor(new Date(s).getTime() / 86_400_000));
  let added = 0;
  for (const c of rows) {
    if (!c[0] || reg.some((r) => r.l === c[0])) continue;
    reg.push({ l: c[0], n: c[1], email: c[2], mid: c[3], p: c[4], i: day(c[5]) ?? today(), e: day(c[6]), notes: c[7], cancelled: c[8] === 'true', code: c[9] });
    added++;
  }
  saveReg(); render();
  alert(`${added} licence(s) added.`);
};
$('makeStatus').onclick = async () => {
  if (!priv) { alert('Load the signing key first.'); return; }
  const cancelled = reg.filter((r) => r.cancelled).map((r) => r.l);
  download('status.txt', await makeStatus(cancelled, priv));
  alert(`status.txt made (${cancelled.length} cancelled licence${cancelled.length === 1 ? '' : 's'}). Upload it to lic.engspace.app/surgespace/status.txt, replacing the old one.`);
};

render();
const saved = store.get(KEY);
if (saved) { $<HTMLInputElement>('remember').checked = true; void useKey(saved); }
