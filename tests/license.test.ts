// Licensing tests: Machine IDs, activation codes (forgery, wrong machine, expiry) and the online status file.
import * as ed from '@noble/ed25519';
import { checkCode, features, hex, machineIdFrom, makeCode, makeStatus, newKeyPair, normaliseMachineId, publicKeyOf, readCode, readStatus } from '../src/license/core';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

const kp = await newKeyPair();
const priv = Uint8Array.from(kp.privateKey.match(/../g)!.map((x) => parseInt(x, 16)));
const pub = Uint8Array.from(kp.publicKey.match(/../g)!.map((x) => parseInt(x, 16)));
t('public key derives from the private key', (await publicKeyOf(kp.privateKey)) === kp.publicKey);

// Machine IDs
const mid = machineIdFrom(crypto.getRandomValues(new Uint8Array(16)));
const mid2 = machineIdFrom(crypto.getRandomValues(new Uint8Array(16)));
t('Machine ID format', /^SS(-[0-9A-Z]{4}){4}$/.test(mid), mid);
t('Machine ID read back from lower case, spaces and O/0 mix-ups', normaliseMachineId(mid.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o')) === mid);
const typo = mid.slice(0, -1) + (mid.endsWith('0') ? '1' : '0');
t('one mistyped character is caught', normaliseMachineId(typo) === null);
t('same device gives the same Machine ID', machineIdFrom(new Uint8Array(16).fill(7)) === machineIdFrom(new Uint8Array(16).fill(7)));

// codes
const key = (id: string) => id.replace(/^SS-/, '').replace(/-/g, '');
const day = 20_400;
const code = await makeCode({ m: key(mid), p: 'pro', n: 'Firm Ltd', l: 'SS-2026-0001', i: day, e: day + 364 }, priv);
t('code starts with SSA- and is short enough for an email', code.startsWith('SSA-') && code.length < 260, `${code.length} characters`);
const ok = await checkCode(code, pub, mid, day + 10);
t('valid code on its machine', ok.ok && ok.payload.n === 'Firm Ltd' && ok.daysLeft === 355);
const wrapped = code.match(/.{1,60}/g)!.join('\n  ');
t('code still works after an email client wraps it', (await checkCode(wrapped, pub, mid, day)).ok);
const other = await checkCode(code, pub, mid2, day);
t('code refused on another computer', !other.ok && other.reason === 'other-machine');
const late = await checkCode(code, pub, mid, day + 365);
t('code refused after its last day', !late.ok && late.reason === 'expired');
t('code valid on its last day', (await checkCode(code, pub, mid, day + 364)).ok);
const forever = await makeCode({ m: key(mid), p: 'enterprise', n: 'Utility', l: 'SS-2026-0002', i: day, e: null }, priv);
const fv = await checkCode(forever, pub, mid, day + 5000);
t('code with no end date', fv.ok && fv.daysLeft === null);
const [b, s] = code.slice(4).split('.');
const edited = JSON.parse(Buffer.from(b, 'base64url').toString());
edited.e = day + 9999;
const forged = 'SSA-' + Buffer.from(JSON.stringify(edited)).toString('base64url') + '.' + s;
t('edited code (longer end date) is rejected', (await readCode(forged, pub)) === null);
const strangerKey = ed.utils.randomSecretKey();
const fake = await makeCode({ m: key(mid), p: 'pro', n: 'Pirate', l: 'X', i: day, e: null }, strangerKey);
t('code signed with any other key is rejected', (await readCode(fake, pub)) === null);
t('garbage is rejected', (await readCode('hello', pub)) === null && (await readCode('', pub)) === null);
t('free plan limits', features('free').maxPipes === 25 && !features('free').exportFiles && features('pro').exportFiles);

// status file for the periodic online check
const st = await makeStatus(['SS-2026-0001', ' SS-2026-0001 ', 'SS-2026-0007'], priv, day);
const rs = await readStatus(st, pub);
t('status file lists cancelled licence numbers (duplicates removed)', !!rs && rs.r.length === 2 && rs.r.includes('SS-2026-0001') && rs.d === day);
t('status file has no names in it', !Buffer.from(st.slice(4).split('.')[0], 'base64url').toString().includes('Firm'));
const fakeSt = await makeStatus([], strangerKey, day);
t('a fake status file is rejected', (await readStatus(fakeSt, pub)) === null);
void hex;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
