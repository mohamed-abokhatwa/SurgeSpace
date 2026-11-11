// SurgeSpace licence state in the app (same model as Engineering Workspace):
//  • the user enters a licence code; the server binds this computer and returns a signed key
//  • the key runs up to 60 days ahead and moves forward at the daily check-in (so the app works offline)
//  • evaluations are tracked by the server per computer; "ask for more time" adds 7 days the first time
import * as ed from '@noble/ed25519';
import { checkCode, features, fromHex, hex, machineIdFrom, normaliseLicenceCode, today, type CodePayload, type Features, type Plan } from './core';
import { CHECKIN_HOURS, CONTACT_EMAIL, LICENCE_API, PUBLIC_KEY } from './publicKey';
import { adminRoute, appRoute, type Ctx } from './server/logic';
import { emptyData, memoryStore, type MemoryData } from './server/memoryStore';

/** Demo mode: the licence server's rules run inside the app (preview pages and tests). Set by a missing key, or by
 *  building with VITE_LICENCE_DEMO=1 — so a demo build never needs the key edited out of the source. */
export const DEMO = !PUBLIC_KEY || (typeof import.meta.env !== 'undefined' && import.meta.env.VITE_LICENCE_DEMO === '1');
export { CONTACT_EMAIL };
export const APP_VERSION = '3.0.0';

export interface LicenceState {
  plan: Plan;
  source: 'licence' | 'trial' | 'none';
  features: Features;
  machineId: string;
  payload?: CodePayload;
  /** Licence code on this computer. */
  code?: string;
  /** Days left of the licence (or evaluation); null = perpetual. */
  daysLeft?: number | null;
  trialUsed: boolean;
  trialEnded: boolean;
  lastCheckin?: string;
  notice?: string;
  checking: boolean;
}
type Result = { ok: boolean; message: string };

// ── storage (browser storage + a file in the app's data folder on the desktop) ──
const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}
const local = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* blocked */ } },
};
async function get(k: string): Promise<string | null> {
  if (isTauri()) { try { const v = await invoke<string | null>('kv_get', { key: k }); if (v) return v; } catch { /* fall back */ } }
  return local.get(k);
}
async function put(k: string, v: string | null) {
  if (v === null) local.del(k); else local.set(k, v);
  if (isTauri()) { try { await invoke('kv_set', { key: k, value: v }); } catch { /* browser storage still has it */ } }
}
const K = { code: 'surgespace.code', key: 'surgespace.key', trial: 'surgespace.trial', seen: 'surgespace.seen', checked: 'surgespace.checked', device: 'surgespace.device' };

// ── Machine ID and platform ──────────────────────────────────────────────
let midP: Promise<string> | null = null;
export const machineId = () => (midP ??= (async () => {
  if (isTauri()) { try { return machineIdFrom(fromHex(await invoke<string>('device_id'))); } catch { /* fall back */ } }
  let d = local.get(K.device);
  if (!d) { d = hex(crypto.getRandomValues(new Uint8Array(16))); local.set(K.device, d); }
  return machineIdFrom(fromHex(d));
})());
const platformName = () => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return (/Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Other') + (isTauri() ? '' : ' · browser');
};
async function hostName(): Promise<string> {
  if (isTauri()) { try { return await invoke<string>('host_name'); } catch { /* none */ } }
  return '';
}

/** Today, never earlier than the latest day seen (winding the clock back does not extend a key). */
async function safeToday(): Promise<number> {
  const seen = Number(await get(K.seen)) || 0;
  const d = Math.max(today(), seen);
  if (d > seen) await put(K.seen, String(d));
  return d;
}

