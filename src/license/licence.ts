// SurgeSpace licence client.
//  • Web and Mac: licence keys. The licence server signs a token bound to this device; the app checks it offline
//    and refreshes it quietly every 7 days (it keeps working up to 30 days offline).
//  • Windows (Microsoft Store build): the Store's own licence (free app + "SurgeSpace Pro" subscription add-on).
//  • No licence server configured (preview builds): an in-browser demo server so the whole flow can be tried.
import * as ed from '@noble/ed25519';
import {
  checkToken, DAY, features, fromHex, handleRequest, hashKey, hex, newLicenseKey,
  type Features, type LicensePayload, type LicenseStore, type Plan, type Request, type Response,
} from '../../supabase/functions/_shared/licenseCore';

const API = import.meta.env.VITE_LICENSE_API as string | undefined;
const PUBKEY = import.meta.env.VITE_LICENSE_PUBKEY as string | undefined;
export const BUY_URL = (import.meta.env.VITE_BUY_URL as string | undefined) ?? 'https://engspace.app/surgespace';
export const STORE_PRO_ADDON = (import.meta.env.VITE_STORE_PRO_ADDON as string | undefined) ?? '';
export const DEMO = !API;

export interface LicenceState {
  plan: Plan;
  source: 'key' | 'store' | 'demo' | 'none';
  features: Features;
  /** Licensee and dates for the dialog. */
  payload?: LicensePayload;
  /** Days left in a trial or before a subscription ends. */
  daysLeft?: number;
  /** Something the user should know (expired, offline too long …). */
  notice?: string;
  checking: boolean;
}

const TOKEN_KEY = 'surgespace.licence';
const DEVICE_KEY = 'surgespace.device';
const ls = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* storage blocked */ } },
};
const nowS = () => Math.floor(Date.now() / 1000);

// ── desktop bridge (Tauri) ───────────────────────────────────────────────
const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}
interface StoreLicence { active: boolean; isTrial: boolean; trialDaysLeft: number; proActive: boolean; proIsTrial: boolean; proExpires: number | null }
interface Platform { store: boolean; deviceId?: string; deviceName?: string }
let platformP: Promise<Platform> | null = null;
const platform = (): Promise<Platform> =>
  (platformP ??= isTauri()
    ? invoke<Platform>('licence_platform').catch((): Platform => ({ store: false }))
    : Promise.resolve<Platform>({ store: false }));

// ── device id: random, kept by this browser profile (desktop: derived from the machine id by the app) ──
async function device(): Promise<{ id: string; name: string }> {
  const p = await platform();
  if (p.deviceId) return { id: p.deviceId, name: p.deviceName ?? 'Desktop' };
  let id = ls.get(DEVICE_KEY);
  if (!id) { id = hex(crypto.getRandomValues(new Uint8Array(16))); ls.set(DEVICE_KEY, id); }
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const name = /Mac/.test(ua) ? 'Mac · browser' : /Windows/.test(ua) ? 'Windows · browser' : 'Browser';
  return { id, name };
}

// ── demo licence server (only when no real server is configured) ─────────
const DEMO_KEY = 'surgespace.demo';
interface DemoDb { sk: string; lic: Parameters<LicenseStore['upsertActivation']>[0][]; licenses: { id: string; key_hash: string; plan: 'pro'; seats: number; email: string; name: string; expires_at: number; status: 'active' }[]; trials: { id: string; email: string; device_id: string; started_at: number }[]; demoKey: string }
async function demoDb(): Promise<DemoDb> {
  const raw = ls.get(DEMO_KEY);
  if (raw) return JSON.parse(raw);
  const demoKey = newLicenseKey();
  const db: DemoDb = {
    sk: hex(ed.utils.randomSecretKey()), lic: [], trials: [], demoKey,
    licenses: [{ id: 'demo', key_hash: await hashKey(demoKey), plan: 'pro', seats: 2, email: 'demo@engspace.app', name: 'Demo licence', expires_at: nowS() + 365 * DAY, status: 'active' }],
  };
  ls.set(DEMO_KEY, JSON.stringify(db));
  return db;
}
export async function demoKey() { return DEMO ? (await demoDb()).demoKey : null; }
async function demoPublicKey() { return ed.getPublicKeyAsync(fromHex((await demoDb()).sk)); }
async function demoCall(req: Request): Promise<Response> {
  const db = await demoDb();
  const save = () => ls.set(DEMO_KEY, JSON.stringify(db));
  const store: LicenseStore = {
    licenseByHash: async (h) => db.licenses.find((l) => l.key_hash === h) ?? null,
    licenseById: async (id) => db.licenses.find((l) => l.id === id) ?? null,
    activations: async (id) => db.lic.filter((a) => a.license_id === id),
    upsertActivation: async (a) => { db.lic = [...db.lic.filter((x) => !(x.license_id === a.license_id && x.device_id === a.device_id)), a]; save(); },
    removeActivation: async (id, d) => { db.lic = db.lic.filter((x) => !(x.license_id === id && x.device_id === d)); save(); },
    trialFor: async (e, d) => db.trials.find((x) => x.email === e || x.device_id === d) ?? null,
    createTrial: async (t) => { db.trials.push(t); save(); },
  };
  const sk = fromHex(db.sk);
  return handleRequest(req, store, sk, await ed.getPublicKeyAsync(sk), nowS());
}

