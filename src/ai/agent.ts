// The copilot: a tool-using loop. The model plans; every action is a SurgeSpace command; every number it reports
// comes from the engine through those commands.
import { COMMANDS, execute, type CommandContext } from '../app/commands';
import { chat, type AIConfig, type ChatResponse, type Message, type Part, type ToolDef } from './providers';

export const SYSTEM_PROMPT = `You are the SurgeSpace copilot, a senior hydraulic transient (water hammer) engineer working inside the SurgeSpace app with the user.

How you work:
- You change the model and run the analysis ONLY through the tools. Every number you state (pressures, volumes, speeds) must come from a tool result in this conversation. Never estimate a result the engine can compute; run it.
- Start by calling get_model unless you already know the model. After changing the model, run_analysis before you talk about results.
- Units in tools are SI as named in each field (m, mm, L/s, m/s, s, m³, kg·m²). Pressures are metres of water head.
- When a request is ambiguous and a wrong guess would waste work (e.g. which pump, which limit), ask one short question. Otherwise choose sensible engineering defaults and say what you assumed.
- Typical values: wave speed 1000–1250 m/s ductile iron/steel, 300–450 PVC, 250–400 PE; roughness 0.1 mm DI, 0.045 steel, 0.007 PE; minimum pressure limit −5 m (or 0 m if no sub-atmospheric pressure is allowed); maximum = pipe class.
- For protection design: try the realistic options with the tools (air vessel at the pump discharge sized with size_air_vessel, air valves at high points via suggest_air_valves, slower valve closure, feed tank, anticipator valve, more pump inertia), run each, compare highest and lowest pressure, vapour cavities and device behaviour, then recommend one with reasons. Leave the model with the recommended option applied and say how to undo.
- Two surge engines: wave (default, method of characteristics with column separation: every fast event) and rigid column (set_run_settings engine "rigid": slow operations, surge tank or vessel mass oscillation, long runs). Say which you used.
- Daily operation (extended period): fixed-level sources become storage tanks with set_storage; demand patterns with set_patterns; pump switching with set_controls; duration, step and water quality (age, trace, chemical such as chlorine) with set_eps; then run_eps. Use it for tank sizing, pump cycling, pressure through the day, water age and chlorine residuals.
- For least-cost protection use optimise_protection (genetic algorithm over real surge runs) after trying the obvious options; for very large models suggest skeletonise first.
- Pumps without a non-return valve can turn backwards after a trip: set four_quadrant "generic" (or "suter" with manufacturer data) with set_properties before the surge run.
- When you build a model, lay it out readably: x along the route (chainage), y following the levels.
- Keep the reply short and practical. Use plain language, short paragraphs or bullets, and name the elements (ids) you changed so the user can find them.`;

export const toolDefs = (): ToolDef[] => COMMANDS.map((c) => ({ name: c.name, description: c.description, params: c.params }));

export interface AgentStep { kind: 'text' | 'tool'; text?: string; name?: string; args?: unknown; ok?: boolean; output?: unknown }
export interface AgentOptions {
  cfg: AIConfig;
  ctx: CommandContext;
  history: Message[];
  system?: string;
  maxSteps?: number;
  signal?: AbortSignal;
  onStep?: (s: AgentStep) => void;
  /** Called with the whole conversation after each model turn and each batch of tool results. */
  onUpdate?: (m: Message[]) => void;
  /** Replace the network transport (tests). */
  chatFn?: typeof chat;
}

