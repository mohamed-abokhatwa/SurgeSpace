// SurgeSpace licence server rules. Storage-agnostic: the Cloudflare Worker uses D1, the tests and the preview's
// demo mode use memory. Same model as the Engineering Workspace licence server, kept fully separate from it.
import { KEY_DAYS, machineHash, makeCode, newLicenceCode, normaliseLicenceCode, normaliseMachineId, TRIAL_DAYS, type CodePayload } from '../core';

export interface Licence { id: number; code: string; name: string; email: string; plan: 'personal' | 'company'; seats: number; paid_until: string | null; status: 'active' | 'revoked'; created: string }
export interface Machine { licence_id: number; machine: string; hostname: string; platform: string; version: string; first_seen: string; last_checkin: string }
export interface Trial { hash: string; platform: string; version: string; first_seen: string; ends: string; extra_days: number; auto_extended: number; asked_at: string; asked_note: string; asked_reply_to: string; last_seen: string }
export interface LicenceRequest { id: number; at: string; kind: string; name: string; company: string; email: string; note: string; machine: string; source: string; mail: string }
export interface Feedback { id: number; at: string; level: string; message: string; detail: string; reply_to: string; build: string; place: string }

export interface Store {
  licences(): Promise<Licence[]>;
  licenceByCode(code: string): Promise<Licence | null>;
  licenceById(id: number): Promise<Licence | null>;
  addLicence(l: Omit<Licence, 'id'>): Promise<number>;
  updateLicence(id: number, patch: Partial<Licence>): Promise<void>;
  machines(licenceId: number): Promise<Machine[]>;
  machineLicences(machine: string): Promise<Machine[]>;
  putMachine(m: Machine): Promise<void>;
  freeMachines(licenceId: number): Promise<void>;
  trial(hash: string): Promise<Trial | null>;
  trials(): Promise<Trial[]>;
  putTrial(t: Trial): Promise<void>;
  addRequest(r: Omit<LicenceRequest, 'id'>): Promise<number>;
  requests(): Promise<LicenceRequest[]>;
  addFeedback(f: Omit<Feedback, 'id'>): Promise<number>;
  feedback(): Promise<Feedback[]>;
}

export interface Ctx {
  store: Store;
  privateKey: Uint8Array;
  /** Current time (ms). */
  now: number;
  /** Sends a notification email to the seller; returns 'sent', 'failed' or 'off'. */
  mail?: (subject: string, text: string, replyTo?: string) => Promise<string>;
}
export interface Out { status: number; body: Record<string, unknown> }

const ok = (body: Record<string, unknown> = {}): Out => ({ status: 200, body: { ok: true, ...body } });
const no = (error: string, message: string, status = 400): Out => ({ status, body: { ok: false, error, message } });
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const stamp = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const dayOf = (isoDate: string) => Math.floor(Date.parse(isoDate + 'T00:00:00Z') / 86_400_000);
const addDays = (isoDate: string, n: number) => iso(Date.parse(isoDate + 'T00:00:00Z') + n * 86_400_000);
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const mkey = (mid: string) => mid.replace(/^SS-/, '').replace(/-/g, '');

/** The key for a bound computer: runs KEY_DAYS ahead, never past the licence's end. */
async function licenceKey(l: Licence, machine: string, c: Ctx): Promise<string> {
  const today = Math.floor(c.now / 86_400_000);
  const end = l.paid_until ? dayOf(l.paid_until) : null;
  const e = end === null ? today + KEY_DAYS : Math.min(end, today + KEY_DAYS);
  const p: Omit<CodePayload, 'v'> = { m: mkey(machine), p: l.plan, n: l.name, l: l.code, i: today, e, x: end };
  return makeCode(p, c.privateKey);
}
async function trialKey(t: Trial, machine: string, c: Ctx): Promise<string> {
  return makeCode({ m: mkey(machine), p: 'trial', n: 'Evaluation', l: 'EVAL', i: Math.floor(c.now / 86_400_000), e: dayOf(t.ends), x: dayOf(t.ends) }, c.privateKey);
}