// ── server calls (or the same rules inside the app in demo mode) ─────────
const DEMO_DB = 'surgespace.demoServer';
interface DemoServer { sk: string; data: MemoryData }
function demoServer(): DemoServer {
  const raw = local.get(DEMO_DB);
  if (raw) return JSON.parse(raw);
  const s: DemoServer = { sk: hex(ed.utils.randomSecretKey()), data: emptyData() };
  local.set(DEMO_DB, JSON.stringify(s));
  return s;
}
function demoCtx(): Ctx {
  const s = demoServer();
  return { store: memoryStore(s.data, (d) => local.set(DEMO_DB, JSON.stringify({ ...s, data: d }))), privateKey: fromHex(s.sk), now: Date.now(), mail: async () => 'off' };
}
/** Demo builds: issue a licence as the seller would on the admin page, and return its code. */
export async function demoIssue(plan: 'personal' | 'company' = 'personal'): Promise<string> {
  const r = await adminRoute('/admin/issue', { name: 'Demo customer', email: 'demo@example.com', plan, paid_until: new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10), seats: 2 }, demoCtx());
  return String(r.body.code ?? '');
}
async function call(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> & { ok: boolean; message?: string }> {
  if (DEMO) return (await appRoute(path, body, demoCtx())).body as never;
  try {
    const r = await fetch(LICENCE_API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch {
    return { ok: false, error: 'offline', message: 'Could not reach the licence server. Check the internet connection and try again.' };
  }
}
const publicKey = async () => (DEMO ? ed.getPublicKeyAsync(fromHex(demoServer().sk)) : fromHex(PUBLIC_KEY));

// ── state ────────────────────────────────────────────────────────────────
let state: LicenceState = { plan: 'free', source: 'none', features: features('free'), machineId: '', trialUsed: false, trialEnded: false, checking: true };
const subs = new Set<() => void>();
const set = (s: Partial<LicenceState>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };
export const getLicence = () => state;
export const subscribeLicence = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

async function evaluate(notice?: string): Promise<void> {
  const mid = await machineId();
  const day = await safeToday();
  const pub = await publicKey();
  const code = (await get(K.code)) ?? undefined;
  const key = await get(K.key);
  const trial = await get(K.trial);
  const lastCheckin = (await get(K.checked)) ?? undefined;
  let trialUsed = !!trial, trialEnded = false;
  if (key) {
    const r = await checkCode(key, pub, mid, day);
    if (r.ok) {
      const x = r.payload.x;
      set({ plan: r.payload.p, source: 'licence', features: features(r.payload.p), machineId: mid, payload: r.payload, code, daysLeft: x === null || x === undefined ? null : x - day + 1, trialUsed, trialEnded, lastCheckin, notice, checking: false });
      return;
    }
    notice ??= r.message;
  }
  if (trial) {
    const r = await checkCode(trial, pub, mid, day);
    if (r.ok) { set({ plan: 'trial', source: 'trial', features: features('trial'), machineId: mid, payload: r.payload, code, daysLeft: r.daysLeft, trialUsed, trialEnded, lastCheckin, notice, checking: false }); return; }
    trialEnded = true;
    notice ??= 'The evaluation has ended. Ask for more time, or request a licence.';
  }
  set({ plan: 'free', source: 'none', features: features('free'), machineId: mid, payload: undefined, code, daysLeft: undefined, trialUsed, trialEnded, lastCheckin, notice, checking: false });
}

/** Daily check-in: refreshes the licence key (or the evaluation), and picks up extensions or cancellations. */
export async function checkIn(force = false): Promise<Result> {
  const last = Date.parse((await get(K.checked)) ?? '') || 0;
  if (!force && Date.now() - last < CHECKIN_HOURS * 3600_000) return { ok: true, message: 'Checked recently.' };
  const machine = await machineId();
  const info = { machine, hostname: await hostName(), platform: platformName(), version: APP_VERSION };
  const code = await get(K.code);
  if (code) {
    const r = await call('/checkin', { ...info, code });
    if (!r.ok) { await evaluate(); return { ok: false, message: r.message ?? 'Check-in failed.' }; }
    if (r.state === 'active' && typeof r.key === 'string') {
      await put(K.key, r.key); await put(K.checked, new Date().toISOString());
      await evaluate();
      return { ok: true, message: 'Licence checked: it is valid.' };
    }
    if (r.state === 'revoked' || r.state === 'freed' || r.state === 'unknown') {
      await put(K.key, null);
      if (r.state !== 'freed') await put(K.code, null);
      await put(K.checked, new Date().toISOString());
      await evaluate(String(r.message ?? 'The licence is no longer valid on this computer.'));
      return { ok: false, message: String(r.message ?? 'The licence is no longer valid.') };
    }
  } else if (await get(K.trial)) {
    const r = await call('/trial', info);
    if (r.ok && typeof r.key === 'string') { await put(K.trial, r.key); await put(K.checked, new Date().toISOString()); }
    await evaluate();
    return { ok: !!r.ok, message: r.ok ? `Evaluation runs to ${r.ends}.` : r.message ?? '' };
  }
  return { ok: true, message: '' };
}

/** Call once at start-up. */
export async function initLicence() {
  await evaluate();
  void checkIn();
}

export async function activate(codeIn: string): Promise<Result> {
  const code = normaliseLicenceCode(codeIn);
  if (!code) return { ok: false, message: 'That is not a SurgeSpace licence code (SSL-XXXX-XXXX-XXXX). Check it and try again.' };
  const machine = await machineId();
  const r = await call('/activate', { code, machine, hostname: await hostName(), platform: platformName(), version: APP_VERSION });
  if (!r.ok || typeof r.key !== 'string') return { ok: false, message: r.message ?? 'Activation failed.' };
  const check = await checkCode(r.key, await publicKey(), machine, await safeToday());
  if (!check.ok) return { ok: false, message: 'The licence server answered with a key this app cannot verify. Update SurgeSpace or contact support.' };
  await put(K.code, code); await put(K.key, r.key); await put(K.checked, new Date().toISOString());
  await evaluate();
  return { ok: true, message: `Licence activated for ${r.name}${r.until ? `, until ${r.until}` : ''}.` };
}
export async function startTrial(): Promise<Result> {
  const r = await call('/trial', { machine: await machineId(), platform: platformName(), version: APP_VERSION });
  if (!r.ok || typeof r.key !== 'string') return { ok: false, message: r.message ?? 'Could not start the evaluation.' };
  await put(K.trial, r.key); await put(K.checked, new Date().toISOString());
  await evaluate();
  return r.ended ? { ok: false, message: 'The evaluation on this computer has already ended. Ask for more time, or request a licence.' } : { ok: true, message: `Your evaluation runs to ${r.ends}. Every feature is unlocked.` };
}
export async function askMoreTime(note: string, replyTo: string): Promise<Result> {
  const r = await call('/trial/more', { machine: await machineId(), note, reply_to: replyTo });
  if (r.ok && typeof r.key === 'string') await put(K.trial, r.key);
  await evaluate();
  return { ok: !!r.ok, message: r.message ?? '' };
}
export async function requestLicence(f: { kind: string; name: string; company: string; email: string; note: string }): Promise<Result> {
  const r = await call('/request', { ...f, machine: await machineId(), source: `app ${APP_VERSION} · ${platformName()}` });
  return { ok: !!r.ok, message: r.message ?? '' };
}
export async function sendFeedback(f: { message: string; detail: string; reply_to: string; level: string; where: string }): Promise<Result> {
  const r = await call('/feedback', { ...f, build: `${APP_VERSION} ${platformName()}` });
  return { ok: !!r.ok, message: r.message ?? '' };
}
/** Removes the licence from this computer only (the seller frees the seat on the server). */
export async function removeLicence(): Promise<void> {
  await put(K.key, null); await put(K.code, null);
  await evaluate();
}

export const planLabel = (s: LicenceState) =>
  s.plan === 'free' ? 'Free' : s.plan === 'trial' ? `Evaluation · ${s.daysLeft ?? 0} day${s.daysLeft === 1 ? '' : 's'} left` : s.plan === 'personal' ? 'Personal' : 'Company';

/** Opens a link outside the app (mail client or browser). */
export async function openExternal(url: string) {
  if (isTauri()) { try { const op = await import('@tauri-apps/plugin-opener'); await op.openUrl(url); return; } catch { /* fall back */ } }
  window.open(url, '_blank', 'noopener');
}
