// Cases stored as differences from a parent: inheritance, overrides, save and load.
import { addCase, deleteCase, detachCase, diffModel, applyDiff, switchCase, syncActive } from '../src/app/cases';
import { projectJson, upgradeProject } from '../src/app/project';
import { risingMain } from '../src/engine/cases';
import type { Network } from '../src/engine/types';

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const edit = (n: Network, f: (n: Network) => Network) => f(n);

let net = risingMain(true);
// base → child: the child adds a larger vessel and slows nothing else
net = addCase(net, 'Bigger vessel', true);
const childId = net.activeCase!;
const baseId = net.cases![0].id;
net = edit(net, (n) => ({ ...n, nodes: n.nodes.map((x) => (x.vessel ? { ...x, vessel: { ...x.vessel, volume: x.vessel.volume * 2 } } : x)) }));
const vesselNode = net.nodes.find((x) => x.vessel)!.id;
let cs = syncActive(net);
const child = cs.find((c) => c.id === childId)!;
t('child stores only its change', !!child.diff?.nodes?.changed?.[vesselNode] && Object.keys(child.diff.nodes!.changed!).length === 1 && !child.diff.pipes && !child.diff.fields, JSON.stringify(child.diff).slice(0, 120));
// back to the base, change a pipe length: the child inherits it, keeps its own vessel
net = switchCase(net, baseId);
const vol0 = net.nodes.find((x) => x.id === vesselNode)!.vessel!.volume;
net = edit(net, (n) => ({ ...n, pipes: n.pipes.map((p) => (p.id === 'M2' ? { ...p, length: p.length + 123 } : p)), settings: { ...n.settings, duration: 77 } }));
cs = syncActive(net);
const ch2 = cs.find((c) => c.id === childId)!.model;
t('parent change to a pipe flows into the child', ch2.pipes.find((p) => p.id === 'M2')!.length === net.pipes.find((p) => p.id === 'M2')!.length);
t('parent change to the run setup flows into the child', ch2.settings.duration === 77);
t('child keeps its own override', ch2.nodes.find((x) => x.id === vesselNode)!.vessel!.volume === vol0 * 2);
// grandchild of the child
net = switchCase(net, childId);
net = addCase(net, 'No air valve', true);
const gcId = net.activeCase!;
net = edit(net, (n) => ({ ...n, nodes: n.nodes.map((x) => { if (!x.airValve) return x; const y = { ...x }; delete y.airValve; return y; }) }));
net = switchCase(net, baseId);
net = edit(net, (n) => ({ ...n, pipes: n.pipes.map((p) => (p.id === 'M3' ? { ...p, roughness: 0.0009 } : p)) }));
cs = syncActive(net);
const gc = cs.find((c) => c.id === gcId)!;
t('grandchild inherits through two levels and keeps both overrides', gc.model.pipes.find((p) => p.id === 'M3')!.roughness === 0.0009 && gc.model.nodes.find((x) => x.id === vesselNode)!.vessel!.volume === vol0 * 2 && !gc.model.nodes.some((x) => x.airValve) && gc.diff?.nodes?.changed && Object.values(gc.diff.nodes.changed).every((c) => c.airValve === null));
// save and load: child cases saved as differences only
const json = projectJson({ ...net, cases: syncActive(net) });
const file = JSON.parse(json);
const savedChild = file.cases.find((c: { id: string }) => c.id === childId);
t('file keeps only the differences for child cases', !savedChild.model && !!savedChild.diff && JSON.stringify(file).length < 2.3 * JSON.stringify(net.cases![0].model).length, `${(JSON.stringify(file).length / 1024).toFixed(1)} kB for 3 cases`);
const back = upgradeProject(file);
const gcBack = back.cases!.find((c) => c.id === gcId)!;
t('loading resolves the children', JSON.stringify(gcBack.model) === JSON.stringify(gc.model));
// detach and delete
const det = detachCase(net, childId);
t('detach makes a complete copy', !det.cases!.find((c) => c.id === childId)!.parent && !!det.cases!.find((c) => c.id === childId)!.model);
const del = deleteCase(net, childId);
const gcAfter = del.cases!.find((c) => c.id === gcId)!;
t('deleting a parent keeps its children as complete copies', !gcAfter.parent && gcAfter.model.nodes.find((x) => x.id === vesselNode)!.vessel!.volume === vol0 * 2);
// diff / apply round trip on unrelated models
const a = risingMain(false), b = risingMain(true);
const { cases: _c, activeCase: _a, ...am } = a; const { cases: _d, activeCase: _e, ...bm } = b; void _c; void _a; void _d; void _e;
t('diff and apply reproduce the child exactly', JSON.stringify(applyDiff(am, diffModel(am, bm))) === JSON.stringify(bm));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