// ── app endpoints ────────────────────────────────────────────────────────
export async function appRoute(path: string, b: Record<string, unknown>, c: Ctx): Promise<Out> {
  const s = c.store;
  const machine = normaliseMachineId(str(b.machine));
  const info = { hostname: str(b.hostname, 80), platform: str(b.platform, 60), version: str(b.version, 30) };

  if (path === '/activate') {
    const code = normaliseLicenceCode(str(b.code));
    if (!code) return no('bad-code', 'That is not a SurgeSpace licence code (SSL-XXXX-XXXX-XXXX). Check it and try again.');
    if (!machine) return no('bad-machine', 'Machine ID missing.');
    const l = await s.licenceByCode(code);
    if (!l) return no('unknown-code', 'This licence code was not found. Check it, or contact Engineering Workspace.');
    if (l.status !== 'active') return no('revoked', 'This licence has been cancelled. Contact Engineering Workspace.');
    if (l.paid_until && dayOf(l.paid_until) < Math.floor(c.now / 86_400_000)) return no('expired', `This licence ended on ${l.paid_until}. Contact Engineering Workspace to renew it.`);
    const bound = await s.machines(l.id);
    const mine = bound.find((m) => m.machine === machine);
    const seats = Math.max(1, l.seats || 1);
    if (!mine && bound.length >= seats)
      return no('in-use', seats === 1
        ? 'This licence is already in use on another computer. Ask Engineering Workspace to free it, then activate again.'
        : `All ${seats} computers on this licence are in use. Ask Engineering Workspace to free one.`);
    const keep = Object.fromEntries(Object.entries(info).filter(([, v]) => v));
    await s.putMachine({ licence_id: l.id, machine, hostname: '', platform: '', version: '', ...mine, ...keep, first_seen: mine?.first_seen ?? stamp(c.now), last_checkin: stamp(c.now) });
    return ok({ key: await licenceKey(l, machine, c), name: l.name, until: l.paid_until });
  }

  if (path === '/checkin') {
    if (!machine) return no('bad-machine', 'Machine ID missing.');
    const code = normaliseLicenceCode(str(b.code));
    const l = code ? await s.licenceByCode(code) : null;
    if (!l) return ok({ state: 'unknown' });
    const m = (await s.machines(l.id)).find((x) => x.machine === machine);
    if (l.status !== 'active') return ok({ state: 'revoked', message: 'This licence has been cancelled. Contact Engineering Workspace.' });
    if (!m) return ok({ state: 'freed', message: 'This licence was moved to another computer. Activate it again to use it here.' });
    await s.putMachine({ ...m, ...Object.fromEntries(Object.entries(info).filter(([, v]) => v)), last_checkin: stamp(c.now) });
    return ok({ state: 'active', key: await licenceKey(l, machine, c), until: l.paid_until });
  }

  if (path === '/trial' || path === '/trial/more') {
    if (!machine) return no('bad-machine', 'Machine ID missing.');
    const hash = await machineHash(machine);
    let t = await s.trial(hash);
    const today = iso(c.now);
    // evaluations keep no computer name: only the one-way code, platform and version
    const tinfo = { platform: info.platform, version: info.version };
    if (path === '/trial') {
      if (!t) t = { hash, ...tinfo, first_seen: today, ends: addDays(today, TRIAL_DAYS - 1), extra_days: 0, auto_extended: 0, asked_at: '', asked_note: '', asked_reply_to: '', last_seen: today };
      else t = { ...t, ...Object.fromEntries(Object.entries(tinfo).filter(([, v]) => v)), last_seen: today };
      await s.putTrial(t);
      return ok({ key: await trialKey(t, machine, c), ends: t.ends, ended: t.ends < today });
    }
    // asking for more time: the first request adds 7 days by itself; a later one waits for the seller
    if (!t) return no('no-trial', 'Start the evaluation first.');
    const note = str(b.note, 1000), replyTo = str(b.reply_to, 120);
    if (!t.auto_extended) {
      const base = t.ends < today ? addDays(today, -1) : t.ends;
      t = { ...t, ends: addDays(base, 7), extra_days: t.extra_days + 7, auto_extended: 1, asked_note: note, asked_reply_to: replyTo, last_seen: today };
      await s.putTrial(t);
      return ok({ key: await trialKey(t, machine, c), ends: t.ends, message: `7 more days added. The evaluation now runs to ${t.ends}.` });
    }
    t = { ...t, asked_at: stamp(c.now), asked_note: note, asked_reply_to: replyTo, last_seen: today };
    await s.putTrial(t);
    await c.mail?.(`SurgeSpace: more evaluation time asked`, `A computer (${hash.slice(0, 12)}…, ${t.platform} ${t.version}) asks for more evaluation time.\nRuns to: ${t.ends}\nReply to: ${replyTo || '—'}\n\n${note}`, replyTo || undefined);
    return ok({ ends: t.ends, waiting: true, message: 'Your request was sent. Engineering Workspace will answer soon; the extra days arrive in the app by themselves.' });
  }

  if (path === '/request') {
    const r = { at: stamp(c.now), kind: ['personal', 'company', 'question'].includes(str(b.kind)) ? str(b.kind) : 'personal', name: str(b.name, 120), company: str(b.company, 120), email: str(b.email, 120), note: str(b.note, 2000), machine: machine ?? '', source: str(b.source, 60) || 'app', mail: 'off' };
    if (!r.name || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) return no('bad-request', 'Please give your name and a valid email.');
    if (c.mail) r.mail = await c.mail(`SurgeSpace licence request · ${r.kind} · ${r.name}`, `${r.name}${r.company ? ' · ' + r.company : ''}\n${r.email}\nAsking for: ${r.kind}\nMachine ID: ${r.machine || '—'}\nFrom: ${r.source}\n\n${r.note}`, r.email);
    await s.addRequest(r);
    return ok({ message: 'Thank you. Your request was sent; Engineering Workspace will reply by email.' });
  }

  if (path === '/feedback') {
    const f = { at: stamp(c.now), level: str(b.level, 20) === 'problem' ? 'problem' : 'info', message: str(b.message, 200), detail: str(b.detail, 4000), reply_to: str(b.reply_to, 120), build: str(b.build, 60), place: str(b.where, 120) };
    if (!f.message) return no('empty', 'Please write something.');
    await s.addFeedback(f);
    await c.mail?.(`SurgeSpace: ${f.level === 'problem' ? 'problem reported' : 'message'} · ${f.message}`, `${f.message}\n\n${f.detail}\n\nBuild: ${f.build}\nWhere: ${f.place}\nReply to: ${f.reply_to || '—'}`, f.reply_to || undefined);
    return ok({ message: 'Thank you, your message reached Engineering Workspace.' });
  }
  return no('not-found', 'Unknown address.', 404);
}

