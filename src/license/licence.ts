// SurgeSpace licence state in the app. Fully offline: a licence is an activation code made for this computer's
// Machine ID; the trial is 14 days kept on this computer. See core.ts for the process.
import * as ed from '@noble/ed25519';
import { checkCode, features, fromHex, hex, machineIdFrom, makeCode, readStatus, today, TRIAL_DAYS, type CodePayload, type Features, type Plan } from './core';
import { CHECK_EVERY_DAYS, LICENCE_EMAIL, OFFLINE_DAYS, PUBLIC_KEY, STATUS_URL } from './publicKey';

export const DEMO = !PUBLIC_KEY;
export { LICENCE_EMAIL };

export interface LicenceState {
  plan: Plan;
  source: 'code' | 'trial' | 'none';
  features: Features;
  machineId: string;
  payload?: CodePayload;
  /** Days left (licence or trial); null = no end date. */
  daysLeft?: number | null;
  /** Trial already used on this computer. */
  trialUsed: boolean;
  /** Last successful online check (day number), when online checks are on. */
  lastCheck?: number;
  notice?: string;
  checking: boolean;
}

// ── storage: browser storage, plus a file in the app's data folder on the desktop app ──
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
const K = { code: 'surgespace.code', trial: 'surgespace.trial', seen: 'surgespace.seen', device: 'surgespace.device', demo: 'surgespace.demoKey', checked: 'surgespace.checked' };
/** Online check only for real (non-demo) builds with a status address. */
const ONLINE = !DEMO && !!STATUS_URL;

// ── Machine ID ───────────────────────────────────────────────────────────
let midP: Promise<string> | null = null;
export const machineId = () => (midP ??= (async () => {
  if (isTauri()) {
    try { return machineIdFrom(fromHex(await invoke<string>('device_id'))); } catch { /* fall back */ }
  }
  let d = local.get(K.device);
  if (!d) { d = hex(crypto.getRandomValues(new Uint8Array(16))); local.set(K.device, d); }
  return machineIdFrom(fromHex(d));
})());

/** Today, but never earlier than the latest day the app has seen (setting the clock back does not extend a licence). */
async function safeToday(): Promise<number> {
  const seen = Number(await get(K.seen)) || 0;
  const d = Math.max(today(), seen);
  if (d > seen) await put(K.seen, String(d));
  return d;
}

// ── keys: the real public key, or a demo pair kept in this browser ───────
async function demoPrivate(): Promise<Uint8Array> {
  let k = local.get(K.demo);
  if (!k) { k = hex(ed.utils.randomSecretKey()); local.set(K.demo, k); }
  return fromHex(k);
}
const publicKey = async () => (DEMO ? ed.getPublicKeyAsync(await demoPrivate()) : fromHex(PUBLIC_KEY));
/** Demo builds only: make a code for this computer, as the licence tool would. */
export async function demoCode(months: number): Promise<string> {
  if (!DEMO) throw new Error('Not a demo build');
  const d = today();
  return makeCode({ m: (await machineId()).replace(/^SS-/, '').replace(/-/g, ''), p: 'pro', n: 'Demo licence', l: 'DEMO-1', i: d, e: months > 0 ? d + Math.round(months * 30.44) - 1 : null }, await demoPrivate());
}

// ── state ────────────────────────────────────────────────────────────────
let state: LicenceState = { plan: 'free', source: 'none', features: features('free'), machineId: '', trialUsed: false, checking: true };
const subs = new Set<() => void>();
const set = (s: Partial<LicenceState>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };
export const getLicence = () => state;
export const subscribeLicence = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

async function evaluate(): Promise<void> {
  const mid = await machineId();
  const day = await safeToday();
  const trialStart = Number(await get(K.trial)) || 0;
  const trialUsed = trialStart > 0;
  const code = await get(K.code);
  let notice: string | undefined;
  if (code) {
    const r = await checkCode(code, await publicKey(), mid, day);
    const last = Number(await get(K.checked)) || 0;
    if (r.ok && ONLINE && last && day - last > OFFLINE_DAYS) {
      notice = `SurgeSpace needs to check your licence online (last check ${day - last} days ago). Connect to the internet and press "Check licence now".`;
    } else if (r.ok) {
      set({ plan: r.payload.p, source: 'code', features: features(r.payload.p), machineId: mid, payload: r.payload, daysLeft: r.daysLeft, trialUsed, lastCheck: last || undefined, notice: undefined, checking: false });
      return;
    } else notice = r.message;
  }
  if (trialUsed) {
    const left = trialStart + TRIAL_DAYS - day;
    if (left > 0) { set({ plan: 'trial', source: 'trial', features: features('trial'), machineId: mid, payload: undefined, daysLeft: left, trialUsed, notice, checking: false }); return; }
    notice ??= 'Your 14-day trial has ended. Send your Machine ID to get a licence.';
  }
  set({ plan: 'free', source: 'none', features: features('free'), machineId: mid, payload: undefined, daysLeft: undefined, trialUsed, notice, checking: false });
}

