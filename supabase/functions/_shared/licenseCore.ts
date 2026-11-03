// SurgeSpace licensing core, shared by the app (verifies tokens offline) and the licence server (issues them).
// Pure TypeScript: only WebCrypto (SHA-256) and @noble/ed25519 (signatures), so it runs in browsers, Node and Deno.
import * as ed from '@noble/ed25519';

export type Plan = 'free' | 'trial' | 'pro' | 'enterprise';

/** What a signed activation token says. Short field names keep the token small. */
export interface LicensePayload {
  v: 1;
  /** Licence id (or "trial:<id>" for trials). */
  lid: string;
  plan: Exclude<Plan, 'free'>;
  /** Devices allowed on this licence. */
  seats: number;
  email: string;
  /** Licensee shown in the app (company or person). */
  name?: string;
  /** Device the token is bound to. */
  dev: string;
  /** Issued at, epoch seconds. */
  iat: number;
  /** Licence end (subscription end or trial end), epoch seconds; null = perpetual. */
  exp: number | null;
  /** The app must refresh online before this time (offline grace), epoch seconds. */
  rby: number;
}

export const TRIAL_DAYS = 14;
/** Days the app keeps working offline between online checks. */
export const OFFLINE_GRACE_DAYS = 30;
/** The app refreshes quietly in the background once a token is this old. */
export const REFRESH_AFTER_DAYS = 7;
export const DAY = 86400;

export interface Features {
  /** Largest model (pipes) that can be run; Infinity = no limit. Built-in examples always run. */
  maxPipes: number;
  exportFiles: boolean;
  protectionSizing: boolean;
  uncertainty: boolean;
}

export function features(plan: Plan): Features {
  if (plan === 'free') return { maxPipes: 25, exportFiles: false, protectionSizing: false, uncertainty: false };
  return { maxPipes: Infinity, exportFiles: true, protectionSizing: true, uncertainty: true };
}

// ── encoding ─────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();
export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s: string): Uint8Array {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

// ── tokens: base64url(payload JSON) "." base64url(Ed25519 signature) ─────
export async function signToken(p: LicensePayload, privateKey: Uint8Array): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(p)));
  const sig = await ed.signAsync(enc.encode(body), privateKey);
  return `${body}.${b64url(sig)}`;
}

/** Returns the payload when the signature is valid, otherwise null. Does not check dates or device. */
export async function verifyToken(token: string, publicKey: Uint8Array): Promise<LicensePayload | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await ed.verifyAsync(fromB64url(sig), enc.encode(body), publicKey);
    if (!ok) return null;
    const p = JSON.parse(dec.decode(fromB64url(body))) as LicensePayload;
    return p && p.v === 1 ? p : null;
  } catch {
    return null;
  }
}

export type TokenState =
  | { ok: true; payload: LicensePayload; needsRefresh: boolean }
  | { ok: false; reason: 'invalid' | 'other-device' | 'expired' | 'offline-too-long'; payload?: LicensePayload };

/** Full offline check of a stored token for this device at time `now` (epoch seconds). */
export async function checkToken(token: string, publicKey: Uint8Array, deviceId: string, now: number): Promise<TokenState> {
  const p = await verifyToken(token, publicKey);
  if (!p) return { ok: false, reason: 'invalid' };
  if (p.dev !== deviceId) return { ok: false, reason: 'other-device', payload: p };
  if (p.exp !== null && now > p.exp) return { ok: false, reason: 'expired', payload: p };
  if (now > p.rby) return { ok: false, reason: 'offline-too-long', payload: p };
  return { ok: true, payload: p, needsRefresh: now - p.iat > REFRESH_AFTER_DAYS * DAY };
}

// ── licence keys: SSPC-XXXXX-XXXXX-XXXXX-XXXXX (Crockford base32, last character a check symbol) ──
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const check = (s: string) => B32[[...s].reduce((a, c) => (a * 31 + B32.indexOf(c)) % 32, 7)];

export function newLicenseKey(random: Uint8Array = crypto.getRandomValues(new Uint8Array(19))): string {
  const body = Array.from(random.slice(0, 19), (b) => B32[b % 32]).join('');
  const all = body + check(body);
  return 'SSPC-' + all.match(/.{5}/g)!.join('-');
}

/** Upper-cases, fixes look-alike characters (O→0, I/L→1) and checks the check symbol. */
export function normaliseKey(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
  const s = raw.startsWith('SSPC') ? raw.slice(4) : raw;
  if (s.length !== 20 || [...s].some((c) => !B32.includes(c))) return null;
  if (check(s.slice(0, 19)) !== s[19]) return null;
  return 'SSPC-' + s.match(/.{5}/g)!.join('-');
}

export async function hashKey(key: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(key))));
}

// ── server logic (storage-agnostic, so it is tested in Node and deployed on Supabase) ─────────
export interface LicenseRow {
  id: string;
  key_hash: string;
  plan: 'pro' | 'enterprise';
  seats: number;
  email: string;
  name: string | null;
  /** epoch seconds or null */
  expires_at: number | null;
  status: 'active' | 'revoked';
}
export interface ActivationRow { license_id: string; device_id: string; device_name: string; last_seen: number }
export interface TrialRow { id: string; email: string; device_id: string; started_at: number }

