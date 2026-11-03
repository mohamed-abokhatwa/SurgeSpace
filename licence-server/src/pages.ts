// Public pages served by the licence server: privacy policy and support (linked from the Microsoft Store listing).
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · SurgeSpace</title><style>
:root{--bg:#f6f7fb;--ink:#0d1b2c;--muted:#526276;--accent:#e0620c;--card:#fff;--line:#e2e8f0}
@media (prefers-color-scheme:dark){:root{--bg:#07111f;--ink:#e6edf6;--muted:#93a4ba;--accent:#ff7a1a;--card:#0c1a2c;--line:#20324d}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,'Segoe UI',Roboto,sans-serif;padding:32px max(16px,env(safe-area-inset-left))}
main{max-width:720px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px 32px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:26px 0 6px}.muted{color:var(--muted);font-size:14px}a{color:var(--accent)}li{margin:4px 0}
</style></head><body><main>${body}</main></body></html>`;

export const PRIVACY_HTML = page('Privacy policy', `
<h1>SurgeSpace privacy policy</h1>
<p class="muted">Engineering Workspace · last updated 3 November 2026</p>
<p>SurgeSpace is an engineering application for pressure-surge (water hammer) analysis. Your models and results stay on your computer. We do not sell or share personal data, and the app contains no advertising or tracking.</p>
<h2>What stays on your computer</h2>
<p>Network models, project files, imported spreadsheets and drawings, and all calculation results are processed and stored only on your computer. They are never uploaded.</p>
<h2>What the app sends to our licence server</h2>
<ul>
<li><b>Licence activation and the daily check-in:</b> your licence code, the computer's Machine ID (a code derived from the operating system's machine identifier; it does not contain your name), the computer name, the operating system and the SurgeSpace version. This is used only to manage your licence (which computers use it, and until when).</li>
<li><b>Evaluation (trial):</b> a one-way code of the computer (not reversible to the Machine ID or name), the operating system and the app version, to know when the 14-day evaluation started.</li>
<li><b>Only when you choose to send them:</b> licence requests (name, company, email, message) and "Tell us" messages (your text, an optional reply email, the app version and the screen you were on).</li>
</ul>
<h2>Where it is stored</h2>
<p>On Cloudflare's infrastructure (Cloudflare Workers and D1), used only by Engineering Workspace. Messages may also be forwarded to our support inbox by email.</p>
<h2>How long</h2>
<p>Licence records are kept while the licence exists and for accounting afterwards. Evaluation records and messages are deleted on request.</p>
<h2>Your choices</h2>
<p>You can use SurgeSpace on the Free plan without activating anything; then nothing is sent except when you start an evaluation or send a message. To see or delete the data we hold about you, email <a href="mailto:support@engspace.app">support@engspace.app</a>.</p>
<h2>Contact</h2>
<p>Engineering Workspace · <a href="https://engspace.app">engspace.app</a> · support@engspace.app</p>`);

export const SUPPORT_HTML = page('Support', `
<h1>SurgeSpace support</h1>
<p class="muted">Engineering Workspace</p>
<p>The quickest way to reach us is the <b>Tell us</b> button at the top of SurgeSpace: your message arrives with the app version, so we can help faster.</p>
<p>Or email <b>support@engspace.app</b>. For licences (quotes, company licences, moving a licence to a new computer), use <b>Licence → Request a licence</b> in the app, or email us with your Machine ID (shown in Licence).</p>
<h2>Common questions</h2>
<ul>
<li><b>Does SurgeSpace work offline?</b> Yes. A licensed computer checks in once a day when online and keeps working up to 60 days offline.</li>
<li><b>New computer?</b> Ask us to free the licence from the old computer, then enter your licence code on the new one.</li>
<li><b>Which files can I import?</b> EPANET .inp, Excel/CSV tables, long-section profiles and DXF drawings with coordinates and levels.</li>
</ul>
<p><a href="/privacy">Privacy policy</a></p>`);
