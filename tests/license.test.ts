// Licensing tests: codes and keys, and the licence server rules on both stores (memory, and SQLite with the
// real D1 schema): activation, seats, freeing, revoking, extending, daily check-in, evaluations, requests.
import { readFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import * as ed from '@noble/ed25519';
import { checkCode, machineHash, machineIdFrom, normaliseLicenceCode, normaliseMachineId, readCode } from '../src/license/core';
import { adminRoute, appRoute, type Ctx, type Store } from '../src/license/server/logic';
import { memoryStore } from '../src/license/server/memoryStore';
import { d1Store, type D1Like } from '../licence-server/src/d1Store';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };

function sqliteD1(): D1Like {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync('licence-server/migrations/0001_init.sql', 'utf8'));
  return {
    prepare: (sql) => ({
      bind: (...v: unknown[]) => {
        const st = db.prepare(sql);
        const args = v.map((x) => (x === undefined ? null : x)) as never[];
        return {
          first: async <T,>() => (st.get(...args) as T) ?? null,
          all: async <T,>() => ({ results: st.all(...args) as T[] }),
          run: async () => ({ meta: { last_row_id: Number(st.run(...args).lastInsertRowid) } }),
        };
      },
    }),
  };
}

const sk = ed.utils.randomSecretKey();
const pk = await ed.getPublicKeyAsync(sk);
const DAY = 86_400_000;
const T0 = Date.parse('2026-11-03T09:00:00Z');
const A = machineIdFrom(new Uint8Array(16).fill(1)), B = machineIdFrom(new Uint8Array(16).fill(2)), C = machineIdFrom(new Uint8Array(16).fill(3));

// codes and IDs
t('Machine ID typed loosely is read back', normaliseMachineId(A.toLowerCase().replace(/-/g, ' ')) === A);
const typo = A.slice(0, -1) + (A.endsWith('0') ? '1' : '0');
t('a mistyped Machine ID is caught', normaliseMachineId(typo) === null);

