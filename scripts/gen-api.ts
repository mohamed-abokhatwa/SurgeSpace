// Regenerate docs/API.md from the command registry: npx tsx scripts/gen-api.ts
import { writeFileSync } from 'node:fs';
import { COMMANDS } from '../src/app/commands';

type Schema = { type?: string; enum?: string[]; description?: string; items?: Schema; properties?: Record<string, Schema>; required?: string[] };
const typeOf = (s: Schema): string => (s.enum ? `${s.type ?? 'string'} (${s.enum.join(', ')})` : s.type === 'array' ? `array${s.items?.type ? ` of ${s.items.type}` : ''}` : s.type ?? 'any');
const out: string[] = ['# SurgeSpace command API', '', 'Every change to a model goes through these commands — the menus, the AI copilot and scripts (Tools → Script console: `await ss.<name>({…})`) use the same set, so every change is one undo step and every number comes from the engines. Units are SI as named in each parameter.', '', 'Generated from `src/app/commands.ts` by `scripts/gen-api.ts`.', ''];
for (const c of COMMANDS) {
  out.push(`## ${c.name}${c.mutates ? '' : ' (read only)'}`, '', c.description, '');
  const p = c.params as Schema;
  const props = Object.entries(p.properties ?? {});
  if (props.length) {
    out.push('| Parameter | Type | Required | Description |', '|---|---|---|---|');
    for (const [k, s] of props) out.push(`| \`${k}\` | ${typeOf(s)} | ${p.required?.includes(k) ? 'yes' : ''} | ${(s.description ?? (s.items?.properties ? `Items: ${Object.keys(s.items.properties).join(', ')}` : '')).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`);
    out.push('');
  }
}
writeFileSync(new URL('../docs/API.md', import.meta.url), out.join('\n'));
console.log(`${COMMANDS.length} commands written to docs/API.md`);
