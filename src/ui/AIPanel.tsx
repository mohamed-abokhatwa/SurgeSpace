// AI in SurgeSpace: the user's own AI accounts (any provider) and the copilot panel.
// The copilot works only through SurgeSpace commands, so every change is an undo step and every number comes
// from the engine. Nothing is sent anywhere until the user connects an account and asks for something.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PROVIDERS, providerById, listModels, testConnection, type Message, type Part } from '../ai/providers';
import { activeConfig, configOf, getAI, hasKey, removeAccount, saveAccount, setActive, setConsent, useAI, type AIAccount } from '../ai/accounts';
import { openExternal } from '../license/licence';
import { AI_TASKS, READ_DOC_PROMPT, runAgent } from '../ai/agent';
import { mdToHtml } from '../ai/markdown';
import type { CommandContext } from '../app/commands';
import { Modal } from './Dialogs';
import { Ic } from './Icons';

const uid = () => Math.random().toString(36).slice(2, 10);

// ── accounts dialog ──
export function AIAccountsDialog({ onClose }: { onClose: () => void }) {
  const ai = useAI();
  const [edit, setEdit] = useState<{ id: string; provider: string; model: string; baseUrl: string; label: string; key: string; keySaved: boolean } | null>(ai.accounts.length ? null : { id: uid(), provider: 'anthropic', model: PROVIDERS[0].models[0], baseUrl: '', label: '', key: '', keySaved: false });
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [working, setWorking] = useState(false);
  const p = edit ? providerById(edit.provider)! : null;
  const cfgOf = async () => {
    if (!edit || !p) return null;
    const saved = ai.accounts.find((a) => a.id === edit.id);
    let apiKey: string | undefined = edit.key || undefined;
    if (!apiKey && saved && edit.keySaved) { const c = await configOf(saved); apiKey = c.apiKey; }
    return { provider: edit.provider, model: edit.model, baseUrl: edit.baseUrl || undefined, apiKey };
  };
  const load = async () => {
    setWorking(true); setMsg(null);
    try { const c = await cfgOf(); if (c) { const m = await listModels(c); setModels(m); setMsg({ ok: true, text: `${m.length} models available on this account.` }); } }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setWorking(false); }
  };
  const test = async () => {
    setWorking(true); setMsg(null);
    try { const c = await cfgOf(); if (c) { const r = await testConnection(c); setMsg({ ok: true, text: `Connected. The model replied: “${r.slice(0, 80)}”` }); } }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setWorking(false); }
  };
  const save = async () => {
    if (!edit || !p) return;
    if (!edit.model.trim()) { setMsg({ ok: false, text: 'Choose or type a model.' }); return; }
    if (p.needsBaseUrl && !edit.baseUrl.trim() && edit.provider !== 'ollama' && edit.provider !== 'lmstudio') { setMsg({ ok: false, text: 'Type the endpoint address for this service.' }); return; }
    if (p.needsKey && !edit.key && !edit.keySaved) { setMsg({ ok: false, text: `Paste your ${p.name} key.` }); return; }
    await saveAccount({ id: edit.id, provider: edit.provider, model: edit.model.trim(), baseUrl: edit.baseUrl.trim() || undefined, label: edit.label.trim() || undefined }, edit.key ? edit.key.trim() : undefined);
    setEdit(null); setModels([]); setMsg(null);
  };
  const startEdit = (a: AIAccount) => { setEdit({ id: a.id, provider: a.provider, model: a.model, baseUrl: a.baseUrl ?? '', label: a.label ?? '', key: '', keySaved: hasKey(a) }); setModels([]); setMsg(null); };

  return (
    <Modal title="AI accounts" onClose={onClose} wide icon={<span className="ai-badge">AI</span>}>
      <p className="small muted" style={{ marginTop: 0 }}>
        Use your own AI account with SurgeSpace. Usage is billed by your provider to you; SurgeSpace adds no charge and keeps no copy.
        Keys are encrypted on this device and sent only to the provider you choose. Everything else in SurgeSpace works without AI.
      </p>
      {ai.accounts.length > 0 && (
        <table className="grid" style={{ marginBottom: 10 }}>
          <thead><tr><th>Use</th><th>Account</th><th>Model</th><th>Key</th><th /></tr></thead>
          <tbody>
            {ai.accounts.map((a) => (
              <tr key={a.id}>
                <td><input type="radio" name="ai-active" checked={(ai.active ?? ai.accounts[0]?.id) === a.id} onChange={() => setActive(a.id)} aria-label={`Use ${a.label ?? a.provider}`} /></td>
                <td>{a.label || providerById(a.provider)?.name || a.provider}</td>
                <td className="mono small">{a.model}</td>
                <td className="small">{hasKey(a) ? 'saved' : providerById(a.provider)?.needsKey ? <span className="warn">missing</span> : 'not needed'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn small ghost" onClick={() => startEdit(a)}>Edit</button>
                  <button className="btn small ghost" onClick={() => { removeAccount(a.id); if (edit?.id === a.id) setEdit(null); }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!edit ? (
        <button className="btn" onClick={() => { setEdit({ id: uid(), provider: 'anthropic', model: PROVIDERS[0].models[0], baseUrl: '', label: '', key: '', keySaved: false }); setModels([]); setMsg(null); }}>+ Add an account</button>
      ) : p && (
        <div className="card" style={{ boxShadow: 'none' }}>
          <div className="grid2">
            <label className="field"><span>Provider</span>
              <select value={edit.provider} onChange={(e) => { const np = providerById(e.target.value)!; setEdit({ ...edit, provider: np.id, model: np.models[0] ?? '', baseUrl: np.needsBaseUrl ? np.baseUrl : '' }); setModels([]); setMsg(null); }}>
                {PROVIDERS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Name (optional)</span><input value={edit.label} placeholder={p.name} onChange={(e) => setEdit({ ...edit, label: e.target.value })} /></label>
            {(p.needsBaseUrl || edit.baseUrl) && (
              <label className="field" style={{ gridColumn: '1 / -1' }}><span>Endpoint address</span><input className="mono" value={edit.baseUrl} placeholder={p.baseUrl} onChange={(e) => setEdit({ ...edit, baseUrl: e.target.value })} /></label>
            )}
            <label className="field" style={{ gridColumn: '1 / -1' }}>
              <span>API key {p.keyUrl && <button type="button" className="linkbtn small" onClick={() => void openExternal(p.keyUrl!)}>get a key</button>}{!p.needsKey && ' (optional)'}</span>
              <input type="password" autoComplete="off" spellCheck={false} value={edit.key} placeholder={edit.keySaved ? 'Saved (encrypted). Paste a new key to replace it.' : p.needsKey ? 'Paste your key' : 'Not needed for most local servers'} onChange={(e) => setEdit({ ...edit, key: e.target.value })} />
            </label>
            <label className="field" style={{ gridColumn: '1 / -1' }}><span>Model</span>
              <div className="row" style={{ gap: 6 }}>
                <input className="mono" list="ai-models" value={edit.model} onChange={(e) => setEdit({ ...edit, model: e.target.value })} style={{ flex: 1 }} />
                <datalist id="ai-models">{[...new Set([...models, ...p.models])].filter(Boolean).map((m) => <option key={m} value={m} />)}</datalist>
                <button className="btn small" type="button" onClick={load} disabled={working}>Load models</button>
              </div>
            </label>
          </div>
          {p.note && <p className="small muted">{p.note}</p>}
          {!p.pdf && <p className="small muted">This provider does not read PDF files directly; attach images or paste text instead, or use Anthropic, OpenAI or Gemini for documents.</p>}
          {msg && <p className={`small ${msg.ok ? 'good' : 'bad'}`} role="status">{msg.text}</p>}
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <button className="btn primary" onClick={save} disabled={working}>Save account</button>
            <button className="btn" onClick={test} disabled={working}>{working ? 'Working…' : 'Test connection'}</button>
            {ai.accounts.length > 0 && <button className="btn ghost" onClick={() => { setEdit(null); setMsg(null); }}>Cancel</button>}
          </div>
        </div>
      )}
      <div className="label" style={{ marginTop: 14 }}>What is sent</div>
      <p className="small muted" style={{ margin: 0 }}>
        When you ask the copilot or run an AI task, SurgeSpace sends your request, the model data the copilot reads (elements, levels, settings, results) and any file you attach to the provider above, under your account and its terms.
        Nothing is sent at other times. For fully private use, choose Ollama or LM Studio running on this computer.
      </p>
      <label className="row small" style={{ gap: 6, marginTop: 8 }}>
        <input type="checkbox" checked={ai.consent} onChange={(e) => setConsent(e.target.checked)} /> I agree that SurgeSpace sends this data to my AI provider when I use AI features.
      </label>
    </Modal>
  );
}

// ── copilot panel ──
const TOOL_LABEL: Record<string, string> = {
  get_model: 'Read the model', list_elements: 'Listed elements', new_model: 'Started a new model', load_example: 'Opened an example', add_node: 'Added a node', add_pipe: 'Added a pipe',
  build_line: 'Built the line', add_pump_station: 'Added a pump station', add_link: 'Added a link', insert_on_pipe: 'Inserted on a pipe', set_properties: 'Changed properties',
  add_device: 'Added a protection device', set_device: 'Changed a device', remove_device: 'Removed a device', delete_elements: 'Deleted elements', rename_element: 'Renamed an element',
  set_operations: 'Set the operations', set_run_settings: 'Changed run settings', health_check: 'Checked the model', run_analysis: 'Ran the analysis', get_results: 'Read the results',
  size_air_vessel: 'Sized an air vessel', suggest_air_valves: 'Sized air valves', plan_air_valves: 'Planned the air valves', select_elements: 'Highlighted elements',
};
const argHint = (a: unknown) => {
  if (!a || typeof a !== 'object') return '';
  const o = a as Record<string, unknown>;
  const v = o.node ?? o.id ?? o.pipe ?? o.device ?? o.kind ?? o.what ?? (Array.isArray(o.ids) ? (o.ids as string[]).join(', ') : undefined) ?? (o.type && o.ids ? o.type : undefined);
  return v ? String(v).slice(0, 40) : '';
};

export interface CopilotProps {
  ctx: CommandContext;
  hasResult: boolean;
  onAccounts: () => void;
  /** Save text as the report narrative. */
  onUseNarrative: (md: string) => void;
  /** A task or prompt queued from a menu; the panel runs it and calls `done`. */
  queued: { prompt: string; label: string } | null;
  done: () => void;
  /** Conversation saved with the project (text only) and a way to save it. */
  saved?: { role: 'user' | 'assistant'; text: string }[];
  onSave?: (t: { role: 'user' | 'assistant'; text: string }[]) => void;
}

export function CopilotPanel({ ctx, hasResult, onAccounts, onUseNarrative, queued, done, saved, onSave }: CopilotProps) {
  const ai = useAI();
  const [messages, setMessages] = useState<Message[]>(() => (saved ?? []).map((m) => ({ role: m.role, parts: [{ type: 'text' as const, text: m.text }] })));
  const [listening, setListening] = useState(false);
  // keep the conversation with the project (text parts only; tool calls and results are not stored)
  useEffect(() => {
    if (!onSave) return;
    const t = setTimeout(() => {
      const out = messages.map((m) => ({ role: m.role, text: m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n') })).filter((m) => m.text.trim()).slice(-60);
      onSave(out);
    }, 800);
    return () => clearTimeout(t);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps
  const SR = typeof window !== 'undefined' ? ((window as unknown as Record<string, unknown>).SpeechRecognition ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition) as (new () => { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void }) | undefined : undefined;
  const listen = () => {
    if (!SR) return;
    const r = new SR();
    r.lang = navigator.language?.startsWith('ar') ? 'ar-SA' : navigator.language || 'en-US';
    r.interimResults = false;
    r.onresult = (e) => { const tx = Array.from(e.results).map((x) => x[0].transcript).join(' '); setInput((v) => (v ? `${v} ${tx}` : tx)); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    setListening(true);
    r.start();
  };
  const [labels, setLabels] = useState<Record<number, string>>({}); // index of user message → task label shown instead of the long prompt
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<{ name: string; part: Part }[]>([]);
  const [running, setRunning] = useState(false);
  const [live, setLive] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState({ input: 0, output: 0 });
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [needConsent, setNeedConsent] = useState<{ text: string; label?: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const active = ai.accounts.find((a) => a.id === ai.active) ?? ai.accounts[0];
  const provider = active ? providerById(active.provider) : undefined;

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [messages, running]);

  const send = async (text: string, label?: string) => {
    if (running) return;
    if (!active) { onAccounts(); return; }
    if (!getAI().consent) { setNeedConsent({ text, label }); return; }
    const parts: Part[] = [...files.map((f) => f.part), { type: 'text', text }];
    if (files.some((f) => f.part.type === 'pdf') && provider && !provider.pdf) { setError(`${provider.name} does not read PDF files. Use an Anthropic, OpenAI or Gemini account for documents, or paste the text.`); return; }
    const cfg = await activeConfig();
    if (!cfg) { onAccounts(); return; }
    setError(null); setInput(''); setFiles([]);
    // merge into a trailing user message (e.g. after a stop) so roles keep alternating
    const last = messages[messages.length - 1];
    const history: Message[] = last?.role === 'user' ? [...messages.slice(0, -1), { role: 'user', parts: [...last.parts, ...parts] }] : [...messages, { role: 'user', parts }];
    if (label) setLabels((l) => ({ ...l, [history.length - 1]: label }));
    setMessages(history);
    setRunning(true);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const out = await runAgent({ cfg, ctx, history, signal: ac.signal, onUpdate: (m) => { setLive(''); setMessages(m); }, onDelta: setLive });
      setMessages(out.messages);
      setUsage((u) => ({ input: u.input + out.usage.input, output: u.output + out.usage.output }));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setRunning(false); setLive(''); abort.current = null;
    }
  };

  // tasks queued from menus
  useEffect(() => {
    if (!queued || running) return;
    done();
    void send(queued.prompt, queued.label);
  }, [queued]); // eslint-disable-line react-hooks/exhaustive-deps

  const attach = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.multiple = true; i.accept = '.pdf,image/png,image/jpeg,image/webp,.csv,.txt';
    i.onchange = async () => {
      const add: { name: string; part: Part }[] = [];
      for (const f of Array.from(i.files ?? [])) {
        if (f.size > 20e6) { setError(`${f.name} is larger than 20 MB.`); continue; }
        if (/\.(csv|txt)$/i.test(f.name)) { add.push({ name: f.name, part: { type: 'text', text: `File ${f.name}:\n${(await f.text()).slice(0, 60000)}` } }); continue; }
        const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(f); });
        add.push({ name: f.name, part: f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? { type: 'pdf', name: f.name, data } : { type: 'image', mime: f.type || 'image/png', data } });
      }
      setFiles((x) => [...x, ...add]);
      if (add.length && !input.trim()) setInput(READ_DOC_PROMPT);
    };
    i.click();
  };

  // results of tool calls, by call id
  const results = useMemo(() => {
    const m = new Map<string, Extract<Part, { type: 'tool_result' }>>();
    for (const msg of messages) for (const p of msg.parts) if (p.type === 'tool_result') m.set(p.id, p);
    return m;
  }, [messages]);
  const lastText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant') { const t = messages[i].parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n\n'); if (t.trim()) return { i, t }; }
    return null;
  }, [messages]);

  if (!ai.accounts.length) {
    return (
      <div className="copilot">
        <div className="ai-connect card">
          <div className="row" style={{ gap: 8 }}><span className="ai-badge">AI</span><b>Connect your AI account</b></div>
          <p className="small muted">The copilot builds models from descriptions or drawings, reviews your data, designs surge protection by running the options, explains results and drafts the report. It uses your own account with Anthropic, OpenAI, Google, Azure, Mistral, DeepSeek, xAI, Groq, OpenRouter, Together or a free model on your computer (Ollama, LM Studio).</p>
          <p className="small muted">Everything else in SurgeSpace works without AI.</p>
          <button className="btn primary" onClick={onAccounts}>Connect an account</button>
        </div>
      </div>
    );
  }

  return (
    <div className="copilot">
      <div className="copilot-head">
        <span className="ai-badge">AI</span>
        <select className="cell boxed" value={active?.id} onChange={(e) => setActive(e.target.value)} aria-label="AI account" title="AI account">
          {ai.accounts.map((a) => <option key={a.id} value={a.id}>{a.label || providerById(a.provider)?.name} · {a.model}</option>)}
        </select>
        <button className="btn ghost small icon" onClick={onAccounts} title="AI accounts"><Ic name="setup" size={15} /></button>
        <button className="btn ghost small" onClick={() => { abort.current?.abort(); setMessages([]); setLabels({}); setError(null); setUsage({ input: 0, output: 0 }); }} disabled={!messages.length} title="Start a new conversation">New</button>
      </div>
      <div className="copilot-log" ref={scroller}>
        {!messages.length && (
          <div className="copilot-empty">
            <p className="small muted" style={{ marginTop: 0 }}>Ask in plain words, for example:</p>
            {['Build a 5 km DN600 rising main from the sump at 95 m to a tank at 147 m, high point 146 m at 2.6 km, two duty pumps 250 L/s at 74 m, and run a power failure.',
              'Why is the pressure negative near the high point, and what is the cheapest fix?',
              'Change all PVC pipes to 380 m/s wave speed and run again.'].map((s) => <button key={s} className="copilot-suggest" onClick={() => setInput(s)}>{s}</button>)}
            <div className="label" style={{ marginTop: 10 }}>One-click tasks</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {AI_TASKS.map((t) => <button key={t.id} className="btn small" disabled={t.needsResults && !hasResult} title={t.needsResults && !hasResult ? 'Run the model first' : undefined} onClick={() => send(t.prompt, t.label)}>{t.label}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          if (m.role === 'user') {
            const txt = m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
            const att = m.parts.filter((p) => p.type === 'pdf' || p.type === 'image');
            if (!txt && !att.length) return null; // tool results only
            return (
              <div key={i} className="msg user">
                {att.length > 0 && <div className="small muted">{att.map((p, k) => <span key={k} className="chip">{p.type === 'pdf' ? `📄 ${p.name ?? 'document'}` : '🖼 image'}</span>)}</div>}
                <div>{labels[i] ? <b>{labels[i]}</b> : txt.split('\n').map((l, k) => <div key={k}>{l || ' '}</div>)}</div>
              </div>
            );
          }
          return (
            <div key={i} className="msg-group">
              {m.parts.map((p, k) => {
                if (p.type === 'text') {
                  if (!p.text.trim()) return null;
                  return (
                    <div key={k} className="msg assistant">
                      <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(p.text, 4) }} />
                      <div className="msg-tools">
                        <button className="btn ghost small" onClick={() => navigator.clipboard?.writeText(p.text)}>Copy</button>
                        {p.text.length > 600 && <button className="btn ghost small" onClick={() => onUseNarrative(p.text)} title="Put this text in the report as its narrative (you can edit it in the report dialog)">Use in report</button>}
                      </div>
                    </div>
                  );
                }
                if (p.type === 'tool_call') {
                  const r = results.get(p.id);
                  const key = `${i}:${k}`;
                  return (
                    <div key={k} className={`step ${!r ? 'run' : r.isError ? 'bad' : 'ok'}`}>
                      <button className="step-head" onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))} aria-expanded={!!open[key]}>
                        <span className="step-dot">{!r ? <span className="spinner small" /> : r.isError ? '!' : '✓'}</span>
                        <span>{TOOL_LABEL[p.name] ?? p.name.replace(/_/g, ' ')}</span>
                        {argHint(p.args) && <span className="mono muted">{argHint(p.args)}</span>}
                      </button>
                      {open[key] && <pre className="step-body">{JSON.stringify({ input: p.args, output: r?.output }, null, 1).slice(0, 6000)}</pre>}
                      {r?.isError && !open[key] && <div className="small bad step-err">{String((r.output as { error?: string })?.error ?? '').slice(0, 200)}</div>}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          );
        })}
        {running && live.trim() && <div className="msg assistant streaming"><div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(live, 4) }} /></div>}
        {running && !live.trim() && <div className="msg assistant thinking"><span className="spinner small" /> Working…</div>}
        {error && <div className="msg error small" role="alert">{error}<div><button className="btn small" onClick={onAccounts}>AI accounts</button></div></div>}
        {needConsent && (
          <div className="card small" style={{ boxShadow: 'none' }}>
            <b>Send to {provider?.name}?</b>
            <p className="muted" style={{ margin: '6px 0' }}>The copilot sends your request, the model data it reads and any attached file to {provider?.name} under your account. Nothing is sent at other times.</p>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small primary" onClick={() => { const q = needConsent; setConsent(true); setNeedConsent(null); setTimeout(() => void send(q.text, q.label), 0); }}>Allow and send</button>
              <button className="btn small" onClick={() => setNeedConsent(null)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      {messages.length > 0 && !running && (
        <div className="copilot-tasks">
          {AI_TASKS.map((t) => <button key={t.id} className="chip-btn" disabled={t.needsResults && !hasResult} onClick={() => send(t.prompt, t.label)}>{t.label}</button>)}
          {lastText && lastText.t.length > 600 && <button className="chip-btn" onClick={() => onUseNarrative(lastText.t)}>Use last reply in report</button>}
        </div>
      )}
      <div className="copilot-input">
        {files.length > 0 && <div className="row small" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>{files.map((f, k) => <span key={k} className="chip">{f.name}<button className="btn ghost small icon" onClick={() => setFiles((x) => x.filter((_, j) => j !== k))} aria-label={`Remove ${f.name}`}>×</button></span>)}</div>}
        <textarea rows={3} value={input} placeholder="Ask the copilot… (Enter to send, Shift+Enter for a new line)" onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim()) void send(input.trim()); } }} aria-label="Message to the copilot" />
        <div className="row" style={{ gap: 6, justifyContent: 'space-between' }}>
          <span className="row" style={{ gap: 2 }}>
            <button className="btn small ghost" onClick={attach} title="Attach a PDF data sheet, drawing, photo or CSV">Attach…</button>
            {SR && <button className={`btn small ghost ${listening ? 'on' : ''}`} onClick={listen} disabled={listening} title="Speak your request (English or Arabic)">{listening ? 'Listening…' : 'Speak'}</button>}
          </span>
          <span className="small muted mono" title="Tokens used in this conversation (billed by your provider)">{usage.input + usage.output > 0 ? `${((usage.input + usage.output) / 1000).toFixed(1)}k tokens` : ''}</span>
          {running ? <button className="btn small" onClick={() => abort.current?.abort()}>Stop</button>
            : <button className="btn small primary" onClick={() => input.trim() && send(input.trim())} disabled={!input.trim()}>Send</button>}
        </div>
        <div className="small muted" style={{ marginTop: 4 }}>Every change the copilot makes is one Undo step (Ctrl+Z).</div>
      </div>
    </div>
  );
}