// ── admin endpoints (the worker checks the admin token first) ───────────
export async function adminRoute(path: string, b: Record<string, unknown>, c: Ctx): Promise<Out> {
  const s = c.store;
  const id = Number(b.id);
  if (path === '/admin/licences') {
    const ls = await s.licences();
    const rows = await Promise.all(ls.map(async (l) => {
      const ms = await s.machines(l.id);
      const last = ms.map((m) => m.last_checkin).sort().pop() ?? '';
      const today = Math.floor(c.now / 86_400_000);
      const keyEnd = l.paid_until ? Math.min(dayOf(l.paid_until), today + KEY_DAYS) : today + KEY_DAYS;
      return { ...l, machines: ms, last_checkin: last, key_runs_to: ms.length ? iso(keyEnd * 86_400_000) : '' };
    }));
    return ok({ licences: rows.sort((a, b2) => b2.id - a.id) });
  }
  if (path === '/admin/trials') return ok({ trials: (await s.trials()).sort((a, b2) => (b2.asked_at || '').localeCompare(a.asked_at || '') || b2.last_seen.localeCompare(a.last_seen)) });
  if (path === '/admin/requests') return ok({ requests: (await s.requests()).sort((a, b2) => b2.id - a.id) });
  if (path === '/admin/feedback') return ok({ feedback: (await s.feedback()).sort((a, b2) => b2.id - a.id) });
  if (path === '/admin/issue') {
    const name = str(b.name, 120);
    if (!name) return no('bad', 'Give the customer name.');
    const plan = str(b.plan) === 'company' ? 'company' : 'personal';
    const until = str(b.paid_until);
    if (until && until !== 'perpetual' && !isDate(until)) return no('bad', 'Paid until must be YYYY-MM-DD, or empty for perpetual.');
    const seats = plan === 'company' ? Math.max(1, Math.min(500, Number(b.seats) || 2)) : 1;
    let code = newLicenceCode();
    while (await s.licenceByCode(code)) code = newLicenceCode();
    const newId = await s.addLicence({ code, name, email: str(b.email, 120), plan, seats, paid_until: until && until !== 'perpetual' ? until : null, status: 'active', created: stamp(c.now) });
    return ok({ id: newId, code, name });
  }
  if (path === '/admin/extend') {
    const l = await s.licenceById(id);
    const until = str(b.paid_until);
    if (!l) return no('bad', 'Unknown licence.');
    if (until && !isDate(until)) return no('bad', 'Pick a date, or leave it empty for perpetual.');
    await s.updateLicence(id, { paid_until: until || null });
    return ok();
  }
  if (path === '/admin/release') { await s.freeMachines(id); return ok(); }
  if (path === '/admin/revoke') { await s.updateLicence(id, { status: 'revoked' }); return ok(); }
  if (path === '/admin/restore') { await s.updateLicence(id, { status: 'active' }); return ok(); }
  if (path === '/admin/trial/grant') {
    const t = await s.trial(str(b.machine, 64));
    if (!t) return no('bad', 'Unknown computer.');
    if (b.dismiss) { await s.putTrial({ ...t, asked_at: '' }); return ok(); }
    const days = Math.max(1, Math.min(365, Number(b.days) || 7));
    const today = iso(c.now);
    const base = t.ends < today ? addDays(today, -1) : t.ends;
    await s.putTrial({ ...t, ends: addDays(base, days), extra_days: t.extra_days + days, asked_at: '' });
    return ok();
  }
  return no('not-found', 'Unknown address.', 404);
}

/** Days since 1970 → YYYY-MM-DD (for the admin page and messages). */
export const isoDay = (d: number) => iso(d * 86_400_000);
