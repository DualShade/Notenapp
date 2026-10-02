import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, trackChanges, toPayload, mergePayloads, applyPayload, syncableSettings } from '../site/js/sync-model.js';
import { defaultState } from '../site/js/store.js';

function device() {
  const state = defaultState();
  let index = buildIndex(state);
  let clock = 1000;
  return {
    state,
    edit(fn, at = (clock += 10)) { fn(state); index = trackChanges(index, state, at).index; },
    payload: () => structuredClone(toPayload(state)),
    apply(p) { applyPayload(state, p); index = buildIndex(state); },
  };
}

test('Änderungen bekommen Zeitstempel, Löschungen Grabsteine', () => {
  const d = device();
  d.edit((s) => s.grades.push({ id: 'g1', subjectId: 'm', points: 12 }), 100);
  assert.equal(d.state.grades[0].updatedAt, 100);
  d.edit((s) => { s.grades[0].points = 13; }, 200);
  assert.equal(d.state.grades[0].updatedAt, 200);
  d.edit(() => {}, 300); // keine Änderung → kein neuer Stempel
  assert.equal(d.state.grades[0].updatedAt, 200);
  d.edit((s) => { s.grades = []; }, 400);
  assert.equal(d.state.deleted.grades.g1, 400);
});

test('Offline auf zwei Geräten: beide Änderungen bleiben erhalten', () => {
  const a = device();
  const b = device();
  a.edit((s) => s.subjects.push({ id: 'm', name: 'Mathe' }), 100);
  b.apply(mergePayloads(b.payload(), a.payload(), 150));
  // beide offline
  a.edit((s) => s.grades.push({ id: 'g1', subjectId: 'm', points: 12 }), 200);
  b.edit((s) => s.grades.push({ id: 'g2', subjectId: 'm', points: 9 }), 210);
  b.edit((s) => { s.subjects[0].name = 'Mathematik'; }, 220);
  const merged = mergePayloads(a.payload(), b.payload(), 300);
  assert.deepEqual(merged.grades.map((g) => g.id).sort(), ['g1', 'g2']);
  assert.equal(merged.subjects[0].name, 'Mathematik');
});

test('Löschung schlägt ältere Änderung, neuere Änderung schlägt Löschung', () => {
  const a = device();
  a.edit((s) => s.grades.push({ id: 'g1', points: 12 }), 100);
  const base = a.payload();
  const b = device();
  b.apply(base);
  a.edit((s) => { s.grades = []; }, 200); // A löscht
  b.edit((s) => { s.grades[0].points = 14; }, 150); // B ändert vorher
  assert.equal(mergePayloads(a.payload(), b.payload(), 300).grades.length, 0);
  b.edit((s) => { s.grades[0].points = 15; }, 250); // B ändert nach der Löschung
  const m = mergePayloads(a.payload(), b.payload(), 300);
  assert.equal(m.grades[0].points, 15);
  assert.equal(m.deleted.grades?.g1, undefined);
});

test('Untis-Passwort und Gerätedaten werden nie hochgeladen', () => {
  const d = device();
  d.edit((s) => { s.settings.untis = { server: 'x', school: 's', schoolName: 'S', username: 'max', password: 'geheim' }; s.settings.proxyUrl = 'p'; });
  const p = d.payload();
  assert.equal(p.settings.untis.password, '');
  assert.equal(p.settings.proxyUrl, undefined);
  assert.equal(syncableSettings(d.state.settings).untis.username, 'max');
  // Beim Übernehmen bleibt das lokale Passwort erhalten
  d.apply(p);
  assert.equal(d.state.settings.untis.password, 'geheim');
  assert.equal(d.state.settings.proxyUrl, 'p');
});

test('Neuere Einstellungen gewinnen', () => {
  const a = device();
  const b = device();
  a.edit((s) => { s.settings.halbjahr = 'Q2.1'; }, 100);
  b.edit((s) => { s.settings.halbjahr = 'Q1.2'; }, 200);
  assert.equal(mergePayloads(a.payload(), b.payload()).settings.halbjahr, 'Q1.2');
});
