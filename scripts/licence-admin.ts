// SurgeSpace licence admin. Run with: npx tsx scripts/licence-admin.ts <command> [options]
//   keygen <file>                      new Ed25519 key pair: secret key written to <file> (keep it private),
//                                      public key printed (put it in VITE_LICENSE_PUBKEY)
//   issue --email E [--name N] [--plan pro|enterprise] [--seats 2] [--years 1|0] [--order REF]
//                                      creates a licence and prints the key (years 0 = perpetual)
//   revoke --id ID | --email E         cancels licence(s)
//   list [--email E]                   licences with their activations
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment for issue / revoke / list.
import { writeFileSync } from 'fs';
import * as ed from '@noble/ed25519';
import { hashKey, hex, newLicenseKey } from '../supabase/functions/_shared/licenseCore';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = rest.indexOf(`--${k}`); return i >= 0 ? rest[i + 1] : d; };
const url = process.env.SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const rest_ = async (path: string, init: RequestInit = {}) => {
  if (!url || !svc) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  const r = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: svc, authorization: `Bearer ${svc}`, 'content-type': 'application/json', prefer: 'return=representation', ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};

if (cmd === 'keygen') {
  const file = rest[0];
  if (!file) throw new Error('Give a file for the secret key.');
  const sk = ed.utils.randomSecretKey();
  writeFileSync(file, hex(sk) + '\n', { mode: 0o600 });
  console.log(`Secret key written to ${file}. Set it on the server:\n  supabase secrets set LICENSE_PRIVATE_KEY=$(cat ${file})`);
  console.log(`Public key (VITE_LICENSE_PUBKEY): ${hex(await ed.getPublicKeyAsync(sk))}`);
} else if (cmd === 'issue') {
  const email = opt('email');
  if (!email) throw new Error('--email is required');
  const years = Number(opt('years', '1'));
  const key = newLicenseKey();
  const [row] = await rest_('ss_licenses', { method: 'POST', body: JSON.stringify({
    key_hash: await hashKey(key), plan: opt('plan', 'pro'), seats: Number(opt('seats', '2')), email, name: opt('name') ?? null, order_ref: opt('order') ?? null,
    expires_at: years > 0 ? new Date(Date.now() + years * 365.25 * 86400e3).toISOString() : null,
  }) });
  console.log(`Licence ${row.id} for ${email} (${row.plan}, ${row.seats} devices, ${row.expires_at ? 'until ' + row.expires_at.slice(0, 10) : 'perpetual'})\nKey: ${key}\nThe key is not stored anywhere else: send it to the customer now.`);
} else if (cmd === 'revoke') {
  const q = opt('id') ? `id=eq.${opt('id')}` : `email=eq.${encodeURIComponent(opt('email') ?? '')}`;
  const rows = await rest_(`ss_licenses?${q}`, { method: 'PATCH', body: JSON.stringify({ status: 'revoked' }) });
  console.log(`Revoked ${rows.length} licence(s). Devices stop working at their next online check (at most 30 days).`);
} else if (cmd === 'list') {
  const q = opt('email') ? `&email=eq.${encodeURIComponent(opt('email')!)}` : '';
  const rows = await rest_(`ss_licenses?select=id,email,name,plan,seats,status,expires_at,ss_activations(device_name,last_seen)${q}&order=created_at.desc`);
  for (const r of rows) console.log(`${r.id}  ${r.status.padEnd(7)} ${r.plan.padEnd(10)} ${r.email}  ${r.ss_activations.length}/${r.seats} devices  ${r.expires_at?.slice(0, 10) ?? 'perpetual'}`);
} else {
  console.log('Commands: keygen <file> | issue --email E [--name N] [--plan pro|enterprise] [--seats 2] [--years 1] | revoke --id ID | list');
}