async function suite(label: string, store: Store) {
  const ctx = (now = T0): Ctx => ({ store, privateKey: sk, now, mail: async () => 'sent' });
  const day = (ms: number) => Math.floor(ms / DAY);
  const L = (n: string) => `${label}: ${n}`;

  // issue
  const iss = await adminRoute('/admin/issue', { name: 'Delta Water', email: 'eng@delta.example', plan: 'personal', paid_until: '2027-11-02' }, ctx());
  const code = String(iss.body.code);
  t(L('issue gives an SSL code'), !!normaliseLicenceCode(code), code);
  t(L('code with a typo is refused'), (await appRoute('/activate', { code: code.slice(0, -1) + (code.endsWith('0') ? '1' : '0'), machine: A }, ctx())).body.error === 'bad-code');

  // activate on A
  const a1 = await appRoute('/activate', { code: code.toLowerCase(), machine: A, hostname: 'MALQIMA', platform: 'Windows', version: '1.0.0' }, ctx());
  const k1 = String(a1.body.key);
  const c1 = await checkCode(k1, pk, A, day(T0));
  t(L('activation returns a key for this computer'), a1.body.ok === true && c1.ok);
  t(L('key runs 60 days ahead, licence end shown separately'), c1.ok && c1.payload.e === day(T0) + 60 && c1.payload.x === day(Date.parse('2027-11-02')));
  t(L('key does not work on another computer'), !(await checkCode(k1, pk, B, day(T0))).ok);
  t(L('key stops after its 60 days without a check-in'), !(await checkCode(k1, pk, A, day(T0) + 61)).ok);
  t(L('activating again on the same computer is fine'), (await appRoute('/activate', { code, machine: A }, ctx())).body.ok === true);
  const a2 = await appRoute('/activate', { code, machine: B }, ctx());
  t(L('personal licence refuses a second computer'), a2.body.error === 'in-use');

  // daily check-in moves the key forward
  const ci = await appRoute('/checkin', { code, machine: A, version: '1.0.1' }, ctx(T0 + 30 * DAY));
  const cc = await checkCode(String(ci.body.key), pk, A, day(T0) + 30);
  t(L('check-in moves the key forward'), ci.body.state === 'active' && cc.ok && cc.payload.e === day(T0) + 90);

  // admin list
  const list = await adminRoute('/admin/licences', {}, ctx(T0 + 30 * DAY));
  const row = (list.body.licences as { code: string; machines: { hostname: string; version: string }[]; last_checkin: string }[]).find((l) => l.code === code)!;
  t(L('admin sees the computer, its name and version'), row.machines.length === 1 && row.machines[0].hostname === 'MALQIMA' && row.machines[0].version === '1.0.1');

  // extend: picked up at the next check-in, no new code
  const id = Number(iss.body.id);
  await adminRoute('/admin/extend', { id, paid_until: '2028-11-02' }, ctx());
  const ci2 = await appRoute('/checkin', { code, machine: A }, ctx(T0 + 31 * DAY));
  t(L('extension reaches the app at check-in'), (await readCode(String(ci2.body.key), pk))?.x === day(Date.parse('2028-11-02')));
  // near the end the key never runs past the licence
  await adminRoute('/admin/extend', { id, paid_until: '2026-12-10' }, ctx());
  const ci3 = await appRoute('/checkin', { code, machine: A }, ctx(T0 + DAY));
  t(L('key never runs past the licence end'), (await readCode(String(ci3.body.key), pk))?.e === day(Date.parse('2026-12-10')));

  // free the computer → moves
  await adminRoute('/admin/release', { id }, ctx());
  t(L('freed computer is told at check-in'), (await appRoute('/checkin', { code, machine: A }, ctx())).body.state === 'freed');
  t(L('licence then activates on another computer'), (await appRoute('/activate', { code, machine: B }, ctx())).body.ok === true);

  // revoke / restore
  await adminRoute('/admin/revoke', { id }, ctx());
  t(L('revoked licence is told at check-in'), (await appRoute('/checkin', { code, machine: B }, ctx())).body.state === 'revoked');
  t(L('revoked licence cannot activate'), (await appRoute('/activate', { code, machine: C }, ctx())).body.error === 'revoked');
  await adminRoute('/admin/restore', { id }, ctx());
  t(L('restored licence works again'), (await appRoute('/checkin', { code, machine: B }, ctx())).body.state === 'active');

  // company seats and perpetual
  const co = await adminRoute('/admin/issue', { name: 'Big Utility', plan: 'company', seats: 2, paid_until: '' }, ctx());
  const cc2 = String(co.body.code);
  const r1 = await appRoute('/activate', { code: cc2, machine: A }, ctx()), r2 = await appRoute('/activate', { code: cc2, machine: B }, ctx()), r3 = await appRoute('/activate', { code: cc2, machine: C }, ctx());
  t(L('company licence: 2 seats used, third refused'), r1.body.ok === true && r2.body.ok === true && r3.body.error === 'in-use');
  t(L('perpetual licence: key still runs 60 days, no end shown'), (await readCode(String(r1.body.key), pk))?.x === null);
  const exp = await adminRoute('/admin/issue', { name: 'Old', plan: 'personal', paid_until: '2026-01-01' }, ctx());
  t(L('ended licence cannot activate'), (await appRoute('/activate', { code: String(exp.body.code), machine: C }, ctx())).body.error === 'expired');

  // evaluations
  const tr = await appRoute('/trial', { machine: C, platform: 'Windows', version: '1.0.0' }, ctx());
  const tk = await checkCode(String(tr.body.key), pk, C, day(T0));
  t(L('evaluation: 14 days'), tr.body.ends === '2026-11-16' && tk.ok && tk.daysLeft === 14);
  const tr2 = await appRoute('/trial', { machine: C }, ctx(T0 + 20 * DAY));
  t(L('evaluation does not restart'), tr2.body.ends === '2026-11-16' && tr2.body.ended === true);
  const m1 = await appRoute('/trial/more', { machine: C, note: 'testing a pump station' }, ctx(T0 + 20 * DAY));
  t(L('first "more time" adds 7 days by itself'), m1.body.ends === '2026-11-29' && !m1.body.waiting, String(m1.body.ends));
  const m2 = await appRoute('/trial/more', { machine: C, note: 'need one more week', reply_to: 'x@y.co' }, ctx(T0 + 21 * DAY));
  t(L('second request waits for the seller'), m2.body.waiting === true && m2.body.ends === '2026-11-29');
  const trials = (await adminRoute('/admin/trials', {}, ctx())).body.trials as { hash: string; asked_at: string; asked_note: string }[];
  const hash = await machineHash(C);
  t(L('admin sees the waiting request, by one-way code only'), trials[0].hash === hash && !!trials[0].asked_at && trials[0].asked_note === 'need one more week' && !JSON.stringify(trials).includes(C));
  await adminRoute('/admin/trial/grant', { machine: hash, days: 14 }, ctx(T0 + 22 * DAY));
  const tr3 = await appRoute('/trial', { machine: C }, ctx(T0 + 22 * DAY));
  t(L('"Give 14 days" reaches the app'), tr3.body.ends === '2026-12-13' && (await checkCode(String(tr3.body.key), pk, C, day(T0) + 22)).ok);

  // requests and feedback
  const rq = await appRoute('/request', { kind: 'company', name: 'Sara', company: 'Nile Eng', email: 'sara@nile.example', note: '3 computers', machine: A }, ctx());
  const reqs = (await adminRoute('/admin/requests', {}, ctx())).body.requests as { name: string; mail: string; machine: string }[];
  t(L('licence request stored and mailed'), rq.body.ok === true && reqs[0].name === 'Sara' && reqs[0].mail === 'sent' && reqs[0].machine === A);
  t(L('request needs a valid email'), (await appRoute('/request', { name: 'x', email: 'nope' }, ctx())).body.ok === false);
  await appRoute('/feedback', { level: 'problem', message: 'run stopped', detail: 'at 3.2 s', build: '1.0.0 Windows', where: 'event · profile' }, ctx());
  const fb = (await adminRoute('/admin/feedback', {}, ctx())).body.feedback as { message: string; level: string }[];
  t(L('"Tell us" message stored'), fb[0].message === 'run stopped' && fb[0].level === 'problem');
}

await suite('memory', memoryStore());
await suite('sqlite/D1 schema', d1Store(sqliteD1()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
