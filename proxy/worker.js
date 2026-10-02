// Notenapp-Proxy als Cloudflare Worker (kostenloser Plan reicht).
// Gleiches Protokoll wie proxy/notenapp-proxy.php – nimm, was du hosten kannst.
//
//   POST ?route=rpc    {url, cookie, body}  → leitet JSON-RPC an *.webuntis.com weiter
//                                             (Schulsuche, Login, Stundenplan)
//   GET  ?route=fetch&url=…                 → Homepage/PDF abrufen (nur ALLOWED_HOSTS)
//
// Die ganze Untis-Logik läuft in der App; der Proxy reicht nur durch und
// speichert nichts. Variablen (wrangler.toml oder Dashboard):
//   ALLOWED_ORIGIN  z. B. https://dualshade.github.io (Standard: *)
//   ALLOWED_HOSTS   Schul-Homepage(s) für route=fetch, kommagetrennt

const RPC_HOST = /(^|\.)webuntis\.com$/i;

function cors(env, extra = {}) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Cache-Control': 'no-store',
    ...extra,
  };
}

function json(env, data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: cors(env, { 'Content-Type': 'application/json' }) });
}

function hostAllowed(list, host) {
  return String(list || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
    .some((h) => host === h || host.endsWith(`.${h}`));
}

async function rpc(request, env) {
  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return json(env, { error: 'Ungültige Anfrage.' }, 400);
  }
  let target;
  try {
    target = new URL(payload.url);
  } catch {
    return json(env, { error: 'Ungültige URL.' }, 400);
  }
  if (target.protocol !== 'https:' || !RPC_HOST.test(target.hostname)) {
    return json(env, { error: 'Nur https://*.webuntis.com ist erlaubt.' }, 403);
  }
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Notenapp' };
  if (payload.cookie) headers.Cookie = String(payload.cookie).slice(0, 2000);
  const upstream = await fetch(target, { method: 'POST', headers, body: String(payload.body ?? '') });
  return new Response(upstream.body, { status: upstream.status, headers: cors(env, { 'Content-Type': 'application/json' }) });
}

async function fetchUrl(url, env) {
  let target;
  try {
    target = new URL(url.searchParams.get('url'));
  } catch {
    return json(env, { error: 'Ungültige URL.' }, 400);
  }
  if (!['http:', 'https:'].includes(target.protocol) || !hostAllowed(env.ALLOWED_HOSTS, target.hostname.toLowerCase())) {
    return json(env, { error: `Host ${target.hostname} ist nicht freigegeben (ALLOWED_HOSTS).` }, 403);
  }
  const upstream = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (Notenapp-Proxy)' }, redirect: 'follow' });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: cors(env, { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream' }),
  });
}

export default {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    const route = url.searchParams.get('route') ?? url.pathname.replace(/^\/+/, '');
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(env) });
    try {
      if (route === 'rpc' && request.method === 'POST') return await rpc(request, env);
      if (route === 'fetch' && request.method === 'GET') return await fetchUrl(url, env);
    } catch (err) {
      return json(env, { error: `Proxy-Fehler: ${err.message}` }, 502);
    }
    return json(env, { ok: true, service: 'notenapp-proxy', routes: ['POST ?route=rpc', 'GET ?route=fetch&url='] });
  },
};
