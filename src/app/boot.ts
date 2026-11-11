// Launch screen (index.html): report loading steps and remove it when the workspace is ready.
type Boot = { step: (s: string) => void; done: () => void };
const b = () => (typeof window !== 'undefined' ? (window as Window & { __boot?: Boot }).__boot : undefined);
export const bootStep = (s: string) => b()?.step(s);
export const bootDone = () => b()?.done();
