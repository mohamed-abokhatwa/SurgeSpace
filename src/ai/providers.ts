// AI accounts: one interface over every provider. The user brings their own account (key), so usage bills to
// them. Three wire formats cover the field: Anthropic Messages, OpenAI Chat Completions (used by most providers
// and by local servers) and Google Gemini.

export type Wire = 'anthropic' | 'openai' | 'gemini';
export interface ProviderInfo {
  id: string;
  name: string;
  wire: Wire;
  baseUrl: string;
  models: string[];
  /** Key page for the user. */
  keyUrl?: string;
  needsKey: boolean;
  /** The user types the endpoint (Azure, custom, local). */
  needsBaseUrl?: boolean;
  /** Supports PDF documents in messages. */
  pdf: boolean;
  note?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', name: 'Anthropic (Claude)', wire: 'anthropic', baseUrl: 'https://api.anthropic.com', models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'], keyUrl: 'https://console.anthropic.com/settings/keys', needsKey: true, pdf: true },
  { id: 'openai', name: 'OpenAI', wire: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-5.1', 'gpt-5', 'gpt-5-mini'], keyUrl: 'https://platform.openai.com/api-keys', needsKey: true, pdf: true },
  { id: 'gemini', name: 'Google Gemini', wire: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-3-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash'], keyUrl: 'https://aistudio.google.com/apikey', needsKey: true, pdf: true },
  { id: 'azure', name: 'Azure OpenAI', wire: 'openai', baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1', models: ['(your deployment name)'], needsKey: true, needsBaseUrl: true, pdf: true, note: 'Use your resource endpoint ending in /openai/v1 and your deployment name as the model.' },
  { id: 'mistral', name: 'Mistral', wire: 'openai', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-large-latest', 'mistral-medium-latest'], keyUrl: 'https://console.mistral.ai/api-keys', needsKey: true, pdf: false },
  { id: 'deepseek', name: 'DeepSeek', wire: 'openai', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'], keyUrl: 'https://platform.deepseek.com/api_keys', needsKey: true, pdf: false },
  { id: 'xai', name: 'xAI (Grok)', wire: 'openai', baseUrl: 'https://api.x.ai/v1', models: ['grok-4', 'grok-3-mini'], keyUrl: 'https://console.x.ai', needsKey: true, pdf: false },
  { id: 'groq', name: 'Groq', wire: 'openai', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'], keyUrl: 'https://console.groq.com/keys', needsKey: true, pdf: false },
  { id: 'openrouter', name: 'OpenRouter (many models)', wire: 'openai', baseUrl: 'https://openrouter.ai/api/v1', models: ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.5-pro'], keyUrl: 'https://openrouter.ai/keys', needsKey: true, pdf: false },
  { id: 'together', name: 'Together AI', wire: 'openai', baseUrl: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen2.5-72B-Instruct-Turbo'], keyUrl: 'https://api.together.ai/settings/api-keys', needsKey: true, pdf: false },
  { id: 'ollama', name: 'Ollama (on this computer)', wire: 'openai', baseUrl: 'http://localhost:11434/v1', models: ['qwen2.5:14b', 'llama3.1:8b'], needsKey: false, needsBaseUrl: true, pdf: false, note: 'Free and private: runs on your computer. Start Ollama with OLLAMA_ORIGINS=* so the app can reach it. Choose a model that supports tools.' },
  { id: 'lmstudio', name: 'LM Studio (on this computer)', wire: 'openai', baseUrl: 'http://localhost:1234/v1', models: ['(loaded model)'], needsKey: false, needsBaseUrl: true, pdf: false, note: 'Free and private: start the LM Studio server with CORS enabled.' },
  { id: 'custom', name: 'Other OpenAI-compatible service', wire: 'openai', baseUrl: 'https://', models: [''], needsKey: false, needsBaseUrl: true, pdf: false },
];
export const providerById = (id: string) => PROVIDERS.find((p) => p.id === id);

export interface AIConfig { provider: string; model: string; apiKey?: string; baseUrl?: string }

// ── unified conversation ──
export type Part =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: string; data: string } // base64
  | { type: 'pdf'; name?: string; data: string } // base64
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; output: unknown; isError?: boolean };
export interface Message { role: 'user' | 'assistant'; parts: Part[] }
export interface ToolDef { name: string; description: string; params: Record<string, unknown> }
export interface ChatRequest { system: string; messages: Message[]; tools?: ToolDef[]; maxTokens?: number; signal?: AbortSignal }
export interface ChatResponse { parts: Part[]; stop: 'end' | 'tool_use' | 'length' | 'other'; usage?: { input: number; output: number } }

export class AIError extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...a) => fetch(...a);
/** Replace the transport (tests, or the desktop shell's native HTTP client). */
export const setFetch = (f: Fetch) => { fetchImpl = f; };

const trimSlash = (s: string) => s.replace(/\/+$/, '');
const toolResultText = (o: unknown) => (typeof o === 'string' ? o : JSON.stringify(o));

async function get(url: string, headers: Record<string, string>) {
  let res: Response;
  try { res = await fetchImpl(url, { method: 'GET', headers }); } catch (e) { throw new AIError(`Could not reach the AI service (${(e as Error).message}).`); }
  const text = await res.text();
  if (!res.ok) throw new AIError(`${res.status}: ${text.slice(0, 200)}`, res.status);
  return text ? JSON.parse(text) : {};
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal) {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AIError(`Could not reach the AI service (${(e as Error).message}). Check the internet connection and the address.`);
  }
  const text = await res.text();
  let json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message ?? json?.error ?? json?.message ?? text.slice(0, 300);
    const hint = res.status === 401 || res.status === 403 ? ' The key was refused: check it in AI accounts.' : res.status === 429 ? ' The provider is limiting requests or the account has no credit.' : '';
    throw new AIError(`${typeof msg === 'string' ? msg : JSON.stringify(msg)}${hint}`, res.status);
  }
  return json;
}

// ── Anthropic Messages ──
function toAnthropic(req: ChatRequest) {
  const messages = req.messages.map((m) => ({
    role: m.role,
    content: m.parts.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      if (p.type === 'image') return { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.data } };
      if (p.type === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data } };
      if (p.type === 'tool_call') return { type: 'tool_use', id: p.id, name: p.name, input: p.args ?? {} };
      return { type: 'tool_result', tool_use_id: p.id, content: toolResultText(p.output), ...(p.isError ? { is_error: true } : {}) };
    }),
  }));
  return { system: req.system, messages, max_tokens: req.maxTokens ?? 4096, ...(req.tools?.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.params })) } : {}) };
}
function fromAnthropic(j: any): ChatResponse { // eslint-disable-line @typescript-eslint/no-explicit-any
  const parts: Part[] = (j.content ?? []).flatMap((c: any): Part[] => (c.type === 'text' ? [{ type: 'text', text: c.text }] : c.type === 'tool_use' ? [{ type: 'tool_call', id: c.id, name: c.name, args: c.input }] : [])); // eslint-disable-line @typescript-eslint/no-explicit-any
  return { parts, stop: j.stop_reason === 'tool_use' ? 'tool_use' : j.stop_reason === 'max_tokens' ? 'length' : 'end', usage: j.usage ? { input: j.usage.input_tokens, output: j.usage.output_tokens } : undefined };
}

