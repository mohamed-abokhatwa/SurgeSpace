// End-to-end test of the real desktop app (Tauri, Linux build) through WebDriver (tauri-driver + WebKitWebDriver):
// the app starts, the surge engine runs in its worker under the app's content security policy, the licence commands
// answer, and the copilot reaches an AI server through the native HTTP client with a streamed reply and a tool call.
//   npx tauri build --no-bundle && xvfb-run node tests/desktop-e2e.mjs
//   (needs webkit2gtk-driver and `cargo install tauri-driver`)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';

const APP = new URL('../src-tauri/target/release/surgespace', import.meta.url).pathname;
if (!existsSync(APP)) { console.log(`Build the app first: npx tauri build --no-bundle (${APP} not found)`); process.exit(1); }
let pass = 0, fail = 0;
const t = (name, ok, info = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// a local OpenAI-compatible AI server: first turn calls get_model, second turn streams a reply
const seen = [];
const ai = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = body ? JSON.parse(body) : {};
    seen.push({ url: req.url, ua: req.headers['user-agent'] ?? '', accept: req.headers.accept, stream: j.stream, tools: (j.tools ?? []).length, msgs: (j.messages ?? []).length });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    const hasTool = (j.messages ?? []).some((m) => m.role === 'tool');
    if (!hasTool) {
      send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_model', arguments: '{}' } }] } }] });
      send({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
      res.end('data: [DONE]\n\n');
    } else {
      const tool = j.messages.find((m) => m.role === 'tool');
      const pipes = (JSON.parse(tool.content).pipes ?? []).length;
      const words = `Desktop check: the model has ${pipes} pipes.`.split(' ');
      let k = 0;
      const tick = setInterval(() => {
        if (k < words.length) { send({ choices: [{ delta: { content: (k ? ' ' : '') + words[k++] } }] }); return; }
        clearInterval(tick);
        send({ choices: [{ delta: {}, finish_reason: 'stop' }] });
        res.end('data: [DONE]\n\n');
      }, 40);
    }
  });
});
await new Promise((r) => ai.listen(8765, '127.0.0.1', r));

const driver = spawn('tauri-driver', ['--port', '4444'], { stdio: 'ignore' });
const W = 'http://127.0.0.1:4444';
const wd = async (method, path, body) => {
  const r = await fetch(W + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (j.value?.error) throw new Error(`${path}: ${j.value.message}`);
  return j.value;
};
let sid;
try {
  await sleep(1500);
  sid = (await wd('POST', '/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP } } } })).sessionId;
  const S = `/session/${sid}`;
  const js = (script, args = []) => wd('POST', `${S}/execute/sync`, { script, args });
  const wait = async (fn, ms = 60000) => { const t0 = Date.now(); for (;;) { const v = await fn().catch(() => false); if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(250); } };
  const el = async (css) => (await wd('POST', `${S}/element`, { using: 'css selector', value: css }))['element-6066-11e4-a52e-4f735466cecf'];

  t('desktop app starts inside Tauri', await wait(() => js('return !!window.__TAURI_INTERNALS__ && !!document.querySelector(".statusbar")')));
  await js(`const b=document.querySelector('.start-go'); b && b.click(); return true;`);
  const ran = await wait(() => js('return (document.querySelector(".statusbar")||{}).textContent||""').then((s) => s.includes('Run OK') && s), 90000);
  t('the example runs in the engine worker under the app’s content security policy', !!ran, String(ran).slice(0, 80));
  const mid = await wd('POST', `${S}/execute/async`, { script: 'const done = arguments[arguments.length - 1]; window.__TAURI_INTERNALS__.invoke("device_id").then((v) => done(String(v))).catch((e) => done("ERR " + e));', args: [] });
  t('licence commands answer (device id from the native side)', typeof mid === 'string' && !mid.startsWith('ERR') && mid.length >= 8, `${String(mid).slice(0, 12)}…`);

  // AI account for the local server, consent given, then reload so the app picks it up
  await js(`localStorage.setItem('surgespace.ai', JSON.stringify({ accounts: [{ id: 'a1', provider: 'ollama', model: 'test-model', baseUrl: 'http://127.0.0.1:8765/v1' }], active: 'a1', consent: true })); location.reload(); return true;`);
  await wait(() => js('return !!document.querySelector(".statusbar")'));
  await sleep(1500);
  await js(`const b=document.querySelector('.start-go'); b && b.click(); return true;`);
  await sleep(400);
  await js(`[...document.querySelectorAll('.ptab')].find((b) => b.textContent.includes('Copilot')).click(); return true;`);
  await wait(() => js('return !!document.querySelector(".copilot-body textarea")'), 20000);
  const ta = await el('.copilot-body textarea');
  await wd('POST', `${S}/element/${ta}/value`, { text: 'How many pipes?' });
  await sleep(300);
  await js(`const b=[...document.querySelectorAll('.copilot-body button')].find(x=>x.textContent.trim()==='Send'); b.click(); return true;`);
  // streamed text appears progressively, then the final reply
  let partial = '';
  const done = await wait(async () => {
    const txt = await js('return [...document.querySelectorAll(".copilot-body .msg.assistant")].map(x=>x.textContent).join(" | ")');
    if (txt.includes('Desktop check') && !txt.includes('pipes.')) partial = txt;
    return txt.includes('pipes.') ? txt : false;
  }, 60000);
  t('copilot reaches the AI server through the native HTTP client (not the web view)', seen.length >= 2 && seen[0].stream === true && seen[0].tools > 10 && !/AppleWebKit/.test(seen[0].ua), JSON.stringify(seen[0] ?? {}));
  t('tool call runs (get_model) and the reply uses its result', !!done && /has \d+ pipes/.test(done), String(done).slice(0, 120));
  t('the reply streams in as it is written', !!partial, partial ? `seen part-way: “${partial.slice(0, 60)}”` : 'no partial text observed');
  const errs = await js('return (window.__errs||[]).length');
  t('no script errors', errs === 0);
} catch (e) {
  t('desktop test ran', false, e.message);
} finally {
  if (sid) await wd('DELETE', `/session/${sid}`).catch(() => {});
  driver.kill(); ai.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
