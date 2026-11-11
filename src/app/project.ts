// Project file format: a version number and an upgrade path, so files from older versions always open.
import { defaultSettings, type Network } from '../engine/types';

/** Version history: 1 = SurgeSpace 1.x (no version field); 2 = 2.0 (cases, operations list, units, turbines);
 *  3 = 2.1 (fileVersion field; report narrative). */
export const FILE_VERSION = 3;

export interface ProjectFile extends Network {
  fileVersion?: number;
  app?: string;
}

/** Bring any saved project up to the current format. Throws with a plain message when the file is not a project. */
export function upgradeProject(raw: unknown): Network {
  if (!raw || typeof raw !== 'object') throw new Error('This file is not a SurgeSpace project.');
  const p = structuredClone(raw) as ProjectFile;
  if (!Array.isArray(p.nodes) || !Array.isArray(p.pipes)) throw new Error('This file is not a SurgeSpace project (no nodes or pipes).');
  const v = p.fileVersion ?? 1;
  if (v > FILE_VERSION) throw new Error(`This project was saved by a newer SurgeSpace (file version ${v}). Update the app to open it.`);
  // 1 → 2: lists that older files may lack
  p.pumps ??= [];
  p.valves ??= [];
  p.event ??= { kind: 'none', targets: [], start: 1 };
  p.event.targets ??= [];
  p.settings = { ...defaultSettings(), ...(p.settings ?? {}) };
  p.name ??= 'Untitled model';
  for (const n of p.nodes) if (n.kind !== 'reservoir' && n.kind !== 'junction') n.kind = 'junction';
  // 2 → 3: nothing to convert; the version field is added on save
  if (p.cases) for (const c of p.cases) c.model = upgradeProject({ ...c.model, fileVersion: v }) as typeof c.model;
  delete p.fileVersion;
  delete p.app;
  return p;
}

/** Serialise a project for saving. */
export function projectJson(net: Network): string {
  return JSON.stringify({ app: 'SurgeSpace', fileVersion: FILE_VERSION, ...net }, null, 1);
}