// ── OpenAI Chat Completions (and compatible) ──
function toOpenAI(req: ChatRequest, model: string) {
  const msgs: unknown[] = [{ role: 'system', content: req.system }];
  for (const m of req.messages) {
    if (m.role === 'assistant') {
      const text = m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n');
      const calls = m.parts.filter((p) => p.type === 'tool_call') as Extract<Part, { type: 'tool_call' }>[];
      msgs.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) } : {}) });
      continue;
    }
    // tool results become separate "tool" messages; other parts form one user message
    for (const p of m.parts) if (p.type === 'tool_result') msgs.push({ role: 'tool', tool_call_id: p.id, content: toolResultText(p.output) });
    const rest = m.parts.filter((p) => p.type !== 'tool_result');
    if (rest.length) msgs.push({
      role: 'user',
      content: rest.map((p) => p.type === 'text' ? { type: 'text', text: p.text }
        : p.type === 'image' ? { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } }
          : p.type === 'pdf' ? { type: 'file', file: { filename: p.name ?? 'document.pdf', file_data: `data:application/pdf;base64,${p.data}` } }
            : { type: 'text', text: '' }),
    });
  }
  return { model, messages: msgs, ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.params } })) } : {}), max_completion_tokens: req.maxTokens ?? 4096 };
}
function fromOpenAI(j: any): ChatResponse { // eslint-disable-line @typescript-eslint/no-explicit-any
  const ch = j.choices?.[0];
  if (!ch) throw new AIError('The AI service returned no answer.');
  const parts: Part[] = [];
  if (ch.message?.content) parts.push({ type: 'text', text: typeof ch.message.content === 'string' ? ch.message.content : ch.message.content.map((c: { text?: string }) => c.text ?? '').join('') });
  for (const tc of ch.message?.tool_calls ?? []) {
    let args: unknown = {};
    try { args = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { args = { _unparsed: tc.function?.arguments }; }
    parts.push({ type: 'tool_call', id: tc.id ?? `call_${parts.length}`, name: tc.function?.name, args });
  }
  const fr = ch.finish_reason;
  return { parts, stop: parts.some((p) => p.type === 'tool_call') || fr === 'tool_calls' ? 'tool_use' : fr === 'length' ? 'length' : 'end', usage: j.usage ? { input: j.usage.prompt_tokens, output: j.usage.completion_tokens } : undefined };
}

// ── Google Gemini ──
/** Gemini accepts a subset of JSON Schema: drop the keywords it rejects. */
function geminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== 'object') return s;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (k !== 'additionalProperties' && k !== '$schema') out[k] = geminiSchema(v);
  if (out.type === 'object' && out.properties && Object.keys(out.properties as object).length === 0) delete out.properties;
  return out;
}
function toGemini(req: ChatRequest) {
  const contents = req.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: m.parts.map((p) => {
      if (p.type === 'text') return { text: p.text };
      if (p.type === 'image') return { inlineData: { mimeType: p.mime, data: p.data } };
      if (p.type === 'pdf') return { inlineData: { mimeType: 'application/pdf', data: p.data } };
      if (p.type === 'tool_call') return { functionCall: { name: p.name, args: p.args ?? {} } };
      return { functionResponse: { name: p.name, response: { result: p.output } } };
    }),
  }));
  return {
    systemInstruction: { parts: [{ text: req.system }] }, contents,
    ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: geminiSchema(t.params) })) }] } : {}),
    generationConfig: { maxOutputTokens: req.maxTokens ?? 4096 },
  };
}
function fromGemini(j: any): ChatResponse { // eslint-disable-line @typescript-eslint/no-explicit-any
  const c = j.candidates?.[0];
  if (!c) throw new AIError(j.promptFeedback?.blockReason ? `The request was blocked (${j.promptFeedback.blockReason}).` : 'The AI service returned no answer.');
  const parts: Part[] = [];
  let k = 0;
  for (const p of c.content?.parts ?? []) {
    if (p.text) parts.push({ type: 'text', text: p.text });
    if (p.functionCall) parts.push({ type: 'tool_call', id: `gem_${Date.now().toString(36)}_${k++}`, name: p.functionCall.name, args: p.functionCall.args ?? {} });
  }
  return { parts, stop: parts.some((p) => p.type === 'tool_call') ? 'tool_use' : c.finishReason === 'MAX_TOKENS' ? 'length' : 'end', usage: j.usageMetadata ? { input: j.usageMetadata.promptTokenCount, output: j.usageMetadata.candidatesTokenCount } : undefined };
}

