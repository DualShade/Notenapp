import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const phpAvailable = await new Promise((resolve) => {
  const p = spawn('php', ['-v']);
  p.on('error', () => resolve(false));
  p.on('exit', (code) => resolve(code === 0));
});

let php; let base; let dataDir; let mailLog;
before(async () => {
  if (!phpAvailable) return;
  dataDir = await mkdtemp(path.join(tmpdir(), 'notenapp-api-'));
  mailLog = path.join(dataDir, 'mail.log');
  const port = 19000 + Math.floor(Math.random() * 1000);
  php = spawn('php', ['-S', `127.0.0.1:${port}`, 'proxy/notenapp-api.php'], {
    env: { ...process.env, NOTENAPP_DATA_DIR: path.join(dataDir, 'store'), NOTENAPP_MAIL_LOG: mailLog, NOTENAPP_ALLOWED_ORIGIN: 'https://dualshade.github.io' },
    stdio: 'ignore',
  });
  base = `http://127.0.0.1:${port}/notenapp-api.php`;
  for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await wait(100); } }
});
after(async () => { php?.kill(); if (dataDir) await rm(dataDir, { recursive: true, force: true }); });

async function api(action, body = {}) {
  const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action, ...body }) });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

const skip = !phpAvailable && 'php nicht installiert';

test('Registrieren, Anmelden, Sync mit Konflikterkennung', { skip }, async () => {
  const reg = await api('register', { email: 'Max@Example.de', password: 'geheim123' });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.email, 'max@example.de');
  assert.equal(reg.headers.get('access-control-allow-origin'), 'https://dualshade.github.io');
  assert.equal((await api('register', { email: 'max@example.de', password: 'geheim123' })).status, 409);
  assert.equal((await api('register', { email: 'kurz@example.de', password: 'kurz' })).status, 400);

  const t1 = reg.body.token;
  assert.deepEqual((await api('pull', { token: t1 })).body.rev, 0);
  const p1 = await api('push', { token: t1, baseRev: 0, data: { grades: [{ id: 'g1', points: 12 }] } });
  assert.deepEqual(p1.body, { rev: 1 });

  // Zweites Gerät
  const login = await api('login', { email: 'max@example.de', password: 'geheim123' });
  assert.equal(login.status, 200);
  const t2 = login.body.token;
  const pulled = await api('pull', { token: t2 });
  assert.equal(pulled.body.rev, 1);
  assert.equal(pulled.body.data.grades[0].points, 12);
  // Veralteter Stand → 409 mit aktuellem Stand
  const conflict = await api('push', { token: t2, baseRev: 0, data: { grades: [] } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.rev, 1);
  assert.equal(conflict.body.data.grades.length, 1);

  assert.equal((await api('login', { email: 'max@example.de', password: 'falsch!!' })).status, 401);
  assert.equal((await api('pull', { token: 'a'.repeat(64) })).status, 401);
});

test('Daten sind auf dem Server nicht lesbar', { skip }, async () => {
  const files = await readdir(path.join(dataDir, 'store', 'data'));
  const raw = await readFile(path.join(dataDir, 'store', 'data', files[0]), 'utf8');
  assert.ok(raw.startsWith('<?php exit; ?>'));
  const users = await readdir(path.join(dataDir, 'store', 'users'));
  const user = await readFile(path.join(dataDir, 'store', 'users', users[0]), 'utf8');
  assert.ok(!user.includes('geheim123'), 'Passwort nur als Hash');
  assert.ok(user.includes('$2y$') || user.includes('$argon'), 'password_hash');
});

