// Notenapp-Proxy als Cloudflare Worker (kostenloser Plan reicht).
// Gleiches Protokoll wie proxy/notenapp-proxy.php – nimm, was du hosten kannst.
//
//   POST ?route=rpc    {url, cookie, body}  → leitet JSON-RPC an *.webuntis.com weiter
//                                             (Schulsuche, Login, Stundenplan)
//                      {url, method:"GET", cookie} → GET auf /WebUntis/api/… (Hausaufgaben)
//   GET  ?route=fetch&url=…                 → Homepage/PDF abrufen (nur ALLOWED_HOSTS,
//                                             auch bei Weiterleitungen)
//
// Die ganze Untis-Logik läuft in der App; der Proxy reicht nur durch und
// speichert nichts. Variablen (wrangler.toml oder Dashboard):
//   ALLOWED_ORIGIN  z. B. https://dualshade.github.io (Standard: *)
//   ALLOWED_HOSTS   Schul-Homepage(s) für route=fetch, kommagetrennt

const RPC_HOST = /(^|\.)webuntis\.com$/i;
const REDIRECTS = [301, 302, 303, 307, 308];
const MAX_REDIRECTS = 5;

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

// Prüft eine Adresse für route=fetch: nur http/https, Host in ALLOWED_HOSTS, keine
// Zugangsdaten (user:pass@). Gilt für die erste Adresse und jedes Weiterleitungsziel
// gleich. Liefert null oder die Fehlermeldung.
function fetchRefusal(target, env) {
  if (!['http:', 'https:'].includes(target.protocol) || !hostAllowed(env.ALLOWED_HOSTS, target.hostname.toLowerCase())) {
    return `Host ${target.hostname} ist nicht freigegeben (ALLOWED_HOSTS).`;
  }
  if (target.username || target.password) return 'Zugangsdaten in der Adresse sind nicht erlaubt.';
  return null;
}

// Headers.get() liefert die Bytes des Location-Headers als Latin-1. Schickt die Schule rohe
// UTF-8-Bytes (/März.pdf), würde new URL() jedes Byte erneut kodieren (%C3%83%C2%A4).
function utf8Location(value) {
  if (!/[\x80-\xff]/.test(value) || /[^\x00-\xff]/.test(value)) return value;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(value, (c) => c.charCodeAt(0)));
  } catch {
    return value; // kein gültiges UTF-8 (z. B. echtes Latin-1): unverändert lassen
  }
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
  // Nur der Standard-Port (new URL() lässt :443 bei https weg)
  if (target.protocol !== 'https:' || target.port !== '' || !RPC_HOST.test(target.hostname)) {
    return json(env, { error: 'Nur https://*.webuntis.com ist erlaubt.' }, 403);
  }
  const method = String(payload.method ?? 'POST').toUpperCase();
  // GET nur für die REST-API (Hausaufgaben), alles andere ist JSON-RPC per POST. Im Pfad
  // nur Buchstaben, Ziffern, _ - und /: ..;/ etwa löst new URL() nicht auf, der
  // Untis-Server aber schon.
  if (method === 'GET' && !/^\/WebUntis\/api\/[A-Za-z0-9_/-]+$/.test(target.pathname)) {
    return json(env, { error: 'GET nur für /WebUntis/api/ erlaubt.' }, 403);
  }
  if (method !== 'GET' && method !== 'POST') return json(env, { error: 'Ungültige Methode.' }, 400);
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': 'Notenapp' };
  if (payload.cookie) headers.Cookie = String(payload.cookie).slice(0, 2000);
  // Keine Weiterleitungen, wie im PHP-Proxy: bei 307/308 ginge die Anfrage samt Passwort
  // und Cookie sonst an ein beliebiges Ziel
  const upstream = method === 'GET'
    ? await fetch(target, { method: 'GET', headers, redirect: 'manual' })
    : await fetch(target, { method: 'POST', headers, body: String(payload.body ?? ''), redirect: 'manual' });
  return new Response(upstream.body, { status: upstream.status, headers: cors(env, { 'Content-Type': 'application/json' }) });
}

async function fetchUrl(url, env) {
  let target;
  try {
    target = new URL(url.searchParams.get('url'));
  } catch {
    return json(env, { error: 'Ungültige URL.' }, 400);
  }
  // Weiterleitungen verfolgt der Worker selbst, höchstens 5, und prüft jedes Ziel wie die
  // erste Adresse. Mit redirect: 'follow' käme eine freigegebene Homepage, die
  // weiterleitet, an jede Adresse heran.
  for (let redirects = 0; ; redirects++) {
    const refusal = fetchRefusal(target, env);
    if (refusal) return json(env, { error: (redirects ? 'Weiterleitung: ' : '') + refusal }, 403);
    const upstream = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0 (Notenapp-Proxy)' }, redirect: 'manual' });
    const location = REDIRECTS.includes(upstream.status) ? upstream.headers.get('Location') : null;
    if (!location) {
      return new Response(upstream.body, {
        status: upstream.status,
        headers: cors(env, { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream' }),
      });
    }
    await upstream.body?.cancel();
    if (redirects === MAX_REDIRECTS) return json(env, { error: `Proxy-Fehler: mehr als ${MAX_REDIRECTS} Weiterleitungen.` }, 502);
    try {
      target = new URL(utf8Location(location), target);
    } catch {
      return json(env, { error: 'Weiterleitung: ungültige Adresse.' }, 403);
    }
  }
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
    return json(env, { ok: true, service: 'notenapp-proxy', version: 3, features: ['homework'], routes: ['POST ?route=rpc', 'GET ?route=fetch&url='] });
  },
};
