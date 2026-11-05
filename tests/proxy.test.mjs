import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { setTimeout as wait } from 'node:timers/promises';
import worker from '../proxy/worker.js';
import { searchSchools, fetchUntisTimetable } from '../site/js/untis-client.js';
import { normalizeTimetable, detectCourses } from '../site/js/timetable.js';
import { handleUntis, startMockUntisServer } from './helpers/mock-untis.mjs';

// fetch-Ersatz, der *.webuntis.com auf den Mock lenkt (für den Worker im Test).
function mockUpstreamFetch(log) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.href);
    log?.push({ host: url.hostname, cookie: init.headers?.Cookie ?? '' });
    const { status, json } = handleUntis(url.pathname, JSON.parse(init.body || '{}'), init.headers?.Cookie ?? '', init.method ?? 'GET');
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

// Tunnel wie in der App (data.js): Untis-Aufrufe über den Proxy.
function tunnel(proxyUrl, rewrite = (u) => u, call = (req) => fetch(req)) {
  return (url, init = {}) => call(new Request(`${proxyUrl}?route=rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ url: rewrite(url), method: init.method ?? 'POST', cookie: init.headers?.Cookie ?? null, body: init.body ?? '' }),
  }));
}

test('Schulsuche: Treffer, zu viele Treffer, Mindestlänge', async () => {
  const fetchImpl = mockUpstreamFetch();
  const schools = await searchSchools('Musterstadt', { fetchImpl });
  assert.equal(schools.length, 2);
  assert.deepEqual(schools[0], { name: 'Gymnasium Musterstadt', address: '12345 Musterstadt, Schulweg 1', server: 'mock.webuntis.com', loginName: 'gym-musterstadt', id: 1 });
  await assert.rejects(searchSchools('Schule', { fetchImpl }), /genauer suchen/);
  assert.deepEqual(await searchSchools('ab', { fetchImpl }), []);
});

test('Schulsuche: zweiter Endpunkt als Fallback', async () => {
  const hosts = [];
  const fetchImpl = async (url, init) => {
    hosts.push(new URL(url).hostname);
    if (hosts.length === 1) throw new TypeError('Failed to fetch');
    return mockUpstreamFetch()(url, init);
  };
  const schools = await searchSchools('Gymnasium', { fetchImpl });
  assert.equal(schools.length, 1);
  assert.deepEqual(hosts, ['mobile.webuntis.com', 'schoolsearch.webuntis.com']);
});

test('Worker-Proxy: kompletter Login über den Tunnel', async () => {
  const realFetch = globalThis.fetch;
  const log = [];
  globalThis.fetch = mockUpstreamFetch(log);
  try {
    const env = { ALLOWED_ORIGIN: 'https://dualshade.github.io' };
    const call = (req) => worker.fetch(req, env);
    const fetchImpl = tunnel('https://proxy.test/', undefined, call);
    const schools = await searchSchools('Gymnasium', { fetchImpl });
    assert.equal(schools[0].loginName, 'gym-musterstadt');
    const raw = await fetchUntisTimetable({ server: schools[0].server, school: schools[0].loginName, username: 'max', password: 'geheim', weeksBack: 0, weeksAhead: 1, fetchImpl });
    const courses = detectCourses(normalizeTimetable(raw).lessons);
    assert.deepEqual(courses.map((c) => [c.key, c.kind]), [['M-L1', 'LK'], ['D-G1', 'GK']]);
    assert.ok(log.some((l) => /JSESSIONID=SESSION42/.test(l.cookie)), 'Session-Cookie wird weitergereicht');
    // Hausaufgaben per GET über denselben Tunnel
    const hw = normalizeTimetable(raw).homework;
    assert.deepEqual(hw.map((x) => [x.text, x.due, x.courseKey]), [['S. 42 Nr. 3a–c', '2026-10-07', 'M-L1']]);
    // falsches Passwort
    await assert.rejects(fetchUntisTimetable({ server: 'mock.webuntis.com', school: 'x', username: 'max', password: 'nein', fetchImpl }), /bad credentials/);
    // CORS-Header
    const res = await call(new Request('https://proxy.test/?route=rpc', { method: 'OPTIONS' }));
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://dualshade.github.io');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Pfade, über die ein GET aus /WebUntis/api/ herauskäme (curl, new URL() oder der Untis-Server lösen sie auf)
const ESCAPES = ['/WebUntis/api/../jsonrpc.do', '/WebUntis/api/%2e%2e/jsonrpc.do', '/WebUntis/api/./../jsonrpc.do', '/WebUntis/api/..;/jsonrpc.do', '/WebUntis/api/%2e%2e;/jsonrpc.do'];

test('Worker-Proxy: nur webuntis.com und freigegebene Hosts', async () => {
  // Abgelehnte Anfragen dürfen nie nach draußen gehen
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { throw new Error(`Upstream darf nicht aufgerufen werden: ${u}`); };
  try {
    const env = { ALLOWED_HOSTS: 'schule.de' };
    const rpc = (url) => worker.fetch(new Request('https://proxy.test/?route=rpc', { method: 'POST', body: JSON.stringify({ url, body: '{}' }) }), env);
    assert.equal((await rpc('https://evil.example.com/x')).status, 403);
    assert.equal((await rpc('http://mock.webuntis.com/x')).status, 403);
    assert.equal((await rpc('https://webuntis.com.evil.net/x')).status, 403);
    assert.equal((await rpc('https://mock.webuntis.com:8443/x')).status, 403, 'nur Port 443');
    const getRpc = (url) => worker.fetch(new Request('https://proxy.test/?route=rpc', { method: 'POST', body: JSON.stringify({ url, method: 'GET' }) }), env);
    assert.equal((await getRpc('https://mock.webuntis.com/WebUntis/jsonrpc.do')).status, 403);
    for (const escape of ESCAPES) {
      assert.equal((await getRpc(`https://mock.webuntis.com${escape}`)).status, 403, `kein Weg aus /WebUntis/api/ heraus: ${escape}`);
    }
    const fetchRoute = (url, e = env) => worker.fetch(new Request(`https://proxy.test/?route=fetch&url=${encodeURIComponent(url)}`), e);
    assert.equal((await fetchRoute('https://intranet.local/geheim')).status, 403);
    // Ohne ALLOWED_HOSTS (wie auf dualshade.xyz) ist jede Adresse gesperrt
    assert.equal((await fetchRoute('https://www.lgoe.de/', {})).status, 403);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Worker-Proxy: rpc folgt keinen Weiterleitungen', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  // Wie die Plattform: mit redirect 'manual' kommt die 3xx-Antwort zurück, sonst folgt fetch selbst
  globalThis.fetch = async function platformFetch(input, init = {}) {
    const url = new URL(input.href ?? input);
    seen.push(url.href);
    if (url.hostname !== 'mock.webuntis.com') throw new Error(`Upstream darf nicht aufgerufen werden: ${url}`);
    const res = new Response(null, { status: 307, headers: { Location: 'https://evil.example/geheim' } });
    return init.redirect === 'manual' ? res : platformFetch(new URL(res.headers.get('Location'), url), init);
  };
  try {
    const rpc = (payload) => worker.fetch(new Request('https://proxy.test/?route=rpc', { method: 'POST', body: JSON.stringify(payload) }), {});
    assert.equal((await rpc({ url: 'https://mock.webuntis.com/WebUntis/jsonrpc.do', body: '{}' })).status, 307, 'POST');
    assert.equal((await rpc({ url: 'https://mock.webuntis.com/WebUntis/api/homeworks/lessons', method: 'GET' })).status, 307, 'GET');
    assert.deepEqual(seen, ['https://mock.webuntis.com/WebUntis/jsonrpc.do', 'https://mock.webuntis.com/WebUntis/api/homeworks/lessons']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- Weiterleitungen bei route=fetch (Worker und PHP-Proxy) ----------

// Schul-Homepage als Attrappe: ?to=…&status=… leitet dorthin weiter, /kette/N leitet N-mal
// weiter, alles andere antwortet mit Pfad und Query. Jeder angefragte Pfad landet in `hits`.
// Location geht als rohe UTF-8-Bytes raus wie bei einem Server, der einen Dateinamen mit
// Umlaut einsetzt (Node schreibt Header als Latin-1, daher der Umweg über Buffer).
async function startSchoolServer() {
  const hits = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    hits.push(url.pathname);
    const to = url.searchParams.get('to');
    const chain = /^\/kette\/(\d+)$/.exec(url.pathname);
    if (to !== null || (chain && chain[1] !== '0')) {
      const location = Buffer.from(to ?? `/kette/${chain[1] - 1}`, 'utf8').toString('latin1');
      res.writeHead(Number(url.searchParams.get('status') ?? 302), { Location: location });
      return res.end();
    }
    res.writeHead(url.pathname === '/fehlt' ? 404 : 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(url.pathname + url.search);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  after(() => { server.close(); server.closeAllConnections(); });
  const { port } = server.address();
  return { origin: `http://127.0.0.1:${port}`, port, hits };
}

// Dieselben Fälle für Worker und PHP-Proxy; get(url) ruft route=fetch mit dieser Adresse auf.
// Freigegeben ist nur 127.0.0.1; localhost ist derselbe Server, aber nicht freigegeben.
async function checkFetchRedirects(get, { origin, port, hits }) {
  const from = `${origin}/a/b/seite`;
  const via = (to, status = 302) => `${from}?to=${encodeURIComponent(to)}&status=${status}`;
  const read = async (res) => [res.status, await res.text()];

  // Ohne Weiterleitung kommen Status und Inhalt unverändert durch
  assert.deepEqual(await read(await get(`${origin}/plan.pdf`)), [200, '/plan.pdf']);
  assert.equal((await get(`${origin}/fehlt`)).status, 404);
  // Erste Adresse außerhalb der Liste oder mit Zugangsdaten
  for (const url of [`http://localhost:${port}/geheim`, `http://max:geheim@127.0.0.1:${port}/geheim`, `ftp://127.0.0.1:${port}/geheim`]) {
    const res = await get(url);
    assert.equal(res.status, 403, url);
    assert.doesNotMatch((await res.json()).error, /Weiterleitung/);
  }

  // Ziele in der Liste: absolut, protokollrelativ, pfadabsolut, pfadrelativ, nur Query, mit
  // Leerzeichen, mit Umlauten (einmal UTF-8-kodiert, nicht doppelt)
  for (const to of [`${origin}/ziel`, `//127.0.0.1:${port}/protokollrelativ`, '/absolut/plan.pdf', 'plan.pdf', '../plan.pdf',
    './x/../y.pdf', '../../../../oben.pdf', '?x=1', 'plan mit leerzeichen.pdf', 'März.pdf', '/Klausuren/Übersicht 2026.pdf?jahr=Q1&fach=Bio-ä']) {
    const want = new URL(to, from);
    assert.deepEqual(await read(await get(via(to))), [200, want.pathname + want.search], `Weiterleitung nach ${to}`);
  }
  for (const status of [301, 303, 307, 308]) {
    assert.deepEqual(await read(await get(via('/ziel', status))), [200, '/ziel'], `Status ${status}`);
  }

  // Ziele außerhalb der Liste, andere Schemas, Zugangsdaten: 403, und angefragt wird das Ziel nie
  for (const to of [`http://localhost:${port}/geheim`, `//localhost:${port}/geheim`, `HTTP://LOCALHOST:${port}/geheim`,
    `http://max:geheim@127.0.0.1:${port}/geheim`, 'file:///etc/passwd', `ftp://127.0.0.1:${port}/geheim`,
    `gopher://127.0.0.1:${port}/geheim`, `dict://127.0.0.1:${port}/geheim`]) {
    const res = await get(via(to));
    assert.equal(res.status, 403, `abgelehnt: ${to}`);
    assert.match((await res.json()).error, /^Weiterleitung: /);
  }
  assert.ok(!hits.includes('/geheim'), 'kein abgelehntes Ziel angefragt');

  // Höchstens 5 Weiterleitungen
  assert.deepEqual(await read(await get(`${origin}/kette/5`)), [200, '/kette/0']);
  hits.length = 0;
  const tooMany = await get(`${origin}/kette/6`);
  assert.equal(tooMany.status, 502);
  assert.match((await tooMany.json()).error, /mehr als 5 Weiterleitungen/);
  assert.deepEqual(hits, ['/kette/6', '/kette/5', '/kette/4', '/kette/3', '/kette/2', '/kette/1']);
}

test('Worker-Proxy: route=fetch folgt Weiterleitungen nur zu freigegebenen Hosts', async () => {
  const school = await startSchoolServer();
  const realFetch = globalThis.fetch;
  // Nach draußen geht nichts: erreichbar ist nur die Attrappe unter 127.0.0.1
  globalThis.fetch = async (input, init) => {
    const url = new URL(input.href ?? input);
    if (url.hostname !== '127.0.0.1') throw new Error(`Upstream darf nicht aufgerufen werden: ${url}`);
    return realFetch(input, init);
  };
  try {
    const env = { ALLOWED_HOSTS: '127.0.0.1' };
    await checkFetchRedirects((url) => worker.fetch(new Request(`https://proxy.test/?route=fetch&url=${encodeURIComponent(url)}`), env), school);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------- PHP-Proxy mit echtem PHP-Server ----------
const phpAvailable = await new Promise((resolve) => {
  const p = spawn('php', ['-r', 'exit(function_exists("curl_init") ? 0 : 1);']);
  p.on('error', () => resolve(false));
  p.on('exit', (code) => resolve(code === 0));
});

// Freier Port vom Betriebssystem, damit sich parallele Testläufe nicht in die Quere kommen
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer().once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// Startet den PHP-Proxy mit `php -S` und wartet, bis er antwortet. Fehler werden angezeigt
// wie auf einem Webspace mit display_errors: jede Warnung zerstört dann die JSON-Antwort.
async function startPhpProxy(env = {}) {
  const port = await freePort();
  const php = spawn('php', ['-d', 'display_errors=1', '-d', 'error_reporting=-1', '-S', `127.0.0.1:${port}`, 'proxy/notenapp-proxy.php'], {
    env: { ...process.env, ...env },
    stdio: 'ignore',
  });
  after(() => php.kill());
  const base = `http://127.0.0.1:${port}/notenapp-proxy.php`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(base); break; } catch { await wait(100); }
  }
  return base;
}

// Untis-Hosts unter 127.0.0.1 und per HTTP (nur im Test erlaubt)
const PHP_TEST_RPC = { NOTENAPP_RPC_HOST_PATTERN: '/^127\\.0\\.0\\.1$/', NOTENAPP_RPC_ALLOW_HTTP: '1' };

test('PHP-Proxy: Schulsuche + Login + Stundenplan', { skip: !phpAvailable && 'php mit curl nicht installiert' }, async () => {
  const upstream = await startMockUntisServer();
  after(() => upstream.server.close());
  const base = await startPhpProxy({ ...PHP_TEST_RPC, NOTENAPP_ALLOWED_ORIGIN: 'https://dualshade.github.io' });
  // https://*.webuntis.com → lokaler Mock-Server (nur im Test erlaubt)
  const rewrite = (u) => u.replace(/^https:\/\/[^/]+/, `http://127.0.0.1:${upstream.port}`);
  const fetchImpl = tunnel(base, rewrite);

  const schools = await searchSchools('Gymnasium', { fetchImpl });
  assert.equal(schools[0].name, 'Gymnasium Musterstadt');
  const raw = await fetchUntisTimetable({ server: 'mock.webuntis.com', school: 'gym-musterstadt', username: 'max', password: 'geheim', weeksBack: 0, weeksAhead: 0, fetchImpl });
  assert.equal(raw.periods.length, 5);
  assert.equal(raw.homework?.homeworks?.[0]?.id, 501, 'Hausaufgaben per GET über den PHP-Proxy');
  assert.ok(upstream.calls.some((c) => c.method === 'getTimetable' && /JSESSIONID=SESSION42/.test(c.cookie)));
  await assert.rejects(fetchUntisTimetable({ server: 'mock.webuntis.com', school: 'x', username: 'max', password: 'nein', fetchImpl }), /bad credentials/);

  const res = await fetch(`${base}?route=rpc`, { method: 'POST', body: JSON.stringify({ url: 'https://evil.example.com/', body: '{}' }) });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://dualshade.github.io');
  const getRpc = await fetch(`${base}?route=rpc`, { method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:${upstream.port}/WebUntis/jsonrpc.do`, method: 'GET' }) });
  assert.equal(getRpc.status, 403, 'GET nur auf /WebUntis/api/');
  for (const escape of ESCAPES) {
    const dotted = await fetch(`${base}?route=rpc`, { method: 'POST', body: JSON.stringify({ url: `http://127.0.0.1:${upstream.port}${escape}`, method: 'GET' }) });
    assert.equal(dotted.status, 403, `kein Weg aus /WebUntis/api/ heraus: ${escape}`);
  }
  // Eingaben mit falschem Typ: saubere 400 statt PHP-Warnung oder -Fehler
  for (const bad of [{ url: ['x'] }, { url: `http://127.0.0.1:${upstream.port}/WebUntis/jsonrpc.do`, method: ['GET'] }]) {
    const res = await fetch(`${base}?route=rpc`, { method: 'POST', body: JSON.stringify(bad) });
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error);
  }
  // Untis nicht erreichbar → 502 mit JSON
  const down = await fetch(`${base}?route=rpc`, { method: 'POST', body: JSON.stringify({ url: 'http://127.0.0.1:1/WebUntis/jsonrpc.do', body: '{}' }) });
  assert.equal(down.status, 502);
  assert.match((await down.json()).error, /Proxy-Fehler/);
  const blocked = await fetch(`${base}?route=fetch&url=${encodeURIComponent('http://127.0.0.1:1/x')}`);
  assert.equal(blocked.status, 403);
});

test('PHP-Proxy mit Standard-Einstellungen: nur Port 443, route=fetch gesperrt', { skip: !phpAvailable && 'php mit curl nicht installiert' }, async () => {
  const base = await startPhpProxy();
  // Abgelehnt, bevor curl irgendwohin verbindet
  for (const url of ['https://mese.webuntis.com:8443/WebUntis/jsonrpc.do', 'https://mese.webuntis.com:80/WebUntis/jsonrpc.do']) {
    const res = await fetch(`${base}?route=rpc`, { method: 'POST', body: JSON.stringify({ url, body: '{}' }) });
    assert.equal(res.status, 403, url);
  }
  // Ohne NOTENAPP_ALLOWED_HOSTS (wie auf dualshade.xyz) ist jede Adresse gesperrt
  assert.equal((await fetch(`${base}?route=fetch&url=${encodeURIComponent('https://www.lgoe.de/')}`)).status, 403);
  assert.equal((await (await fetch(base)).json()).version, 4);
});

test('PHP-Proxy: route=fetch folgt Weiterleitungen nur zu freigegebenen Hosts', { skip: !phpAvailable && 'php mit curl nicht installiert' }, async () => {
  const school = await startSchoolServer();
  const base = await startPhpProxy({ ...PHP_TEST_RPC, NOTENAPP_ALLOWED_HOSTS: '127.0.0.1' });
  await checkFetchRedirects((url) => fetch(`${base}?route=fetch&url=${encodeURIComponent(url)}`), school);
  // url als Liste: saubere 400 statt PHP-Fehler mit Serverpfad
  const list = await fetch(`${base}?route=fetch&url[]=x`);
  assert.equal(list.status, 400);
  assert.ok((await list.json()).error);
  // Die rpc-Route folgt keiner Weiterleitung, weder bei POST noch bei GET
  school.hits.length = 0;
  const rpc = (url, method) => fetch(`${base}?route=rpc`, { method: 'POST', body: JSON.stringify({ url, method, body: '{}' }) });
  const to = `?to=${encodeURIComponent('/geheim')}&status=307`;
  assert.equal((await rpc(`${school.origin}/WebUntis/jsonrpc.do${to}`, 'POST')).status, 307, 'POST');
  assert.equal((await rpc(`${school.origin}/WebUntis/api/homeworks${to}`, 'GET')).status, 307, 'GET');
  assert.deepEqual(school.hits, ['/WebUntis/jsonrpc.do', '/WebUntis/api/homeworks']);
});