async function call(req: Request): Promise<Response> {
  if (DEMO) return demoCall(req);
  try {
    const r = await fetch(API!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
    return (await r.json()) as Response;
  } catch {
    return { ok: false, error: 'offline', message: 'Could not reach the licence server. Check the internet connection and try again.' };
  }
}
const publicKey = async () => (DEMO ? demoPublicKey() : fromHex(PUBKEY ?? ''));

// ── state ────────────────────────────────────────────────────────────────
let state: LicenceState = { plan: 'free', source: 'none', features: features('free'), checking: true };
const subs = new Set<() => void>();
const set = (s: Partial<LicenceState>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };
export const getLicence = () => state;
export const subscribeLicence = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

async function applyToken(token: string | null, quietRefresh = true): Promise<void> {
  if (!token) { set({ plan: 'free', source: 'none', features: features('free'), payload: undefined, daysLeft: undefined, checking: false }); return; }
  const dev = await device();
  const r = await checkToken(token, await publicKey(), dev.id, nowS());
  if (!r.ok) {
    const notice = r.reason === 'expired' ? (r.payload?.plan === 'trial' ? 'Your 14-day trial has ended.' : 'Your licence has expired.')
      : r.reason === 'offline-too-long' ? 'SurgeSpace needs to check your licence online (it has been offline for more than 30 days).'
      : r.reason === 'other-device' ? 'This licence was activated on another device.' : 'The stored licence is not valid.';
    // offline too long: try to refresh before giving up
    if (r.reason === 'offline-too-long' && quietRefresh) { if (await refresh()) return; }
    set({ plan: 'free', source: 'none', features: features('free'), payload: r.payload, notice, daysLeft: undefined, checking: false });
    return;
  }
  const p = r.payload;
  set({ plan: p.plan, source: DEMO ? 'demo' : 'key', features: features(p.plan), payload: p, daysLeft: p.exp ? Math.max(0, Math.ceil((p.exp - nowS()) / DAY)) : undefined, notice: undefined, checking: false });
  if (r.needsRefresh && quietRefresh) void refresh();
}

async function applyStore(): Promise<void> {
  try {
    const s = await invoke<StoreLicence>('store_licence', { proAddon: STORE_PRO_ADDON });
    const plan: Plan = s.proActive ? (s.proIsTrial ? 'trial' : 'pro') : 'free';
    set({ plan, source: 'store', features: features(plan), daysLeft: s.proExpires ? Math.max(0, Math.ceil((s.proExpires - nowS()) / DAY)) : undefined, notice: undefined, checking: false, payload: undefined });
  } catch (e) {
    set({ plan: 'free', source: 'store', features: features('free'), notice: `Could not read the Microsoft Store licence (${(e as Error).message ?? e}).`, checking: false });
  }
}

/** Call once at start-up. */
export async function initLicence(): Promise<void> {
  if ((await platform()).store) return applyStore();
  return applyToken(ls.get(TOKEN_KEY));
}

async function take(r: Response): Promise<Response> {
  if (r.ok && r.token) { ls.set(TOKEN_KEY, r.token); await applyToken(r.token, false); }
  return r;
}
export async function activate(key: string): Promise<Response> {
  const d = await device();
  return take(await call({ action: 'activate', key, deviceId: d.id, deviceName: d.name }));
}
export async function startTrial(email: string): Promise<Response> {
  const d = await device();
  return take(await call({ action: 'trial', email, deviceId: d.id, deviceName: d.name }));
}
/** Quiet background refresh; true when a fresh token was stored. */
export async function refresh(): Promise<boolean> {
  const token = ls.get(TOKEN_KEY);
  if (!token) return false;
  const r = await call({ action: 'refresh', token });
  if (r.ok && r.token) { await take(r); return true; }
  // a definite "no" from the server ends the licence on this device; being offline does not
  if (!r.ok && r.error !== 'offline' && r.error !== 'server') { ls.del(TOKEN_KEY); set({ plan: 'free', source: 'none', features: features('free'), notice: r.message, payload: undefined }); }
  return false;
}
export async function deactivate(): Promise<Response> {
  const token = ls.get(TOKEN_KEY);
  const r = token ? await call({ action: 'deactivate', token }) : { ok: true as const };
  if (r.ok) { ls.del(TOKEN_KEY); set({ plan: 'free', source: 'none', features: features('free'), payload: undefined, daysLeft: undefined, notice: undefined }); }
  return r;
}
/** Microsoft Store build: open the Store purchase dialog for the Pro add-on. */
export async function storePurchase(): Promise<string> {
  const status = await invoke<string>('store_purchase', { storeId: STORE_PRO_ADDON });
  await applyStore();
  return status;
}
export const planLabel = (s: LicenceState) =>
  s.plan === 'free' ? 'Free' : s.plan === 'trial' ? `Trial · ${s.daysLeft ?? 0} day${s.daysLeft === 1 ? '' : 's'} left` : s.plan === 'pro' ? 'Pro' : 'Enterprise';
