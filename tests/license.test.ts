// Licensing tests: keys, signed tokens, offline checks, seats, trials, refresh and deactivation.
import * as ed from '@noble/ed25519';
import {
  checkToken, DAY, features, handleRequest, hashKey, newLicenseKey, normaliseKey, OFFLINE_GRACE_DAYS, signToken, TRIAL_DAYS, verifyToken,
  type ActivationRow, type LicenseRow, type LicenseStore, type TrialRow,
} from '../supabase/functions/_shared/licenseCore';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

function memStore() {
  const lic: LicenseRow[] = [], act: ActivationRow[] = [], trials: TrialRow[] = [];
  const s: LicenseStore & { lic: LicenseRow[]; act: ActivationRow[] } = {
    lic, act,
    licenseByHash: async (h) => lic.find((l) => l.key_hash === h) ?? null,
    licenseById: async (id) => lic.find((l) => l.id === id) ?? null,
    activations: async (id) => act.filter((a) => a.license_id === id),
    upsertActivation: async (a) => { const i = act.findIndex((x) => x.license_id === a.license_id && x.device_id === a.device_id); if (i >= 0) act[i] = a; else act.push(a); },
    removeActivation: async (id, d) => { const i = act.findIndex((x) => x.license_id === id && x.device_id === d); if (i >= 0) act.splice(i, 1); },
    trialFor: async (e, d) => trials.find((x) => x.email === e || x.device_id === d) ?? null,
    createTrial: async (x) => { trials.push(x); },
  };
  return s;
}

const priv = ed.utils.randomSecretKey();
const pub = await ed.getPublicKeyAsync(priv);
const other = ed.utils.randomSecretKey();
const now = 1_800_000_000;
const devA = 'deviceAAAAAAAAAAAAAAAA', devB = 'deviceBBBBBBBBBBBBBBBB', devC = 'deviceCCCCCCCCCCCCCCCC';

// keys
const key = newLicenseKey();
t('key format', /^SSPC(-[0-9A-Z]{5}){4}$/.test(key), key);
t('key normalises from lower case and spaces', normaliseKey(key.toLowerCase().replace(/-/g, ' ')) === key);
const typo = key.slice(0, -1) + (key.endsWith('0') ? '1' : '0');
t('one wrong character is caught by the check symbol', normaliseKey(typo) === null);

// tokens
const p0 = { v: 1 as const, lid: 'L1', plan: 'pro' as const, seats: 2, email: 'a@b.co', dev: devA, iat: now, exp: now + 365 * DAY, rby: now + 30 * DAY };
const tok = await signToken(p0, priv);
t('token verifies with the right public key', (await verifyToken(tok, pub))?.lid === 'L1');
t('token fails with another key', (await verifyToken(tok, await ed.getPublicKeyAsync(other))) === null);
const [body, sig] = tok.split('.');
const forged = Buffer.from(JSON.stringify({ ...p0, plan: 'enterprise', seats: 99 })).toString('base64url') + '.' + sig;
t('edited token is rejected', (await verifyToken(forged, pub)) === null);
void body;
t('token on another device is rejected', (await checkToken(tok, pub, devB, now)).ok === false);
t('token past licence end is rejected', (await checkToken(tok, pub, devA, now + 366 * DAY)).ok === false);
const off = await checkToken(tok, pub, devA, now + 31 * DAY);
t('token offline beyond grace is rejected', !off.ok && off.reason === 'offline-too-long');
const fresh = await checkToken(tok, pub, devA, now + 8 * DAY);
t('token older than 7 days asks for a quiet refresh', fresh.ok && fresh.needsRefresh);
t('free plan limits', features('free').maxPipes === 25 && !features('free').exportFiles && features('pro').maxPipes === Infinity);

// server: activation and seats
const st = memStore();
st.lic.push({ id: 'L1', key_hash: await hashKey(key), plan: 'pro', seats: 2, email: 'eng@firm.com', name: 'Firm Ltd', expires_at: now + 365 * DAY, status: 'active' });
const r1 = await handleRequest({ action: 'activate', key, deviceId: devA, deviceName: 'Laptop' }, st, priv, pub, now);
t('activation on device A', r1.ok && !!r1.token);
const r1b = await handleRequest({ action: 'activate', key, deviceId: devA }, st, priv, pub, now + 10);
t('activating the same device again does not use a seat', r1b.ok && st.act.length === 1);
const r2 = await handleRequest({ action: 'activate', key: key.toLowerCase(), deviceId: devB }, st, priv, pub, now);
t('activation on device B (2 seats)', r2.ok);
const r3 = await handleRequest({ action: 'activate', key, deviceId: devC }, st, priv, pub, now);
t('third device is refused when seats are full', !r3.ok && r3.error === 'seats-full');
const tokA = r1.ok ? r1.token! : '';
const d1 = await handleRequest({ action: 'deactivate', token: tokA }, st, priv, pub, now + DAY);
t('deactivating device A frees a seat', d1.ok && st.act.length === 1);
const r4 = await handleRequest({ action: 'activate', key, deviceId: devC }, st, priv, pub, now + DAY);
t('device C can activate after that', r4.ok);
const ref = await handleRequest({ action: 'refresh', token: tokA }, st, priv, pub, now + 2 * DAY);
t('refresh is refused for a deactivated device', !ref.ok && ref.error === 'not-activated');
const tokC = r4.ok ? r4.token! : '';
const refC = await handleRequest({ action: 'refresh', token: tokC }, st, priv, pub, now + 20 * DAY);
const pC = refC.ok ? await verifyToken(refC.token!, pub) : null;
t('refresh extends the offline grace', !!pC && pC.rby === now + 20 * DAY + OFFLINE_GRACE_DAYS * DAY);
st.lic[0].status = 'revoked';
const refR = await handleRequest({ action: 'refresh', token: tokC }, st, priv, pub, now + 21 * DAY);
t('revoked licence stops refreshing', !refR.ok && refR.error === 'revoked');
st.lic[0].status = 'active';
const exp = await handleRequest({ action: 'refresh', token: tokC }, st, priv, pub, now + 400 * DAY);
t('expired subscription stops refreshing', !exp.ok && exp.error === 'expired');
const unk = await handleRequest({ action: 'activate', key: newLicenseKey(), deviceId: devA }, st, priv, pub, now);
t('unknown key is refused', !unk.ok && unk.error === 'unknown-key');

// trials
const tr = await handleRequest({ action: 'trial', email: 'New@Firm.com', deviceId: devA }, st, priv, pub, now);
const pt = tr.ok ? await verifyToken(tr.token!, pub) : null;
t('trial gives 14 days', !!pt && pt.plan === 'trial' && pt.exp === now + TRIAL_DAYS * DAY);
const tr2 = await handleRequest({ action: 'trial', email: 'other@firm.com', deviceId: devA }, st, priv, pub, now + 20 * DAY);
t('a second trial on the same device after it ended is refused', !tr2.ok && tr2.error === 'trial-used');
const tr3 = await handleRequest({ action: 'trial', email: 'new@firm.com', deviceId: devB }, st, priv, pub, now + 3 * DAY);
const pt3 = tr3.ok ? await verifyToken(tr3.token!, pub) : null;
t('same email on another device continues the same trial (no reset)', !!pt3 && pt3.exp === now + TRIAL_DAYS * DAY);
const bad = await handleRequest({ action: 'trial', email: 'nope', deviceId: devC }, st, priv, pub, now);
t('trial needs a valid email', !bad.ok && bad.error === 'bad-email');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
