// Tests for the command layer, project file versions and the AI layer (no network: providers are mocked).
//  • Commands: build a rising main from a long section, add a pump station, protection, operations, run;
//    validation errors come back as messages; every mutating command is one logged step.
//  • Project files: version 1 and 2 files open; newer files are refused with a clear message.
//  • Providers: request bodies and response parsing for the Anthropic, OpenAI-compatible and Gemini formats,
//    including tool calls and documents; error messages for refused keys.
//  • Agent: a scripted model builds, runs and reports through the tools; numbers come from the engine.
import { COMMANDS, execute, localContext, modelSummary } from '../src/app/commands';
import { FILE_VERSION, projectJson, upgradeProject } from '../src/app/project';
import { risingMain } from '../src/engine/cases';
import { defaultSettings, type Network } from '../src/engine/types';
import { _wire, chat, chatStream, setFetch, listModels, type ChatRequest } from '../src/ai/providers';
import { runAgent, toolDefs } from '../src/ai/agent';
import { mdToHtml } from '../src/ai/markdown';
import { buildReport } from '../src/report/report';
import { solveSteady } from '../src/engine/steady';
import { runTransient } from '../src/engine/transient';
import { designChecks } from '../src/engine/analysis';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const empty = (): Network => ({ name: 'x', nodes: [], pipes: [], pumps: [], valves: [], event: { kind: 'none', targets: [], start: 1 }, settings: { ...defaultSettings(), duration: 40 } });