/** One model turn with any provider. */
export async function chat(cfg: AIConfig, req: ChatRequest): Promise<ChatResponse> {
  const p = providerById(cfg.provider);
  if (!p) throw new AIError(`Unknown AI provider ${cfg.provider}.`);
  if (p.needsKey && !cfg.apiKey) throw new AIError(`Add your ${p.name} key in AI accounts first.`);
  const base = trimSlash(cfg.baseUrl || p.baseUrl);
  if (p.wire === 'anthropic') {
    const j = await post(`${base}/v1/messages`, { 'x-api-key': cfg.apiKey!, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, { model: cfg.model, ...toAnthropic(req) }, req.signal);
    return fromAnthropic(j);
  }
  if (p.wire === 'gemini') {
    const j = await post(`${base}/models/${encodeURIComponent(cfg.model)}:generateContent`, { 'x-goog-api-key': cfg.apiKey! }, toGemini(req), req.signal);
    return fromGemini(j);
  }
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers[p.id === 'azure' ? 'api-key' : 'authorization'] = p.id === 'azure' ? cfg.apiKey : `Bearer ${cfg.apiKey}`;
  if (p.id === 'openrouter') { headers['HTTP-Referer'] = 'https://engspace.app/surgespace'; headers['X-Title'] = 'SurgeSpace'; }
  const body = toOpenAI(req, cfg.model);
  // older compatible servers only know max_tokens
  if (p.id !== 'openai' && p.id !== 'azure') { (body as Record<string, unknown>).max_tokens = (body as { max_completion_tokens: number }).max_completion_tokens; delete (body as Record<string, unknown>).max_completion_tokens; }
  const j = await post(`${base}/chat/completions`, headers, body, req.signal);
  return fromOpenAI(j);
}

/** The models this account can use, straight from the provider (so the list is always current). */
export async function listModels(cfg: AIConfig): Promise<string[]> {
  const p = providerById(cfg.provider);
  if (!p) return [];
  const base = trimSlash(cfg.baseUrl || p.baseUrl);
  if (p.wire === 'anthropic') {
    const j = await get(`${base}/v1/models?limit=100`, { 'x-api-key': cfg.apiKey ?? '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    return (j.data ?? []).map((m: { id: string }) => m.id);
  }
  if (p.wire === 'gemini') {
    const j = await get(`${base}/models?pageSize=200`, { 'x-goog-api-key': cfg.apiKey ?? '' });
    return (j.models ?? []).filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent')).map((m: { name: string }) => m.name.replace(/^models\//, ''));
  }
  const h: Record<string, string> = {};
  if (cfg.apiKey) h[p.id === 'azure' ? 'api-key' : 'authorization'] = p.id === 'azure' ? cfg.apiKey : `Bearer ${cfg.apiKey}`;
  const j = await get(`${base}/models`, h);
  return (j.data ?? []).map((m: { id: string }) => m.id).sort();
}

/** Quick check that the account works: a one-word reply. */
export async function testConnection(cfg: AIConfig): Promise<string> {
  const r = await chat(cfg, { system: 'Reply with the single word OK.', messages: [{ role: 'user', parts: [{ type: 'text', text: 'Ping' }] }], maxTokens: 20 });
  const t = r.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('').trim();
  return t || '(empty reply)';
}

// exported for tests
export const _wire = { toAnthropic, fromAnthropic, toOpenAI, fromOpenAI, toGemini, fromGemini, geminiSchema };
