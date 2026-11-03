// D1 (SQLite) storage for the SurgeSpace licence server.
import type { Feedback, Licence, LicenceRequest, Machine, Store, Trial } from '../../src/license/server/logic';

/** The part of Cloudflare's D1 API used here (also implemented by the test adapter over node:sqlite). */
export interface D1Like {
  prepare(sql: string): { bind(...v: unknown[]): { first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<{ meta: { last_row_id: number } }> } };
}

export function d1Store(db: D1Like): Store {
  const q = (sql: string, ...v: unknown[]) => db.prepare(sql).bind(...v);
  const insert = async (table: string, row: Record<string, unknown>) => {
    const k = Object.keys(row);
    const r = await q(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map((x) => row[x])).run();
    return Number(r.meta.last_row_id);
  };
  const upsert = async (table: string, row: Record<string, unknown>) => {
    const k = Object.keys(row);
    await q(`INSERT OR REPLACE INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`, ...k.map((x) => row[x])).run();
  };
  return {
    licences: async () => (await q('SELECT * FROM licences').all<Licence>()).results,
    licenceByCode: (code) => q('SELECT * FROM licences WHERE code = ?', code).first<Licence>(),
    licenceById: (id) => q('SELECT * FROM licences WHERE id = ?', id).first<Licence>(),
    addLicence: (l) => insert('licences', { ...l }),
    updateLicence: async (id, p) => {
      const k = Object.keys(p).filter((x) => ['name', 'email', 'plan', 'seats', 'paid_until', 'status'].includes(x));
      if (k.length) await q(`UPDATE licences SET ${k.map((x) => `${x} = ?`).join(', ')} WHERE id = ?`, ...k.map((x) => (p as Record<string, unknown>)[x]), id).run();
    },
    machines: async (id) => (await q('SELECT * FROM machines WHERE licence_id = ?', id).all<Machine>()).results,
    machineLicences: async (m) => (await q('SELECT * FROM machines WHERE machine = ?', m).all<Machine>()).results,
    putMachine: (m) => upsert('machines', { ...m }),
    freeMachines: async (id) => { await q('DELETE FROM machines WHERE licence_id = ?', id).run(); },
    trial: (hash) => q('SELECT * FROM trials WHERE hash = ?', hash).first<Trial>(),
    trials: async () => (await q('SELECT * FROM trials').all<Trial>()).results,
    putTrial: (t) => upsert('trials', { ...t }),
    addRequest: (r) => insert('requests', { ...r }),
    requests: async () => (await q('SELECT * FROM requests').all<LicenceRequest>()).results,
    addFeedback: (f) => insert('feedback', { ...f }),
    feedback: async () => (await q('SELECT * FROM feedback').all<Feedback>()).results,
  };
}
