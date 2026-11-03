// SurgeSpace licensing core, shared by the app and the licence server (lic.engspace.app/surgespace).
//
//   • The seller issues a licence code (SSL-XXXX-XXXX-XXXX) on the server's admin page.
//   • The app sends the code and its Machine ID; the server binds the computer and returns a KEY: a small
//     Ed25519-signed record (machine, plan, licensee, dates). The app checks the key itself with the public key,
//     so it works offline; the key runs at most 60 days ahead and moves forward at each daily check-in.
//   • Evaluations (trials) are keys of plan "trial" issued by the server, one per computer.
import * as ed from '@noble/ed25519';

export type Plan = 'free' | 'trial' | 'personal' | 'company';
export type PaidPlan = 'personal' | 'company';

/** What an activation code contains. Short field names keep the code short. */
export interface CodePayload {
  v: 1;
  /** Machine ID without the "SS-" prefix and dashes (16 characters). */
  m: string;
  p: PaidPlan | 'trial';
  /** Licensee (company or person). */
  n: string;
  /** Licence number, for your records and support. */
  l: string;
  /** Issued, days since 1970-01-01 (UTC). */
  i: number;
  /** Last day this key is valid (days since 1970-01-01); null = no end. At most 60 days ahead for licences. */
  e: number | null;
  /** Last day of the licence that was sold (shown to the user); null = perpetual. */
  x?: number | null;
}
/** How far ahead a licence key runs; daily check-ins move it forward until the licence's end. */
export const KEY_DAYS = 60;

export const TRIAL_DAYS = 14;
export const DAY_MS = 86_400_000;
export const today = (ms = Date.now()) => Math.floor(ms / DAY_MS);
export const dayToDate = (d: number) => new Date(d * DAY_MS);

export interface Features {
  /** Largest own model (pipes) that can be run; Infinity = no limit. Built-in examples always run. */
  maxPipes: number;
  exportFiles: boolean;
  protectionSizing: boolean;
  uncertainty: boolean;
}
export function features(plan: Plan): Features {
  if (plan === 'free') return { maxPipes: 25, exportFiles: false, protectionSizing: false, uncertainty: false };
  return { maxPipes: Infinity, exportFiles: true, protectionSizing: true, uncertainty: true };
}

// ── encoding helpers ─────────────────────────────────────────────────────
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
export const fromHex = (h: string) => Uint8Array.from(h.trim().match(/../g) ?? [], (x) => parseInt(x, 16));

// ── Machine ID: SS-XXXX-XXXX-XXXX-XXXX, Crockford base32, last character is a check symbol ──
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const check = (s: string) => B32[[...s].reduce((a, c) => (a * 31 + B32.indexOf(c)) % 32, 7)];
const clean = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');

/** Machine ID from any stable device bytes (at least 10). */
export function machineIdFrom(bytes: Uint8Array): string {
  const body = Array.from(bytes.slice(0, 15), (b) => B32[b % 32]).join('');
  const all = body + check(body);
  return 'SS-' + all.match(/.{4}/g)!.join('-');
}
/** Accepts typed or pasted IDs (any case, spaces, O/0 and I/1 mix-ups); null when the check symbol fails. */
export function normaliseMachineId(input: string): string | null {
  let s = clean(input);
  if (s.startsWith('SS') && s.length === 18) s = s.slice(2);
  if (s.length !== 16 || [...s].some((c) => !B32.includes(c)) || check(s.slice(0, 15)) !== s[15]) return null;
  return 'SS-' + s.match(/.{4}/g)!.join('-');
}
const midKey = (id: string) => id.replace(/^SS-/, '').replace(/-/g, '');

// ── activation codes: "SSA-" base64url(payload) "." base64url(Ed25519 signature) ──
export async function makeCode(p: Omit<CodePayload, 'v'>, privateKey: Uint8Array): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ v: 1, ...p })));
  const sig = await ed.signAsync(enc.encode(body), privateKey);
  return `SSA-${body}.${b64url(sig)}`;
}

/** Signature check only. Line breaks and spaces from email clients are ignored. */
export async function readCode(code: string, publicKey: Uint8Array): Promise<CodePayload | null> {
  const s = code.replace(/\s+/g, '').replace(/^SSA-/, '');
  const [body, sig] = s.split('.');
  if (!body || !sig) return null;
  try {
    if (!(await ed.verifyAsync(fromB64url(sig), enc.encode(body), publicKey))) return null;
    const p = JSON.parse(dec.decode(fromB64url(body))) as CodePayload;
    return p?.v === 1 && typeof p.m === 'string' ? p : null;
  } catch {
    return null;
  }
}

export type CodeCheck =
  | { ok: true; payload: CodePayload; daysLeft: number | null }
  | { ok: false; reason: 'invalid' | 'other-machine' | 'expired'; message: string; payload?: CodePayload };

/** Full check of a code for this machine on day `day`. */
export async function checkCode(code: string, publicKey: Uint8Array, machineId: string, day: number): Promise<CodeCheck> {
  const p = await readCode(code, publicKey);
  if (!p) return { ok: false, reason: 'invalid', message: 'The stored licence key is not valid.' };
  if (p.m !== midKey(machineId)) return { ok: false, reason: 'other-machine', message: `This code was made for another computer (SS-${p.m.match(/.{4}/g)!.join('-')}). Activate the licence again on this computer.`, payload: p };
  if (p.e !== null && day > p.e) return { ok: false, reason: 'expired', message: p.p === 'trial' ? 'The evaluation has ended.' : (p.x !== undefined && p.x !== null && day > p.x) ? `This licence ended on ${dayToDate(p.x).toLocaleDateString()}. Contact Engineering Workspace to renew it.` : 'SurgeSpace could not check the licence online for a long time. Connect to the internet so it can check in.', payload: p };
  return { ok: true, payload: p, daysLeft: p.e === null ? null : p.e - day + 1 };
}

/** New signing key pair (the licence tool does this once). */
export async function newKeyPair() {
  const sk = ed.utils.randomSecretKey();
  return { privateKey: hex(sk), publicKey: hex(await ed.getPublicKeyAsync(sk)) };
}
export const publicKeyOf = async (privateKeyHex: string) => hex(await ed.getPublicKeyAsync(fromHex(privateKeyHex)));

/** Licence codes: SSL-XXXX-XXXX-XXXX (what the seller gives the customer). */
export function newLicenceCode(random: Uint8Array = crypto.getRandomValues(new Uint8Array(11))): string {
  const body = Array.from(random.slice(0, 11), (b) => B32[b % 32]).join('');
  return 'SSL-' + (body + check(body)).match(/.{4}/g)!.join('-');
}
export function normaliseLicenceCode(input: string): string | null {
  // strip the prefix before correcting look-alike letters (the L in "SSL" would otherwise become a 1)
  const s = clean(input.trim().replace(/^ssl[\s-]*/i, ''));
  if (s.length !== 12 || [...s].some((c) => !B32.includes(c)) || check(s.slice(0, 11)) !== s[11]) return null;
  return 'SSL-' + s.match(/.{4}/g)!.join('-');
}
/** One-way code for a computer (evaluations are stored by this, never by the Machine ID). */
export async function machineHash(machineId: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('surgespace-eval:' + machineId)))).slice(0, 32);
}
