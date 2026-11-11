// AI accounts kept on this device. Keys are encrypted with AES-GCM under a device key that cannot be exported
// (it lives in IndexedDB as a non-extractable CryptoKey), so the stored text is useless if copied elsewhere.
import { useSyncExternalStore } from 'react';
import type { AIConfig } from './providers';

export interface AIAccount { id: string; provider: string; model: string; baseUrl?: string; label?: string; enc?: string; iv?: string }
export interface AIState { accounts: AIAccount[]; active?: string; consent: boolean }

const LS = 'surgespace.ai';
let state: AIState = load();
const subs = new Set<() => void>();
function load(): AIState {
  try { const s = localStorage.getItem(LS); if (s) return { consent: false, ...JSON.parse(s) }; } catch { /* storage blocked */ }
  return { accounts: [], consent: false };
}
function save() {
  try { localStorage.setItem(LS, JSON.stringify(state)); } catch { /* storage blocked */ }
  subs.forEach((f) => f());
}
export const getAI = () => state;
export const useAI = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, getAI, getAI);

// ── device key ──
let keyP: Promise<CryptoKey | null> | null = null;
function deviceKey(): Promise<CryptoKey | null> {
  if (keyP) return keyP;
  keyP = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || !crypto?.subtle) return resolve(null);
      const req = indexedDB.open('surgespace-keys', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('k');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('k', 'readonly');
        const g = tx.objectStore('k').get('device');
        g.onsuccess = async () => {
          if (g.result) return resolve(g.result as CryptoKey);
          const k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
          const tw = db.transaction('k', 'readwrite');
          tw.objectStore('k').put(k, 'device');
          tw.oncomplete = () => resolve(k);
          tw.onerror = () => resolve(null);
        };
        g.onerror = () => resolve(null);
      };
    } catch { resolve(null); }
  });
  return keyP;
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// keys kept only in memory when the device key is unavailable (private window)
const memKeys = new Map<string, string>();

async function encrypt(plain: string): Promise<{ enc: string; iv: string } | null> {
  const k = await deviceKey();
  if (!k) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain)));
  return { enc: b64(c), iv: b64(iv) };
}
async function decrypt(a: AIAccount): Promise<string | undefined> {
  if (memKeys.has(a.id)) return memKeys.get(a.id);
  if (!a.enc || !a.iv) return undefined;
  const k = await deviceKey();
  if (!k) return undefined;
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(a.iv) }, k, unb64(a.enc))); } catch { return undefined; }
}

export async function saveAccount(a: Omit<AIAccount, 'enc' | 'iv'>, apiKey?: string) {
  let acc: AIAccount = { ...state.accounts.find((x) => x.id === a.id), ...a };
  if (apiKey !== undefined) {
    if (apiKey) {
      const e = await encrypt(apiKey);
      if (e) { acc = { ...acc, ...e }; memKeys.delete(a.id); } else { memKeys.set(a.id, apiKey); delete acc.enc; delete acc.iv; }
    } else { delete acc.enc; delete acc.iv; memKeys.delete(a.id); }
  }
  const accounts = state.accounts.some((x) => x.id === a.id) ? state.accounts.map((x) => (x.id === a.id ? acc : x)) : [...state.accounts, acc];
  state = { ...state, accounts, active: state.active ?? acc.id };
  save();
}
export function removeAccount(id: string) {
  memKeys.delete(id);
  const accounts = state.accounts.filter((a) => a.id !== id);
  state = { ...state, accounts, active: state.active === id ? accounts[0]?.id : state.active };
  save();
}
export function setActive(id: string) { state = { ...state, active: id }; save(); }
export function setConsent(v: boolean) { state = { ...state, consent: v }; save(); }
export const hasKey = (a: AIAccount) => !!a.enc || memKeys.has(a.id);

/** Configuration of the active account with its key, ready for chat(). */
export async function activeConfig(): Promise<AIConfig | null> {
  const a = state.accounts.find((x) => x.id === state.active) ?? state.accounts[0];
  if (!a) return null;
  return { provider: a.provider, model: a.model, baseUrl: a.baseUrl, apiKey: await decrypt(a) };
}
export async function configOf(a: AIAccount): Promise<AIConfig> { return { provider: a.provider, model: a.model, baseUrl: a.baseUrl, apiKey: await decrypt(a) }; }