(async () => {
  // ── commands ──
  {
    const ctx = localContext(empty());
    const line = await execute(ctx, 'build_line', {
      points: [{ id: 'SUMP', chainage_m: 0, elevation_m: 95 }, { id: 'PS', chainage_m: 20, elevation_m: 95 }, { id: 'HP', chainage_m: 2600, elevation_m: 146 }, { id: 'TANK', chainage_m: 5000, elevation_m: 147 }],
      diameter_mm: 600, wavespeed_mps: 1100, pressure_class_m: 160, start_water_level_m: 100, end_water_level_m: 150,
    });
    t('build_line: nodes and pipes from a long section', line.ok && ctx.net.nodes.length === 4 && ctx.net.pipes.length === 3 && ctx.net.nodes[0].kind === 'reservoir' && ctx.net.nodes[3].kind === 'reservoir', JSON.stringify(line.output));
    // put the pumps between PS and a new discharge node: split the first long pipe
    const ins = await execute(ctx, 'insert_on_pipe', { pipe: ctx.net.pipes[1].id, kind: 'junction', fraction: 0.01 });
    const dis = (ins.output as { id: string }).id;
    // remove the pipe PS→dis and replace it with pumps
    const pipeToDis = ctx.net.pipes.find((p) => p.to === dis)!;
    await execute(ctx, 'delete_elements', { refs: [{ type: 'pipe', id: pipeToDis.id }] });
    const ps = await execute(ctx, 'add_pump_station', { suction: 'PS', discharge: dis, count: 2, duty_flow_lps: 250, duty_head_m: 74, shutoff_head_m: 98 });
    t('add_pump_station: two pumps with estimated inertia', ps.ok && ctx.net.pumps.length === 2 && ctx.net.pumps[0].inertia > 1, JSON.stringify(ps.output));
    const ops = await execute(ctx, 'set_operations', { operations: [{ kind: 'pump_trip', targets: ctx.net.pumps.map((p) => p.id), start_s: 1 }] });
    t('set_operations: pump trip', ops.ok && ctx.net.event.kind === 'pumpTrip' && ctx.net.event.targets.length === 2);
    const bad = await execute(ctx, 'set_properties', { type: 'pipe', ids: [ctx.net.pipes[0].id], values: { diameter: 300 } });
    t('set_properties: unknown field explained', !bad.ok && String((bad.output as { error: string }).error).includes('diameter_mm'));
    const lim = await execute(ctx, 'set_properties', { type: 'pipe', ids: [ctx.net.pipes[0].id], values: { wavespeed_mps: 5000 } });
    t('set_properties: limits enforced', !lim.ok);
    const okp = await execute(ctx, 'set_properties', { type: 'pipe', ids: [ctx.net.pipes[0].id], values: { diameter_mm: 700 } });
    t('set_properties: value set in mm', okp.ok && Math.abs(ctx.net.pipes[0].diameter - 0.7) < 1e-12);
    const run1 = await execute(ctx, 'run_analysis', {});
    const s1 = run1.output as { lowest_pressure_m: { value: number } };
    t('run_analysis returns a summary from the engine', run1.ok && typeof s1.lowest_pressure_m.value === 'number', JSON.stringify(s1.lowest_pressure_m));
    const dev = await execute(ctx, 'add_device', { node: dis, device: 'vessel', values: { volume_m3: 30, gas_volume_m3: 15, connection_mm: 400 } });
    t('add_device: air vessel with values', dev.ok && ctx.net.nodes.find((n) => n.id === dis)?.vessel?.volume === 30);
    const run2 = await execute(ctx, 'run_analysis', {});
    const s2 = run2.output as { lowest_pressure_m: { value: number } };
    t('protection raises the lowest pressure', s2.lowest_pressure_m.value > s1.lowest_pressure_m.value, `${s1.lowest_pressure_m.value} → ${s2.lowest_pressure_m.value} m`);
    const nodes = await execute(ctx, 'get_results', { what: 'nodes', ids: ['HP'] });
    t('get_results: node pressures', nodes.ok && (nodes.output as unknown[]).length === 1);
    t('each change is one logged step', ctx.log.length >= 7 && ctx.log.every((l) => l.startsWith('AI: ')), ctx.log.join(' | '));
    const sum = modelSummary(ctx.net);
    t('model summary lists the operation', sum.operations.length === 1 && sum.operations[0].kind === 'pump_trip');
    const unk = await execute(ctx, 'nope', {});
    t('unknown command is an error, not a crash', !unk.ok);
    const missing = await execute(ctx, 'add_pipe', { from: 'X', to: 'HP', diameter_mm: 300 });
    t('missing node explained', !missing.ok && String((missing.output as { error: string }).error).includes('No node "X"'));
    t('every command has a JSON schema and description', COMMANDS.every((c) => c.description.length > 10 && (c.params as { type: string }).type === 'object'));
  }

  // ── extended period through commands ──
  {
    const ctx = localContext(empty());
    await execute(ctx, 'build_line', { points: [{ id: 'SRC', chainage_m: 0, elevation_m: 100 }, { id: 'J1', chainage_m: 1000, elevation_m: 60 }, { id: 'TK', chainage_m: 2000, elevation_m: 70 }], diameter_mm: 300, start_water_level_m: 120, end_water_level_m: 75 });
    const st = await execute(ctx, 'set_storage', { node: 'TK', init_level_m: 5, min_level_m: 1, max_level_m: 9, diameter_m: 12 });
    t('set_storage makes a tank', st.ok && !!ctx.net.nodes.find((n) => n.id === 'TK')?.storage);
    const badSt = await execute(ctx, 'set_storage', { node: 'J1' });
    t('set_storage refuses a junction', !badSt.ok);
    await execute(ctx, 'set_properties', { type: 'node', ids: ['J1'], values: { demand_lps: 20 } });
    const pt = await execute(ctx, 'set_patterns', { patterns: [{ id: 'D', factors: [0.5, 1, 1.5, 1] }], assign: [{ node: 'J1', pattern: 'D' }] });
    t('set_patterns assigns a pattern', pt.ok && ctx.net.nodes.find((n) => n.id === 'J1')?.pattern === 'D');
    const cs = await execute(ctx, 'set_controls', { controls: [{ link: ctx.net.pipes[1].id, status: 'closed', node: 'TK', op: 'above', value: 8 }] });
    t('set_controls', cs.ok && ctx.net.controls?.length === 1);
    const ebad = await execute(ctx, 'set_eps', { quality: 'trace' });
    t('set_eps: trace needs a node', !ebad.ok);
    await execute(ctx, 'set_eps', { duration_h: 12, step_min: 30, quality: 'age' });
    const rr = await execute(ctx, 'run_eps', {});
    const sum = rr.output as { tanks: { id: string; max_level_m: number }[]; quality?: unknown; lowest_pressure_m: { value: number } };
    t('run_eps summary from the engine', rr.ok && sum.tanks[0].id === 'TK' && !!sum.quality && Number.isFinite(sum.lowest_pressure_m.value), JSON.stringify(sum.tanks));
    const eng = await execute(ctx, 'set_run_settings', { engine: 'rigid' });
    t('set_run_settings: engine', eng.ok && ctx.net.settings.engine === 'rigid');
  }

  // ── project files ──
  {
    const v1 = { name: 'old', nodes: [{ id: 'A', kind: 'reservoir', x: 0, y: 0, elev: 0, head: 10 }], pipes: [] };
    const up = upgradeProject(v1);
    t('version 1 file opens (missing lists and settings filled)', up.pumps.length === 0 && up.valves.length === 0 && up.settings.duration > 0 && up.event.kind === 'none');
    const rm = risingMain(true);
    const round = upgradeProject(JSON.parse(projectJson(rm)));
    t('save → open round trip is identical', JSON.stringify(round) === JSON.stringify(upgradeProject(rm)));
    let msg = '';
    try { upgradeProject({ ...rm, fileVersion: FILE_VERSION + 1 }); } catch (e) { msg = (e as Error).message; }
    t('newer file refused with a clear message', msg.includes('newer'));
    let msg2 = '';
    try { upgradeProject({ foo: 1 }); } catch (e) { msg2 = (e as Error).message; }
    t('non-project file refused', msg2.includes('not a SurgeSpace project'));
  }

  // ── provider wire formats ──
  {
    const req: ChatRequest = {
      system: 'sys',
      tools: [{ name: 'get_model', description: 'd', params: { type: 'object', properties: {}, additionalProperties: false } }],
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'hi' }, { type: 'pdf', name: 'a.pdf', data: 'AAA' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'ok' }, { type: 'tool_call', id: 'c1', name: 'get_model', args: {} }] },
        { role: 'user', parts: [{ type: 'tool_result', id: 'c1', name: 'get_model', output: { n: 1 } }] },
      ],
    };
    const a = _wire.toAnthropic(req) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    t('Anthropic: system, document, tool_use and tool_result', a.system === 'sys' && a.messages[0].content[1].type === 'document' && a.messages[1].content[1].type === 'tool_use' && a.messages[2].content[0].tool_use_id === 'c1' && a.tools[0].input_schema.type === 'object');
    const ar = _wire.fromAnthropic({ content: [{ type: 'text', text: 'x' }, { type: 'tool_use', id: 't', name: 'run_analysis', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 7 } });
    t('Anthropic: tool call parsed', ar.stop === 'tool_use' && ar.parts[1].type === 'tool_call' && ar.usage?.output === 7);
    const o = _wire.toOpenAI(req, 'm') as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    t('OpenAI: system first, file part, tool_calls, tool message', o.messages[0].role === 'system' && o.messages[1].content[1].type === 'file' && o.messages[2].tool_calls[0].function.name === 'get_model' && o.messages[3].role === 'tool' && o.tools[0].type === 'function');
    const orr = _wire.fromOpenAI({ choices: [{ message: { content: null, tool_calls: [{ id: 'x', function: { name: 'get_model', arguments: '{"a":1}' } }] }, finish_reason: 'tool_calls' }] });
    t('OpenAI: tool call arguments parsed', orr.stop === 'tool_use' && (orr.parts[0] as { args: { a: number } }).args.a === 1);
    const g = _wire.toGemini(req) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    t('Gemini: roles, inline PDF, function call/response, schema cleaned', g.contents[1].role === 'model' && g.contents[0].parts[1].inlineData.mimeType === 'application/pdf' && g.contents[2].parts[0].functionResponse.name === 'get_model' && !('additionalProperties' in g.tools[0].functionDeclarations[0].parameters));
    const gr = _wire.fromGemini({ candidates: [{ content: { parts: [{ functionCall: { name: 'run_analysis', args: {} } }] }, finishReason: 'STOP' }] });
    t('Gemini: function call parsed', gr.stop === 'tool_use' && gr.parts[0].type === 'tool_call');
    // the whole tool list must be acceptable to Gemini's schema subset (no additionalProperties anywhere)
    const cleaned = JSON.stringify(_wire.geminiSchema(toolDefs().map((x) => x.params)));
    t('Gemini: all command schemas cleaned', !cleaned.includes('additionalProperties'));

    // transport: headers and URLs
    const seen: { url: string; headers: Record<string, string>; body: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    setFetch((async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : null });
      if (String(url).includes('bad')) return new Response(JSON.stringify({ error: { message: 'invalid x-api-key' } }), { status: 401 });
      if (init.method === 'GET') return new Response(JSON.stringify({ data: [{ id: 'm2' }, { id: 'm1' }] }), { status: 200 });
      if (String(url).includes('anthropic')) return new Response(JSON.stringify({ content: [{ type: 'text', text: 'OK' }], stop_reason: 'end_turn' }), { status: 200 });
      if (String(url).includes('generativelanguage')) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }), { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] }), { status: 200 });
    }) as typeof fetch);
    const simple = { system: 's', messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'q' }] }] };
    await chat({ provider: 'anthropic', model: 'claude-x', apiKey: 'k1' }, simple);
    t('Anthropic request: URL, key header, browser header, model', seen[0].url === 'https://api.anthropic.com/v1/messages' && seen[0].headers['x-api-key'] === 'k1' && seen[0].headers['anthropic-dangerous-direct-browser-access'] === 'true' && seen[0].body.model === 'claude-x');
    await chat({ provider: 'deepseek', model: 'deepseek-chat', apiKey: 'k2' }, simple);
    t('OpenAI-compatible request: bearer key, max_tokens for non-OpenAI', seen[1].url === 'https://api.deepseek.com/v1/chat/completions' && seen[1].headers.authorization === 'Bearer k2' && seen[1].body.max_tokens === 4096);
    await chat({ provider: 'azure', model: 'dep', apiKey: 'k3', baseUrl: 'https://r.openai.azure.com/openai/v1/' }, simple);
    t('Azure: api-key header and own endpoint', seen[2].url === 'https://r.openai.azure.com/openai/v1/chat/completions' && seen[2].headers['api-key'] === 'k3');
    await chat({ provider: 'gemini', model: 'gemini-2.5-pro', apiKey: 'k4' }, simple);
    t('Gemini request: model in URL, key header', seen[3].url.endsWith('/models/gemini-2.5-pro:generateContent') && seen[3].headers['x-goog-api-key'] === 'k4');
    await chat({ provider: 'ollama', model: 'qwen', baseUrl: 'http://localhost:11434/v1' }, simple);
    t('Local model: no key needed', seen[4].url === 'http://localhost:11434/v1/chat/completions' && !seen[4].headers.authorization);
    let err = '';
    try { await chat({ provider: 'openai', model: 'm', apiKey: 'k', baseUrl: 'https://bad.example/v1' }, simple); } catch (e) { err = (e as Error).message; }
    t('refused key explained', err.includes('invalid x-api-key') && err.includes('AI accounts'));
    let err2 = '';
    try { await chat({ provider: 'openai', model: 'm' }, simple); } catch (e) { err2 = (e as Error).message; }
    t('missing key explained before any request', err2.includes('Add your OpenAI key'));
    const models = await listModels({ provider: 'mistral', model: '', apiKey: 'k' });
    t('model list from the account, sorted', models.join(',') === 'm1,m2');
  }

  // ── agent ──
  {
    const ctx = localContext(risingMain(false));
    let turn = 0;
    const script = async (_cfg: unknown, req: ChatRequest) => {
      turn++;
      if (turn === 1) return { parts: [{ type: 'tool_call' as const, id: 'a', name: 'run_analysis', args: {} }], stop: 'tool_use' as const };
      if (turn === 2) {
        // the model sees the engine's numbers in the tool result
        const last = req.messages[req.messages.length - 1].parts[0] as { output: { lowest_pressure_m: { value: number } } };
        const v = last.output.lowest_pressure_m.value;
        return { parts: [{ type: 'text' as const, text: `Lowest pressure ${v} m.` }, { type: 'tool_call' as const, id: 'b', name: 'add_device', args: { node: 'PS-D', device: 'vessel', values: { volume_m3: 30, gas_volume_m3: 15 } } }], stop: 'tool_use' as const };
      }
      if (turn === 3) return { parts: [{ type: 'tool_call' as const, id: 'c', name: 'run_analysis', args: {} }], stop: 'tool_use' as const };
      return { parts: [{ type: 'text' as const, text: 'Done.' }], stop: 'end' as const };
    };
    const steps: string[] = [];
    const out = await runAgent({ cfg: { provider: 'anthropic', model: 'x', apiKey: 'k' }, ctx, history: [{ role: 'user', parts: [{ type: 'text', text: 'Protect this main.' }] }], chatFn: script as never, onStep: (s) => steps.push(s.kind === 'tool' ? `tool:${s.name}:${s.ok}` : `text:${s.text}`) });
    t('agent: tools run in order and the loop ends', turn === 4 && steps.filter((s) => s.startsWith('tool:')).join(',') === 'tool:run_analysis:true,tool:add_device:true,tool:run_analysis:true', steps.join(' | '));
    t('agent: device added through the command layer', !!ctx.net.nodes.find((n) => n.id === 'PS-D')?.vessel && ctx.log.some((l) => l.includes('vessel')));
    t('agent: conversation keeps calls and results paired', out.messages.filter((m) => m.parts.some((p) => p.type === 'tool_result')).length === 3);
    // a failing tool comes back as an error result the model can read
    const ctx2 = localContext(risingMain(false));
    let k = 0;
    await runAgent({ cfg: { provider: 'x', model: 'x' }, ctx: ctx2, history: [{ role: 'user', parts: [{ type: 'text', text: 'x' }] }], chatFn: (async (_c: unknown, req: ChatRequest) => { k++; if (k === 1) return { parts: [{ type: 'tool_call', id: 'z', name: 'add_pipe', args: { from: 'NOPE', to: 'TANK', diameter_mm: 100 } }], stop: 'tool_use' }; const r = req.messages[req.messages.length - 1].parts[0] as { isError: boolean }; return { parts: [{ type: 'text', text: r.isError ? 'saw error' : 'no error' }], stop: 'end' }; }) as never, onStep: (s) => s.kind === 'text' && steps.push(s.text!) });
    t('agent: tool errors are returned to the model', steps.includes('saw error'));
  }

  // ── markdown and report narrative ──
  {
    const h = mdToHtml('# Title\n\nText with **bold** and <script>x</script>.\n\n- a\n- b\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    t('markdown: heading, list, table', h.includes('<h2>Title</h2>') && h.includes('<li>a</li>') && h.includes('<td>2</td>') && h.includes('<b>bold</b>'));
    t('markdown: HTML is escaped', !h.includes('<script>') && h.includes('&lt;script&gt;'));
    const net = { ...risingMain(true), report: { narrative: '## Introduction\n\nThe main lifts water.', narrativeByAI: true } };
    const steady = solveSteady(net);
    const r = runTransient(net, { steady, frames: 100 });
    const html = buildReport(net, r, designChecks(net, r), { version: 'test', route: ['SUMP', 'TANK'], nodes: [] });
    t('report: narrative included and marked as AI-drafted', html.includes('Report narrative') && html.includes('The main lifts water.') && html.includes('AI copilot'));
  }

  {
    // streaming: text arrives piece by piece; tool calls are assembled from fragments, for all three wire formats
    const sse = (events: unknown[], split = 7) => {
      const raw = events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');
      const chunks: string[] = [];
      for (let k = 0; k < raw.length; k += split) chunks.push(raw.slice(k, k + split)); // cut anywhere, as a network would
      return new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    };
    const req: ChatRequest = { system: 's', messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }], tools: [{ name: 'run_analysis', description: 'd', params: { type: 'object', properties: {} } }] };
    let sent: Record<string, unknown> = {};
    setFetch((async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return sse([
      { type: 'message_start', message: { usage: { input_tokens: 12 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Running ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'it now.' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'run_analysis' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"dura' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'tion_s": 60}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } },
    ]); }) as never);
    const got: string[] = [];
    const a = await chatStream({ provider: 'anthropic', model: 'm', apiKey: 'k' }, req, (d) => got.push(d));
    t('streaming (Anthropic): text in pieces, tool call assembled, usage', sent.stream === true && got.join('') === 'Running it now.' && got.length === 2 && a.stop === 'tool_use' && JSON.stringify(a.parts[1]) === JSON.stringify({ type: 'tool_call', id: 't1', name: 'run_analysis', args: { duration_s: 60 } }) && a.usage?.input === 12 && a.usage?.output === 9);
    setFetch((async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return sse([
      { choices: [{ delta: { content: 'Hel' } }] }, { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'run_analysis', arguments: '{"a":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3 } }, '[DONE]',
    ]); }) as never);
    const got2: string[] = [];
    const o = await chatStream({ provider: 'openai', model: 'm', apiKey: 'k' }, req, (d) => got2.push(d));
    t('streaming (OpenAI and compatible): text, tool call from fragments, usage', sent.stream === true && got2.join('') === 'Hello' && o.stop === 'tool_use' && (o.parts[1] as { args: unknown }).args && JSON.stringify((o.parts[1] as { args: unknown }).args) === '{"a":1}' && o.usage?.output === 3);
    let url = '';
    setFetch((async (u: string) => { url = u; return sse([
      { candidates: [{ content: { parts: [{ text: 'Gem' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'ini' }, { functionCall: { name: 'run_analysis', args: { x: 2 } } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } },
    ]); }) as never);
    const got3: string[] = [];
    const g = await chatStream({ provider: 'gemini', model: 'gemini-x', apiKey: 'k' }, req, (d) => got3.push(d));
    t('streaming (Gemini): SSE endpoint, text joined, function call', url.includes(':streamGenerateContent?alt=sse') && got3.join('') === 'Gemini' && g.parts[0].type === 'text' && (g.parts[0] as { text: string }).text === 'Gemini' && g.stop === 'tool_use');
    // a server that ignores the stream request: the plain answer is used and still shown
    setFetch((async () => new Response(JSON.stringify({ choices: [{ message: { content: 'whole answer' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } })) as never);
    const got4: string[] = [];
    const w = await chatStream({ provider: 'ollama', model: 'm' }, req, (d) => got4.push(d));
    t('streaming falls back to a plain answer', got4.join('') === 'whole answer' && w.stop === 'end');
    setFetch((async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401, headers: { 'content-type': 'application/json' } })) as never);
    let err = '';
    try { await chatStream({ provider: 'openai', model: 'm', apiKey: 'k' }, req, () => {}); } catch (e) { err = (e as Error).message; }
    t('streaming reports errors with the usual hint', err.includes('bad key') && err.includes('AI accounts'));
    // the agent streams when asked
    setFetch((async () => sse([{ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }] }])) as never);
    const deltas: string[] = [];
    const ctxS = localContext(risingMain(true));
    await runAgent({ cfg: { provider: 'openai', model: 'm', apiKey: 'k' }, ctx: ctxS, history: [{ role: 'user', parts: [{ type: 'text', text: 'x' }] }], onDelta: (x) => deltas.push(x) });
    t('agent streams the reply as it is written', deltas[deltas.length - 1] === 'Done.');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