/** Downloads the signed status file and drops a cancelled licence. Returns a message for the dialog. */
export async function checkOnline(force = false): Promise<{ ok: boolean; message: string }> {
  if (!ONLINE) return { ok: true, message: 'Online checks are off in this build.' };
  const code = await get(K.code);
  if (!code) return { ok: true, message: 'No licence on this computer.' };
  const day = await safeToday();
  const last = Number(await get(K.checked)) || 0;
  if (!force && last && day - last < CHECK_EVERY_DAYS) return { ok: true, message: 'Checked recently.' };
  let text: string;
  try {
    const r = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    text = await r.text();
  } catch {
    return { ok: false, message: 'Could not reach the licence site. SurgeSpace keeps working offline and will try again later.' };
  }
  const st = await readStatus(text, await publicKey());
  if (!st) return { ok: false, message: 'The licence site answered with something unexpected. Try again later.' };
  const r = await checkCode(code, await publicKey(), await machineId(), day);
  if (r.payload && st.r.includes(r.payload.l)) {
    await put(K.code, null);
    await evaluate();
    set({ notice: `Licence ${r.payload.l} has been cancelled. Contact Engineering Workspace (${LICENCE_EMAIL}).` });
    return { ok: false, message: 'This licence has been cancelled.' };
  }
  await put(K.checked, String(day));
  await evaluate();
  return { ok: true, message: 'Licence checked online: it is valid.' };
}

/** Call once at start-up: reads the stored licence, then checks online in the background when it is due. */
export async function initLicence() {
  await evaluate();
  if (ONLINE) void checkOnline();
}

/** Checks and stores a pasted activation code. */
export async function enterCode(code: string): Promise<{ ok: boolean; message: string }> {
  const r = await checkCode(code, await publicKey(), await machineId(), await safeToday());
  if (!r.ok) return { ok: false, message: r.message };
  await put(K.code, code.replace(/\s+/g, ''));
  await put(K.checked, String(await safeToday())); // the offline allowance starts from activation
  await evaluate();
  if (ONLINE) void checkOnline(true);
  return { ok: true, message: `Licence activated for ${r.payload.n}${r.daysLeft === null ? '' : `, valid until ${new Date((r.payload.e! + 1) * 86_400_000 - 1).toLocaleDateString()}`}.` };
}
export async function startTrial(): Promise<{ ok: boolean; message: string }> {
  if (Number(await get(K.trial))) return { ok: false, message: 'The trial has already been used on this computer.' };
  await put(K.trial, String(await safeToday()));
  await evaluate();
  return { ok: true, message: 'Your 14-day trial has started. Every feature is unlocked.' };
}
/** Removes the activation code from this computer (for example before replacing the computer). */
export async function removeCode(): Promise<void> {
  await put(K.code, null);
  await evaluate();
}

export const planLabel = (s: LicenceState) =>
  s.plan === 'free' ? 'Free' : s.plan === 'trial' ? `Trial · ${s.daysLeft ?? 0} day${s.daysLeft === 1 ? '' : 's'} left` : s.plan === 'pro' ? 'Pro' : 'Enterprise';

/** Email the user can send, ready to paste. */
export const requestEmail = (mid: string) => ({
  to: LICENCE_EMAIL,
  subject: `SurgeSpace licence request · ${mid}`,
  body: `Hello,\n\nPlease send me a SurgeSpace licence for this computer.\n\nMachine ID: ${mid}\nName / company:\nLicence wanted (e.g. Pro, 1 year):\n\nThank you`,
});

/** Opens a link outside the app (mail client or browser). */
export async function openExternal(url: string) {
  if (isTauri()) { try { const op = await import('@tauri-apps/plugin-opener'); await op.openUrl(url); return; } catch { /* fall back */ } }
  window.open(url, '_blank', 'noopener');
}
