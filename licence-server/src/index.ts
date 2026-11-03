// SurgeSpace licence server — Cloudflare Worker at surgespace-licences.engspace.app (its own Worker, D1 database and hostname).
//   App:   POST /activate /checkin /trial /trial/more /request /feedback
//   Admin: GET  /               the admin page
//          GET|POST /admin/*    needs the header x-admin-token (secret ADMIN_TOKEN)
// Secrets: ADMIN_TOKEN, LICENSE_PRIVATE_KEY (64 hex). Optional email: RESEND_API_KEY, MAIL_TO, MAIL_FROM.
import { adminRoute, appRoute, type Ctx } from '../../src/license/server/logic';
import { fromHex } from '../../src/license/core';
import { d1Store, type D1Like } from './d1Store';
import { ADMIN_HTML } from './admin';

export interface Env {
  DB: D1Like;
  BASE?: string;
  ADMIN_TOKEN: string;
  LICENSE_PRIVATE_KEY: string;
  RESEND_API_KEY?: string;
  MAIL_TO?: string;
  MAIL_FROM?: string;
}

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

function sameToken(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const base = (env.BASE ?? '').replace(/\/$/, '');
    if (!url.pathname.startsWith(base)) return new Response('Not found', { status: 404 });
    const path = url.pathname.slice(base.length) || '/';

    if (req.method === 'GET' && (path === '/' || path === '')) {
      return new Response(ADMIN_HTML.replace(/__BASE__/g, base), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'" } });
    }
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const ctx: Ctx = {
      store: d1Store(env.DB),
      privateKey: fromHex(env.LICENSE_PRIVATE_KEY ?? ''),
      now: Date.now(),
      mail: env.RESEND_API_KEY && env.MAIL_TO ? async (subject, text, replyTo) => {
        try {
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
            body: JSON.stringify({ from: env.MAIL_FROM ?? 'SurgeSpace <licence@engspace.app>', to: env.MAIL_TO, subject, text, reply_to: replyTo }),
          });
          return r.ok ? 'sent' : 'failed';
        } catch { return 'failed'; }
      } : undefined,
    };
    if (ctx.privateKey.length !== 32) return json({ ok: false, error: 'config', message: 'Licence server is not set up yet.' }, 500, cors);

    let body: Record<string, unknown> = {};
    if (req.method === 'POST') { try { body = await req.json(); } catch { return json({ ok: false, error: 'bad-request', message: 'Invalid request.' }, 400, cors); } }

    if (path.startsWith('/admin/')) {
      if (!sameToken(req.headers.get('x-admin-token') ?? '', env.ADMIN_TOKEN ?? '')) return json({ ok: false, error: 'auth' }, 401);
      const out = await adminRoute(path, body, ctx);
      return json(out.body, out.status);
    }
    if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405, cors);
    try {
      const out = await appRoute(path, body, ctx);
      return json(out.body, out.status, cors);
    } catch (e) {
      console.error(e);
      return json({ ok: false, error: 'server', message: 'The licence server had a problem. Try again in a minute.' }, 500, cors);
    }
  },
};
