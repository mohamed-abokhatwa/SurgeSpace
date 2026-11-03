// SurgeSpace licensing core — shared by the app, the licence tool and the command-line script.
//
// Process (offline, by email):
//   1. The app shows this computer's Machine ID, e.g. SS-7K3Q-M9XD-2WPA-H4TN.
//   2. The user emails it to Engineering Workspace.
//   3. Engineering Workspace makes an activation code in the licence tool (needs the private signing key).
//   4. The user pastes the code into the app. The app checks it with the public key: it is valid only on that
//      machine and until its end date. Codes cannot be forged without the private key, which never ships in the app.
import * as ed from '@noble/ed25519';

export type Plan = 'free' | 'trial' | 'pro' | 'enterprise';
export type PaidPlan = 'pro' | 'enterprise';

/** What an activation code contains. Short field names keep the code short. */
export interface CodePayload {
  v: 1;
  /** Machine ID without the "SS-" prefix and dashes (16 characters). */
  m: string;
  p: PaidPlan;
  /** Licensee (company or person). */
  n: string;
  /** Licence number, for your records and support. */
  l: string;
  /** Issued, days since 1970-01-01 (UTC). */
  i: number;
  /** Last valid day, days since 1970-01-01; null = no end date. */
  e: number | null;
}

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
  if (!p) return { ok: false, reason: 'invalid', message: 'This activation code is not valid. Copy the whole code from the email, from "SSA-" to the end.' };
  if (p.m !== midKey(machineId)) return { ok: false, reason: 'other-machine', message: `This code was made for another computer (SS-${p.m.match(/.{4}/g)!.join('-')}). Send your Machine ID to get a code for this computer.`, payload: p };
  if (p.e !== null && day > p.e) return { ok: false, reason: 'expired', message: `This licence ended on ${dayToDate(p.e).toLocaleDateString()}. Contact Engineering Workspace to renew it.`, payload: p };
  return { ok: true, payload: p, daysLeft: p.e === null ? null : p.e - day + 1 };
}

/** New signing key pair (the licence tool does this once). */
export async function newKeyPair() {
  const sk = ed.utils.randomSecretKey();
  return { privateKey: hex(sk), publicKey: hex(await ed.getPublicKeyAsync(sk)) };
}
export const publicKeyOf = async (privateKeyHex: string) => hex(await ed.getPublicKeyAsync(fromHex(privateKeyHex)));

// ── online status file (periodic check) ──────────────────────────────────
// A small signed file you upload to the licence site (e.g. https://lic.engspace.app/surgespace/status.txt).
// It lists cancelled licence numbers only (no names or emails). The app downloads it every few days; the
// signature means nobody can replace it with a fake one.
export interface StatusFile {
  v: 1;
  /** Day the file was made (days since 1970). */
  d: number;
  /** Cancelled licence numbers. */
  r: string[];
}
export async function makeStatus(revoked: string[], privateKey: Uint8Array, day = today()): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ v: 1, d: day, r: [...new Set(revoked.map((x) => x.trim()).filter(Boolean))] } satisfies StatusFile)));
  return `SSS-${body}.${b64url(await ed.signAsync(enc.encode(body), privateKey))}`;
}
export async function readStatus(text: string, publicKey: Uint8Array): Promise<StatusFile | null> {
  const [body, sig] = text.replace(/\s+/g, '').replace(/^SSS-/, '').split('.');
  if (!body || !sig) return null;
  try {
    if (!(await ed.verifyAsync(fromB64url(sig), enc.encode(body), publicKey))) return null;
    const s = JSON.parse(dec.decode(fromB64url(body))) as StatusFile;
    return s?.v === 1 && Array.isArray(s.r) ? s : null;
  } catch {
    return null;
  }
}
