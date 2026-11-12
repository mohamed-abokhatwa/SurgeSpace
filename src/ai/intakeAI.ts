// The AI side of "model from documents": each page (as images plus the PDF's exact text), each spreadsheet the
// header rules could not read, and each DXF summary is sent to the engineer's own AI provider with one tool,
// record_evidence, whose items become the evidence register for review.
import { chat, type AIConfig, type Part } from './providers';
import { EXTRACT_SYSTEM, RECORD_TOOL, pageTextForAI, pageTiles, parseRecorded, type Evidence, type IntakeDoc, type IntakePage } from '../app/intake';

export interface ExtractResult { summary: string; items: Evidence[]; usage?: { input: number; output: number } }

async function ask(cfg: AIConfig, parts: Part[], src: { doc: string; page?: number }, signal?: AbortSignal): Promise<ExtractResult> {
  const r = await chat(cfg, { system: EXTRACT_SYSTEM, messages: [{ role: 'user', parts }], tools: [RECORD_TOOL], maxTokens: 8000, signal });
  const call = r.parts.find((p) => p.type === 'tool_call' && p.name === RECORD_TOOL.name) as Extract<Part, { type: 'tool_call' }> | undefined;
  const text = r.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n').trim();
  if (!call) return { summary: text || 'The AI did not record anything for this page.', items: [], usage: r.usage };
  const out = parseRecorded(call.args, src);
  return { summary: out.summary || text, items: out.items, usage: r.usage };
}

export async function extractPage(cfg: AIConfig, doc: IntakeDoc, page: IntakePage, signal?: AbortSignal): Promise<ExtractResult> {
  const tiles = await pageTiles(page);
  const parts: Part[] = [{ type: 'text', text: `Document "${doc.name}", page ${page.n} of ${doc.pages.length}. The first image is the whole page; the next ones (if any) are its four quadrants at full resolution (top-left, top-right, bottom-left, bottom-right, each 55 % of the page and overlapping), for reading small print. Boxes are always in fractions of the whole page.` }];
  for (const t of tiles) parts.push({ type: 'image', mime: t.mime, data: t.data });
  const txt = pageTextForAI(page);
  if (txt) parts.push({ type: 'text', text: txt });
  parts.push({ type: 'text', text: 'Record everything relevant for the surge model with record_evidence.' });
  return ask(cfg, parts, { doc: doc.id, page: page.n }, signal);
}

export async function extractSheet(cfg: AIConfig, doc: IntakeDoc, signal?: AbortSignal): Promise<ExtractResult> {
  const txt = (doc.sheets ?? []).map((sh) => `Sheet "${sh.name}" (row number first, then the cells, tab-separated):\n${sh.rows.slice(0, 250).map((r, i) => `${i + 1}\t${r.map((c) => (c === null ? '' : String(c))).join('\t')}`).join('\n')}`).join('\n\n');
  return ask(cfg, [{ type: 'text', text: `Spreadsheet "${doc.name}". Read it as an engineer: long sections (chainage and level), pipe schedules, valve and air valve schedules, pump data. Give the cell reference (e.g. "Sheet1!B12") in the label of each item.\n\n${txt.slice(0, 60000)}` }], { doc: doc.id }, signal);
}

export async function extractDxf(cfg: AIConfig, doc: IntakeDoc, signal?: AbortSignal): Promise<ExtractResult> {
  const d = doc.dxf!;
  const txt = [
    `CAD drawing "${doc.name}" (DXF). Layers with line counts: ${d.layers.map((l) => `${l.name} (${l.lines})`).join(', ')}.`,
    `Symbol blocks (name, count, first positions): ${d.blocks.map((b) => `${b.name} ×${b.count} at ${b.at.slice(0, 6).map(([x, y]) => `(${x.toFixed(1)}, ${y.toFixed(1)})`).join(' ')}`).join('; ') || 'none'}.`,
    `Texts (layer: text @ position${d.texts.length > 500 ? `; the first 500 of ${d.texts.length}` : ''}):\n${d.texts.slice(0, 500).map((t) => `${t.layer}: ${t.s} @ (${t.x.toFixed(1)}, ${t.y.toFixed(1)})`).join('\n') || 'none'}`,
    'Work out which symbol blocks are air valves, washouts, line valves, check valves, pumps; and read chainages, levels, diameters and material from the texts (a label such as "ARV DN100 CH 0+950" is an air valve at chainage 950 m). Record each item; put the block or layer name in the label. Also, for EVERY symbol block, record one note item with the fields block (the block name exactly) and kind (one of airValve, washout, valve, checkValve, pump, reservoir, tank, hydrant, ignore), and one note item with fields layer (the layer name) and kind = pipe for each layer that holds pipelines (not roads, kerbs, buildings, contours or text).',
  ].join('\n\n');
  return ask(cfg, [{ type: 'text', text: txt.slice(0, 60000) }], { doc: doc.id }, signal);
}

export async function extractText(cfg: AIConfig, doc: IntakeDoc, signal?: AbortSignal): Promise<ExtractResult> {
  return ask(cfg, [{ type: 'text', text: `Document "${doc.name}":\n\n${(doc.text ?? '').slice(0, 60000)}` }], { doc: doc.id }, signal);
}
