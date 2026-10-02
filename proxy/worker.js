// Optionaler CORS-Proxy für die Notenapp (Cloudflare Worker, kostenloser Plan reicht).
// Ermöglicht Live-Abrufe direkt aus der App:
//   POST /untis        → Stundenplan aus WebUntis (Zugangsdaten im Request-Body)
//   GET  /fetch?url=…  → Homepage/PDF abrufen (nur erlaubte Hosts)
//
// Variablen (wrangler.toml oder Dashboard):
//   ALLOWED_ORIGIN  z. B. https://<user>.github.io  (Standard: *)
//   ALLOWED_HOSTS   z. B. www.meine-schule.de       (Pflicht für /fetch, kommagetrennt)

import { fetchUntisTimetable } from '../site/js/untis-client.js';

function cors(env, extra = {}) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    ...extra,
  };
}

function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors(env, { 'Content-Type': 'application/json' }) });
}

function hostAllowed(env, host) {
  const list = (env.ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });

    if (url.pathname === '/untis' && request.method === 'POST') {
      try {
        const body = await request.json();
        if (!/(^|\.)webuntis\.com$/i.test(String(body.server).replace(/^https?:\/\//, '').split('/')[0])) {
          return json(env, { error: 'Nur *.webuntis.com-Server sind erlaubt.' }, 400);
        }
        const raw = await fetchUntisTimetable({
          server: body.server,
          school: body.school,
          username: body.username,
          password: body.password,
          weeksBack: Math.min(4, Number(body.weeksBack ?? 1)),
          weeksAhead: Math.min(8, Number(body.weeksAhead ?? 5)),
        });
        return json(env, raw);
      } catch (err) {
        return json(env, { error: err.message }, 502);
      }
    }

    if (url.pathname === '/fetch' && request.method === 'GET') {
      let target;
      try {
        target = new URL(url.searchParams.get('url'));
      } catch {
        return json(env, { error: 'Ungültige URL.' }, 400);
      }
      if (!['http:', 'https:'].includes(target.protocol) || !hostAllowed(env, target.hostname.toLowerCase())) {
        return json(env, { error: `Host ${target.hostname} ist nicht freigegeben (ALLOWED_HOSTS).` }, 403);
      }
      const res = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (Notenapp-Proxy)' }, redirect: 'follow' });
      return new Response(res.body, {
        status: res.status,
        headers: cors(env, { 'Content-Type': res.headers.get('Content-Type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' }),
      });
    }

    return json(env, { ok: true, endpoints: ['POST /untis', 'GET /fetch?url='] });
  },
};
