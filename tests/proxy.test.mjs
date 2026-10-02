import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
    const { status, json } = handleUntis(url.pathname, JSON.parse(init.body || '{}'), init.headers?.Cookie ?? '');
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

// Tunnel wie in der App (data.js): Untis-Aufrufe über den Proxy.
function tunnel(proxyUrl, rewrite = (u) => u, call = (req) => fetch(req)) {
  return (url, init = {}) => call(new Request(`${proxyUrl}?route=rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ url: rewrite(url), cookie: init.headers?.Cookie ?? null, body: init.body ?? '' }),
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
    // falsches Passwort
    await assert.rejects(fetchUntisTimetable({ server: 'mock.webuntis.com', school: 'x', username: 'max', password: 'nein', fetchImpl }), /bad credentials/);
    // CORS-Header
    const res = await call(new Request('https://proxy.test/?route=rpc', { method: 'OPTIONS' }));
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://dualshade.github.io');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('Worker-Proxy: nur webuntis.com und freigegebene Hosts', async () => {
  const env = { ALLOWED_HOSTS: 'schule.de' };
  const rpc = (url) => worker.fetch(new Request('https://proxy.test/?route=rpc', { method: 'POST', body: JSON.stringify({ url, body: '{}' }) }), env);
  assert.equal((await rpc('https://evil.example.com/x')).status, 403);
  assert.equal((await rpc('http://mock.webuntis.com/x')).status, 403);
  assert.equal((await rpc('https://webuntis.com.evil.net/x')).status, 403);
  const fetchRoute = (url) => worker.fetch(new Request(`https://proxy.test/?route=fetch&url=${encodeURIComponent(url)}`), env);
  assert.equal((await fetchRoute('https://intranet.local/geheim')).status, 403);
});

// ---------- PHP-Proxy mit echtem PHP-Server ----------
const phpAvailable = await new Promise((resolve) => {
  const p = spawn('php', ['-r', 'exit(function_exists("curl_init") ? 0 : 1);']);
  p.on('error', () => resolve(false));
  p.on('exit', (code) => resolve(code === 0));
});

test('PHP-Proxy: Schulsuche + Login + Stundenplan', { skip: !phpAvailable && 'php mit curl nicht installiert' }, async () => {
  const upstream = await startMockUntisServer();
  const port = 18000 + Math.floor(Math.random() * 1000);
  const php = spawn('php', ['-S', `127.0.0.1:${port}`, 'proxy/notenapp-proxy.php'], {
    env: { ...process.env, NOTENAPP_RPC_HOST_PATTERN: '/^127\\.0\\.0\\.1$/', NOTENAPP_RPC_ALLOW_HTTP: '1', NOTENAPP_ALLOWED_ORIGIN: 'https://dualshade.github.io' },
    stdio: 'ignore',
  });
  after(() => { php.kill(); upstream.server.close(); });
  const base = `http://127.0.0.1:${port}/notenapp-proxy.php`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(base); break; } catch { await wait(100); }
  }
  // https://*.webuntis.com → lokaler Mock-Server (nur im Test erlaubt)
  const rewrite = (u) => u.replace(/^https:\/\/[^/]+/, `http://127.0.0.1:${upstream.port}`);
  const fetchImpl = tunnel(base, rewrite);

  const schools = await searchSchools('Gymnasium', { fetchImpl });
  assert.equal(schools[0].name, 'Gymnasium Musterstadt');
  const raw = await fetchUntisTimetable({ server: 'mock.webuntis.com', school: 'gym-musterstadt', username: 'max', password: 'geheim', weeksBack: 0, weeksAhead: 0, fetchImpl });
  assert.equal(raw.periods.length, 5);
  assert.ok(upstream.calls.some((c) => c.method === 'getTimetable' && /JSESSIONID=SESSION42/.test(c.cookie)));
  await assert.rejects(fetchUntisTimetable({ server: 'mock.webuntis.com', school: 'x', username: 'max', password: 'nein', fetchImpl }), /bad credentials/);

  const res = await fetch(`${base}?route=rpc`, { method: 'POST', body: JSON.stringify({ url: 'https://evil.example.com/', body: '{}' }) });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://dualshade.github.io');
  const blocked = await fetch(`${base}?route=fetch&url=${encodeURIComponent('http://127.0.0.1:1/x')}`);
  assert.equal(blocked.status, 403);
});
