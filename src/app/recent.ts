// Recent projects for the start page: a local copy of each project opened, imported or saved on this device
// (IndexedDB), so it can be reopened in one click even in the browser, where files cannot be reopened by path.
import type { Network } from '../engine/types';

export interface RecentEntry { id: string; name: string; when: number; how: 'opened' | 'saved' | 'imported' | 'built'; pipes: number; nodes: number; net: Network }
const DB = 'surgespace-recent', STORE = 'p', MAX = 12;

function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
const keyOf = (name: string) => name.trim().toLowerCase() || 'untitled';

export async function listRecent(): Promise<RecentEntry[]> {
  const d = await db();
  if (!d) return [];
  return new Promise((resolve) => {
    const q = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    q.onsuccess = () => resolve((q.result as RecentEntry[]).sort((a, b) => b.when - a.when));
    q.onerror = () => resolve([]);
  });
}
/** Keep a copy of the project (one entry per project name; the newest wins; at most 12). */
export async function addRecent(net: Network, how: RecentEntry['how']): Promise<void> {
  if (!net.nodes.length) return;
  const d = await db();
  if (!d) return;
  const entry: RecentEntry = { id: keyOf(net.name), name: net.name || 'Untitled model', when: Date.now(), how, pipes: net.pipes.length, nodes: net.nodes.length, net: JSON.parse(JSON.stringify(net)) };
  const all = await listRecent();
  await new Promise<void>((resolve) => {
    const tx = d.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    st.put(entry);
    for (const old of all.filter((x) => x.id !== entry.id).slice(MAX - 1)) st.delete(old.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
export async function removeRecent(id: string): Promise<void> {
  const d = await db();
  if (!d) return;
  await new Promise<void>((resolve) => { const tx = d.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); });
}
export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) { const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : `${d} days ago`; }
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