test('Passwort ändern meldet andere Geräte ab', { skip }, async () => {
  const a = (await api('login', { email: 'max@example.de', password: 'geheim123' })).body.token;
  const b = (await api('login', { email: 'max@example.de', password: 'geheim123' })).body.token;
  assert.equal((await api('change_password', { token: a, oldPassword: 'falsch', newPassword: 'neuesPasswort' })).status, 403);
  assert.equal((await api('change_password', { token: a, oldPassword: 'geheim123', newPassword: 'neuesPasswort' })).status, 200);
  assert.equal((await api('pull', { token: a })).status, 200);
  assert.equal((await api('pull', { token: b })).status, 401);
  assert.equal((await api('login', { email: 'max@example.de', password: 'neuesPasswort' })).status, 200);
});

test('Passwort vergessen: Mail mit Link, neues Passwort setzen', { skip }, async () => {
  assert.equal((await api('reset_request', { email: 'gibtsnicht@example.de' })).body.ok, true);
  assert.equal((await api('reset_request', { email: 'max@example.de' })).body.ok, true);
  const mails = (await readFile(mailLog, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(mails.length, 1, 'nur an existierende Konten');
  assert.equal(mails[0].to, 'max@example.de');
  const resetToken = mails[0].text.match(/#\/passwort\/([a-f0-9]{64})/)[1];
  const res = await api('reset_confirm', { resetToken, password: 'nochNeuer123' });
  assert.equal(res.status, 200);
  assert.ok(res.body.token);
  assert.equal((await api('reset_confirm', { resetToken, password: 'nochNeuer123' })).status, 410, 'Link nur einmal gültig');
  assert.equal((await api('login', { email: 'max@example.de', password: 'nochNeuer123' })).status, 200);
});

test('Kalender-Abo liefert Klausuren und offene Hausaufgaben', { skip }, async () => {
  const t = (await api('login', { email: 'max@example.de', password: 'nochNeuer123' })).body.token;
  const rev = (await api('pull', { token: t })).body.rev;
  await api('push', { token: t, baseRev: rev, data: {
    subjects: [{ id: 'm', name: 'Mathematik' }],
    klausuren: [{ id: 'k1', subjectId: 'm', date: '2026-10-08', title: 'Klausur', info: '1.–3. Std., Analysis; Kurvendiskussion' }],
    homework: [{ id: 'h1', subjectId: 'm', due: '2026-10-05', title: 'S. 42 Nr. 3' }, { id: 'h2', subjectId: 'm', due: '2026-10-06', title: 'erledigt', done: true }],
  } });
  const feed = await api('feed', { token: t });
  const url = feed.body.url;
  assert.match(url, /\?ics=[a-f0-9]{64}$/);
  const ics = await (await fetch(url)).text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Klausur: Mathematik/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261008/);
  assert.ok(ics.includes(String.raw`Analysis\; Kurvendiskussion`), 'Semikolon wird für ICS maskiert');
  assert.match(ics, /SUMMARY:HA Mathematik: S. 42 Nr. 3/);
  assert.doesNotMatch(ics, /erledigt/);
  // Neu erzeugen macht den alten Link ungültig
  await api('feed', { token: t });
  assert.equal((await fetch(url)).status, 404);
});

test('Konto löschen entfernt alles', { skip }, async () => {
  const t = (await api('login', { email: 'max@example.de', password: 'nochNeuer123' })).body.token;
  assert.equal((await api('delete_account', { token: t, password: 'falsch' })).status, 403);
  assert.equal((await api('delete_account', { token: t, password: 'nochNeuer123' })).status, 200);
  assert.equal((await api('login', { email: 'max@example.de', password: 'nochNeuer123' })).status, 401);
  assert.deepEqual(await readdir(path.join(dataDir, 'store', 'data')), []);
});

test('Login-Sperre nach vielen Fehlversuchen', { skip }, async () => {
  await api('register', { email: 'brute@example.de', password: 'richtig123' });
  for (let i = 0; i < 10; i++) await api('login', { email: 'brute@example.de', password: 'falsch' + i });
  const blocked = await api('login', { email: 'brute@example.de', password: 'richtig123' });
  assert.equal(blocked.status, 429);
});
