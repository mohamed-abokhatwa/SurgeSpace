// SurgeSpace licence server (Supabase Edge Function).
// POST JSON { action: 'activate' | 'refresh' | 'deactivate' | 'trial', ... } → { ok, token?, message? }
// Secrets: LICENSE_PRIVATE_KEY (Ed25519 secret key, 64 hex characters). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from '@supabase/supabase-js';
import * as ed from '@noble/ed25519';
import { fromHex, handleRequest, type LicenseStore, type Request } from '../_shared/licenseCore.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const priv = fromHex(Deno.env.get('LICENSE_PRIVATE_KEY') ?? '');
const pubP = ed.getPublicKeyAsync(priv);
const secs = (t: string | null) => (t ? Math.floor(new Date(t).getTime() / 1000) : null);
const iso = (s: number) => new Date(s * 1000).toISOString();

const store: LicenseStore = {
  async licenseByHash(h) {
    const { data } = await db.from('ss_licenses').select('*').eq('key_hash', h).maybeSingle();
    return data ? { ...data, expires_at: secs(data.expires_at) } : null;
  },
  async licenseById(id) {
    const { data } = await db.from('ss_licenses').select('*').eq('id', id).maybeSingle();
    return data ? { ...data, expires_at: secs(data.expires_at) } : null;
  },
  async activations(id) {
    const { data } = await db.from('ss_activations').select('*').eq('license_id', id);
    return (data ?? []).map((a) => ({ ...a, last_seen: secs(a.last_seen)! }));
  },
  async upsertActivation(a) {
    await db.from('ss_activations').upsert({ ...a, last_seen: iso(a.last_seen) });
  },
  async removeActivation(id, dev) {
    await db.from('ss_activations').delete().eq('license_id', id).eq('device_id', dev);
  },
  async trialFor(email, dev) {
    const { data } = await db.from('ss_trials').select('*').or(`email.eq.${JSON.stringify(email)},device_id.eq.${dev}`).order('started_at').limit(1);
    const t = data?.[0];
    return t ? { ...t, started_at: secs(t.started_at)! } : null;
  },
  async createTrial(t) {
    await db.from('ss_trials').insert({ ...t, started_at: iso(t.started_at) });
  },
};

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, authorization, apikey', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method', message: 'POST only' }, 405);
  if (priv.length !== 32) return json({ ok: false, error: 'config', message: 'Licence server is not configured.' }, 500);
  let body: Request;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad-request', message: 'Invalid JSON' }, 400); }
  try {
    return json(await handleRequest(body, store, priv, await pubP, Math.floor(Date.now() / 1000)));
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: 'server', message: 'The licence server had a problem. Try again in a minute.' }, 500);
  }
});