export interface LicenseStore {
  licenseByHash(hash: string): Promise<LicenseRow | null>;
  licenseById(id: string): Promise<LicenseRow | null>;
  activations(licenseId: string): Promise<ActivationRow[]>;
  upsertActivation(a: ActivationRow): Promise<void>;
  removeActivation(licenseId: string, deviceId: string): Promise<void>;
  /** Any earlier trial for this email OR this device (one trial per person and per machine). */
  trialFor(email: string, deviceId: string): Promise<TrialRow | null>;
  createTrial(t: TrialRow): Promise<void>;
}

export type Request =
  | { action: 'activate'; key: string; deviceId: string; deviceName?: string }
  | { action: 'refresh'; token: string }
  | { action: 'deactivate'; token: string }
  | { action: 'trial'; email: string; deviceId: string; deviceName?: string };
export type Response = { ok: true; token?: string; message?: string } | { ok: false; error: string; message: string };

const fail = (error: string, message: string): Response => ({ ok: false, error, message });
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const devOk = (d: unknown): d is string => typeof d === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(d);

export async function handleRequest(req: Request, store: LicenseStore, privateKey: Uint8Array, publicKey: Uint8Array, now: number): Promise<Response> {
  const issue = async (lic: LicenseRow, dev: string) =>
    signToken({ v: 1, lid: lic.id, plan: lic.plan, seats: lic.seats, email: lic.email, name: lic.name ?? undefined, dev, iat: now, exp: lic.expires_at, rby: now + OFFLINE_GRACE_DAYS * DAY }, privateKey);
  const usable = (lic: LicenseRow | null): Response | null => {
    if (!lic) return fail('unknown-key', 'This licence key was not found. Check it and try again.');
    if (lic.status !== 'active') return fail('revoked', 'This licence has been cancelled. Contact support@engspace.app.');
    if (lic.expires_at !== null && now > lic.expires_at) return fail('expired', 'This licence has expired. Renew it to continue.');
    return null;
  };

  if (req.action === 'activate') {
    const key = normaliseKey(req.key ?? '');
    if (!key) return fail('bad-key', 'That does not look like a SurgeSpace key (SSPC-XXXXX-XXXXX-XXXXX-XXXXX).');
    if (!devOk(req.deviceId)) return fail('bad-device', 'Device id missing.');
    const lic = await store.licenseByHash(await hashKey(key));
    const bad = usable(lic);
    if (bad) return bad;
    const acts = await store.activations(lic!.id);
    if (!acts.some((a) => a.device_id === req.deviceId) && acts.length >= lic!.seats)
      return fail('seats-full', `This licence is already active on ${acts.length} device${acts.length > 1 ? 's' : ''}. Deactivate one of them first (Licence → Deactivate this device).`);
    await store.upsertActivation({ license_id: lic!.id, device_id: req.deviceId, device_name: (req.deviceName ?? '').slice(0, 80), last_seen: now });
    return { ok: true, token: await issue(lic!, req.deviceId) };
  }

  if (req.action === 'refresh' || req.action === 'deactivate') {
    const p = await verifyToken(req.token ?? '', publicKey);
    if (!p) return fail('invalid-token', 'The stored licence is not valid. Activate again.');
    if (p.lid.startsWith('trial:')) {
      if (req.action === 'deactivate') return { ok: true, message: 'Trial removed from this device.' };
      if (p.exp !== null && now > p.exp) return fail('expired', 'Your trial has ended.');
      return { ok: true, token: await signToken({ ...p, iat: now, rby: Math.min(p.exp ?? Infinity, now + OFFLINE_GRACE_DAYS * DAY) }, privateKey) };
    }
    const lic = await store.licenseById(p.lid);
    const acts = lic ? await store.activations(lic.id) : [];
    if (!acts.some((a) => a.device_id === p.dev)) return fail('not-activated', 'This device is no longer activated on the licence. Activate it again.');
    if (req.action === 'deactivate') {
      await store.removeActivation(p.lid, p.dev);
      return { ok: true, message: 'This device is deactivated. You can now activate the licence on another device.' };
    }
    const bad = usable(lic);
    if (bad) return bad;
    await store.upsertActivation({ ...acts.find((a) => a.device_id === p.dev)!, last_seen: now });
    return { ok: true, token: await issue(lic!, p.dev) };
  }

  if (req.action === 'trial') {
    const email = (req.email ?? '').trim().toLowerCase();
    if (!emailOk(email)) return fail('bad-email', 'Enter a valid work email to start the trial.');
    if (!devOk(req.deviceId)) return fail('bad-device', 'Device id missing.');
    let t = await store.trialFor(email, req.deviceId);
    if (!t) {
      t = { id: hex(crypto.getRandomValues(new Uint8Array(8))), email, device_id: req.deviceId, started_at: now };
      await store.createTrial(t);
    }
    const end = t.started_at + TRIAL_DAYS * DAY;
    if (now > end) return fail('trial-used', 'The free trial has already been used. Buy a licence to continue.');
    return { ok: true, token: await signToken({ v: 1, lid: `trial:${t.id}`, plan: 'trial', seats: 1, email, dev: req.deviceId, iat: now, exp: end, rby: end }, privateKey) };
  }
  return fail('bad-request', 'Unknown action.');
}
