// Script console: automate SurgeSpace with JavaScript. Every command the AI copilot uses is available as
// `await ss.<command>({...})`; each change is one undo step. Scripts run on this computer, in this window.
import { useState } from 'react';
import { COMMANDS, execute, type CommandContext } from '../app/commands';
import { Modal } from './Dialogs';
import { Ic } from './Icons';

const EXAMPLE = `// Closure-time study: how does the slowest closure change the peak pressure?
const results = [];
for (const t of [5, 10, 20, 40]) {
  await ss.set_operations({ operations: [{ kind: 'valve_close', targets: [ (await ss.get_model()).valves[0]?.id ], start_s: 1, duration_s: t }] });
  const r = await ss.run_analysis({});
  results.push({ closure_s: t, max_p: r.highest_pressure_m.value, min_p: r.lowest_pressure_m.value });
}
table(results);`;

export function ScriptDialog({ ctx, onClose }: { ctx: CommandContext; onClose: () => void }) {
  const [code, setCode] = useState(() => { try { return localStorage.getItem('surgespace.script') || EXAMPLE; } catch { return EXAMPLE; } });
  const [out, setOut] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const run = async () => {
    try { localStorage.setItem('surgespace.script', code); } catch { /* storage blocked */ }
    const lines: string[] = [];
    const push = (s: string) => { lines.push(s); setOut([...lines]); };
    const ss = Object.fromEntries(COMMANDS.map((c) => [c.name, async (args: unknown = {}) => {
      const r = await execute(ctx, c.name, args);
      if (!r.ok) throw new Error(`${c.name}: ${(r.output as { error: string }).error}`);
      return r.output;
    }]));
    const log = (...a: unknown[]) => push(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 1))).join(' '));
    const table = (rows: Record<string, unknown>[]) => { if (!rows.length) return; const keys = Object.keys(rows[0]); push([keys.join('\t'), ...rows.map((r) => keys.map((k) => String(r[k])).join('\t'))].join('\n')); };
    setRunning(true); setOut([]);
    try {
      const fn = new Function('ss', 'log', 'table', `return (async () => {\n${code}\n})();`);
      const v = await fn(ss, log, table);
      if (v !== undefined) log(v);
      push('— done');
    } catch (e) { push(`Error: ${(e as Error).message}`); } finally { setRunning(false); }
  };
  return (
    <Modal title="Script console" onClose={onClose} wide icon={<Ic name="setup" />}>
      <p className="small muted" style={{ marginTop: 0 }}>JavaScript with <code>await ss.&lt;command&gt;(&#123;…&#125;)</code> for every SurgeSpace command, <code>log(…)</code> and <code>table(rows)</code>. Changes are normal undo steps. Commands: {COMMANDS.map((c) => c.name).join(', ')}.</p>
      <textarea rows={14} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} aria-label="Script" />
      <div className="row" style={{ gap: 6, margin: '6px 0' }}>
        <button className="btn primary small" disabled={running} onClick={run}>{running ? 'Running…' : 'Run script'}</button>
        <button className="btn small" onClick={() => setCode(EXAMPLE)}>Example</button>
      </div>
      <pre className="step-body" style={{ maxHeight: 240, minHeight: 60 }}>{out.join('\n')}</pre>
    </Modal>
  );
}