/** Run turns until the model stops calling tools. Returns the full conversation including tool calls and results. */
export async function runAgent(o: AgentOptions): Promise<{ messages: Message[]; usage: { input: number; output: number } }> {
  const messages = [...o.history];
  const tools = toolDefs();
  const usage = { input: 0, output: 0 };
  const call = o.chatFn ?? chat;
  for (let step = 0; step < (o.maxSteps ?? 30); step++) {
    if (o.signal?.aborted) break;
    const r: ChatResponse = await call(o.cfg, { system: o.system ?? SYSTEM_PROMPT, messages: compact(messages), tools, maxTokens: 4096, signal: o.signal });
    if (r.usage) { usage.input += r.usage.input; usage.output += r.usage.output; }
    messages.push({ role: 'assistant', parts: r.parts });
    o.onUpdate?.([...messages]);
    for (const p of r.parts) if (p.type === 'text' && p.text.trim()) o.onStep?.({ kind: 'text', text: p.text });
    const calls = r.parts.filter((p) => p.type === 'tool_call') as Extract<Part, { type: 'tool_call' }>[];
    if (!calls.length) break;
    const results: Part[] = [];
    for (const c of calls) {
      // every call gets a result, so the conversation stays valid for the next request even after a stop
      if (o.signal?.aborted) { results.push({ type: 'tool_result', id: c.id, name: c.name, output: { error: 'Stopped by the user.' }, isError: true }); continue; }
      const res = await execute(o.ctx, c.name, c.args);
      o.onStep?.({ kind: 'tool', name: c.name, args: c.args, ok: res.ok, output: res.output });
      results.push({ type: 'tool_result', id: c.id, name: c.name, output: res.output, isError: !res.ok });
    }
    messages.push({ role: 'user', parts: results });
    o.onUpdate?.([...messages]);
  }
  return { messages, usage };
}

/** Keep the request size sensible: large tool outputs from early turns are shortened (the model can call again). */
function compact(m: Message[]): Message[] {
  const keepFull = 6;
  return m.map((msg, i) => (i >= m.length - keepFull ? msg : {
    ...msg,
    parts: msg.parts.map((p) => {
      if (p.type !== 'tool_result') return p;
      const s = JSON.stringify(p.output);
      return s.length > 1500 ? { ...p, output: `${s.slice(0, 1500)}… (shortened; call the tool again for the full result)` } : p;
    }),
  }));
}

/** One-click tasks: the prompt the copilot receives. */
export const AI_TASKS: { id: string; label: string; prompt: string; needsResults?: boolean }[] = [
  { id: 'explain', label: 'Explain the results', needsResults: true, prompt: 'Explain the results of the last run in plain language for the engineer: what the operations did, how the pressure waves behaved, where and when the worst high and low pressures occur and why, whether any vapour cavities or slams happened, how the protection devices behaved, and which design checks fail. Use get_results; highlight the critical locations with select_elements. End with the two or three most important actions.' },
  { id: 'review', label: 'Review my model', prompt: 'Review the model like a senior surge engineer before it is run: call get_model and health_check, then look for implausible or missing data (wave speeds for the pipe materials, pump inertia versus the duty power, missing air valves at high points, missing non-return valves at pumps, pressure classes, run length versus wave periods, operations that do not match the purpose). Do not change anything; list findings by importance with the element ids and the fix you suggest.' },
  { id: 'protect', label: 'Design the protection', prompt: 'Design surge protection for this system. Run the current model first to see the problem. Then try the realistic options with the tools (air vessel at the pump discharge using size_air_vessel, air valves at high points with suggest_air_valves, other options if relevant), run each, and compare them in a short table (highest pressure, lowest pressure, vapour cavity, device size). Apply the option you recommend and explain why. Mention that every change can be undone.' },
  { id: 'daily', label: 'Review daily operation', prompt: 'Review the daily operation of this system with the extended-period simulation. If there are no storage tanks, patterns or controls, say what is missing and propose typical ones (ask before adding them). Run run_eps and report: tank level range and whether tanks fill and empty sensibly, pump starts and running hours, energy, lowest and highest pressures with times and nodes, and water quality (age or chlorine) problems. End with the two or three most useful changes.' },
  { id: 'report', label: 'Draft the report narrative', needsResults: true, prompt: 'Write the narrative for the transient analysis report from the model and the last results (use get_model and get_results; run_analysis if there are no results). Sections: 1 Introduction and system description, 2 Method and assumptions, 3 Operating cases analysed, 4 Results and discussion, 5 Surge protection, 6 Conclusions and recommendations. Formal consultancy style, specific numbers from the tool results only, no invented data. Return only the report text in Markdown.' },
];

/** Prompt for reading an attached document into the model. */
export const READ_DOC_PROMPT = 'Read the attached document. Identify the hydraulic data in it (pump curves and duty points, speed, inertia, efficiency; pipe lengths, diameters, materials, classes; long-section chainages and levels; valve data; tank levels). Show what you found in a short table, then ask whether to put it into the model. When the user agrees, apply it with the tools.';
