// Line icons (24 × 24, currentColor) for the elements and the commands. Drawn for SurgeSpace.
import type { ReactNode } from 'react';
import type { ElementKind } from '../app/elements';

const P = ({ children, size = 18, title }: { children: ReactNode; size?: number; title?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
    {title && <title>{title}</title>}
    {children}
  </svg>
);

export const ELEMENT_ICONS: Record<ElementKind, ReactNode> = {
  junction: <><path d="M3 12h6M15 12h6" /><circle cx="12" cy="12" r="3" /></>,
  reservoir: <><path d="M4 7h16l-2 12H6z" /><path d="M5 11c2-1.5 3.5 1.5 5.5 0s3.5 1.5 5.5 0 2 .5 3 .2" /></>,
  levelSource: <><path d="M4 9h16l-2 11H6z" /><path d="M6 5c1.5-2 3 2 4.5 0S13.5 3 15 5s3 0 3.5-.5" /><path d="M5.5 13c2-1.5 3.5 1.5 5.5 0s3.5 1.5 5.5 0" /></>,
  pipe: <><path d="M3 17L10 10l4 3 7-7" /><circle cx="3" cy="17" r="1.6" /><circle cx="21" cy="6" r="1.6" /></>,
  pump: <><path d="M2 12h4M18 12h4" /><circle cx="12" cy="12" r="6" /><path d="M10 8.8l4.5 3.2-4.5 3.2z" fill="currentColor" /></>,
  turbine: <><path d="M2 12h4M18 12h4" /><circle cx="12" cy="12" r="6" /><path d="M12 6c-2 2-2 4 0 6s2 4 0 6M6 12c2-2 4-2 6 0s4 2 6 0" /></>,
  lineValve: <><path d="M2 12h3M19 12h3" /><path d="M5 7l14 10V7L5 17z" /><path d="M12 12V5M9 5h6" /></>,
  nrv: <><path d="M2 12h3M19 12h3" /><path d="M5 7l14 10V7L5 17z" /><path d="M19 5v14" strokeWidth={2.2} /></>,
  prv: <><path d="M2 14h3M19 14h3" /><path d="M5 9l14 10V9L5 19z" /><rect x="7" y="2" width="10" height="5" rx="1" /></>,
  psv: <><path d="M2 14h3M19 14h3" /><path d="M5 9l14 10V9L5 19z" /><path d="M8 4.5h8M8 4.5l2-2M8 4.5l2 2" /></>,
  fcv: <><path d="M2 14h3M19 14h3" /><path d="M5 9l14 10V9L5 19z" /><path d="M7 4.5h10M15 2.5l2 2-2 2" /></>,
  orifice: <><path d="M2 12h8M14 12h8" /><path d="M10 4v5M10 15v5M14 4v5M14 15v5" /><path d="M10 4h4M10 20h4" /></>,
  airVessel: <><rect x="7" y="2.5" width="10" height="15" rx="5" /><path d="M8 11h8" /><path d="M12 17.5V21M5 21h14" /></>,
  airValve: <><path d="M12 21v-6M5 21h14" /><path d="M12 15L6 5h12z" /><path d="M9 3l3-2 3 2" /></>,
  standpipe: <><path d="M7 3v16h10V3" /><path d="M7 10h10" /><path d="M12 19v2M4 21h16" /></>,
  feedTank: <><path d="M5 3v9h14V3" /><path d="M5 7h14" /><path d="M12 12v9M9 15l3 3 3-3" /></>,
  anticipator: <><path d="M12 21v-4M5 21h14" /><path d="M6 8l12 9V8L6 17z" /><path d="M12 8V2M9.5 4.5L12 2l2.5 2.5" /><path d="M3 11h2" /></>,
  relief: <><path d="M12 21v-4M5 21h14" /><path d="M6 8l12 9V8L6 17z" /><path d="M12 8V2M9.5 4.5L12 2l2.5 2.5" /><path d="M15 3l2 1-2 1 2 1" /></>,
  blowoff: <><path d="M3 9h11v4H3" /><path d="M14 8l4-2v10l-4-2" /><path d="M20 9v.01M21 12v.01M20 15v.01" strokeWidth={2.4} /></>,
  burstDisc: <><path d="M3 12h7M14 12h7" /><path d="M10 5v14M14 5v14" /><path d="M10 12l2-2 2 4" /></>,
};
export const ElIcon = ({ kind, size }: { kind: ElementKind; size?: number }) => <P size={size}>{ELEMENT_ICONS[kind]}</P>;

const ACTIONS = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  pan: <><path d="M12 3v18M3 12h18" /><path d="M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" /></>,
  run: <path d="M7 4l13 8-13 8z" fill="currentColor" />,
  undo: <><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></>,
  redo: <><path d="M15 14l5-5-5-5" /><path d="M20 9H9a5 5 0 000 10h3" /></>,
  open: <><path d="M3 7h6l2 2h10v10H3z" /></>,
  save: <><path d="M5 3h11l3 3v15H5z" /><path d="M8 3v5h7V3M8 21v-6h8v6" /></>,
  new: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M12 11v6M9 14h6" /></>,
  import: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 21h16" /></>,
  export: <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 21h16" /></>,
  report: <><path d="M6 3h9l4 4v14H6z" /><path d="M9 12h7M9 15h7M9 18h4" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 9h18M3 14h18M9 4v16" /></>,
  cases: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><path d="M17 14v6M14 17h6" /></>,
  health: <><path d="M12 21s-7-4.5-9-9.5C1.5 7 5 3 8.5 4.5 10 5 11 6 12 7.5 13 6 14 5 15.5 4.5 19 3 22.5 7 21 11.5 19 16.5 12 21 12 21z" /><path d="M7 12h3l1.5-3 2 5 1.5-2h2" /></>,
  setup: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  catalogue: <><path d="M4 4h6a2 2 0 012 2v14a2 2 0 00-2-2H4z" /><path d="M20 4h-6a2 2 0 00-2 2v14a2 2 0 012-2h6z" /></>,
  wave: <><path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0 2 3 2 3" /></>,
  profile: <><path d="M3 18l5-7 4 3 4-6 5 4" /><path d="M3 21h18" /></>,
  graph: <><path d="M3 3v18h18" /><path d="M6 15l4-5 3 3 6-7" /></>,
  ops: <><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 .5c0 2-2.5 2-2.5 4M12 17v.01" /></>,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  grid: <><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></>,
  magnet: <><path d="M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3z" /></>,
  labels: <><path d="M3 7l4-4h8l4 4v10l-4 4H7l-4-4z" /><path d="M9 10h6M9 14h4" /></>,
  sizing: <><path d="M4 20L20 4M4 20v-6M4 20h6M20 4v6M20 4h-6" /></>,
  uncertainty: <><path d="M3 18c4 0 5-12 9-12s5 12 9 12" /><path d="M3 18c4 0 5-6 9-6s5 6 9 6" opacity=".5" /></>,
  delete: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  find: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  theme: <><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 000 16z" fill="currentColor" /></>,
  units: <><path d="M3 17h18M6 17v-4M9 17v-6M12 17v-4M15 17v-6M18 17v-4" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></>,
  ai: <><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 9h8M8 12h5" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
};
export type ActionIcon = keyof typeof ACTIONS;
export const Ic = ({ name, size, title }: { name: ActionIcon; size?: number; title?: string }) => <P size={size} title={title}>{ACTIONS[name]}</P>;
