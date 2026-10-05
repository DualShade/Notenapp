import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeSubjects, cleanSubjectName, untisSubjectId } from '../site/js/dedupe.js';
import { normalizeTimetable, detectCourses } from '../site/js/timetable.js';

test('Doppelte Fächer von zwei Geräten werden zusammengeführt', () => {
  const state = {
    subjects: [
      { id: 'a1', untisKey: 'e2', short: 'e2', name: 'Englisch 3-stdg.' },
      { id: 'b7', untisKey: 'e2', short: 'e2', name: 'Englisch 3-stdg.', planCode: 'e2', goal: 12 },
      { id: 'm1', untisKey: 'M2', short: 'M2', name: 'Mathematik 5-stdg.' },
      { id: 'm2', untisKey: 'm2', short: 'm2', name: 'Mathematik 3-stdg.' }, // anderer Kurs (GK)!
    ],
    grades: [{ id: 'g1', subjectId: 'b7', points: 12 }, { id: 'g2', subjectId: 'a1', points: 9 }, { id: 'g3', subjectId: 'b7', points: 10 }],
    klausuren: [{ id: 'k1', subjectId: 'a1', date: '2026-10-19', title: 'Klausur' }, { id: 'k2', subjectId: 'b7', date: '2026-10-19', title: 'Klausur' }],
    homework: [{ id: 'h1', subjectId: 'a1' }],
    absences: [],
    finals: [{ id: 'a1|Q1.1', subjectId: 'a1', halbjahr: 'Q1.1', points: 11 }],
  };
  assert.equal(dedupeSubjects(state), 1);
  // a1 hat mehr Einträge (Note, Klausur, HA, Zeugnisnote) und bleibt
  assert.deepEqual(state.subjects.map((s) => s.id), ['a1', 'm1', 'm2'], 'M2 und m2 bleiben getrennt');
  assert.ok(state.grades.every((g) => g.subjectId === 'a1'), 'alle Noten beim verbleibenden Fach');
  assert.equal(state.grades.length, 3, 'keine Note verloren');
  assert.equal(state.klausuren.length, 1, 'doppelte Klausur entfernt');
  assert.equal(state.homework[0].subjectId, 'a1');
  assert.deepEqual(state.finals[0], { id: 'a1|Q1.1', subjectId: 'a1', halbjahr: 'Q1.1', points: 11 });
  assert.equal(state.subjects[0].planCode, 'e2', 'Kürzel-Wahl des Duplikats übernommen');
  assert.equal(state.subjects[0].goal, 12, 'Wunschnote des Duplikats übernommen');
  assert.equal(dedupeSubjects(state), 0, 'idempotent');
});

test('Alle Geräte wählen dasselbe verbleibende Fach', () => {
  const make = () => ({
    subjects: [{ id: 'zz', untisKey: 'd3', short: 'd3', name: 'Deutsch' }, { id: 'aa', untisKey: 'd3', short: 'd3', name: 'Deutsch' }],
    grades: [], klausuren: [], homework: [], absences: [], finals: [],
  });
  const a = make();
  const b = make();
  b.subjects.reverse();
  dedupeSubjects(a);
  dedupeSubjects(b);
  assert.equal(a.subjects[0].id, b.subjects[0].id);
});

test('Fachnamen und stabile IDs', () => {
  assert.equal(cleanSubjectName('Englisch 3-stdg.'), 'Englisch');
  assert.equal(cleanSubjectName('Bildende Kunst 2-stdg.'), 'Bildende Kunst');
  assert.equal(cleanSubjectName('Mathematik'), 'Mathematik');
  assert.equal(cleanSubjectName('3-stdg.'), '3-stdg.');
  assert.notEqual(untisSubjectId('M2'), untisSubjectId('m2'), 'LK und GK verschieden');
  assert.equal(untisSubjectId('e2'), untisSubjectId('e2'));
});

test('Untis wie an deiner Schule: Kurs als Fach, "KA" und Methodentag sind keine Fächer', () => {
  const P = (date, s, e, su, long, kl = ['Js1'], code) => ({ id: Math.random(), date, startTime: s, endTime: e, su: [{ id: 1, name: su, longname: long }], te: [{ id: 2, name: 'Vt' }], ro: [{ id: 3, name: '204' }], kl: kl.map((n) => ({ id: 4, name: n })), code });
  const periods = [];
  for (const mon of [20261005, 20261012, 20261019]) {
    periods.push(P(mon, 930, 1015, 'e2', 'Englisch 3-stdg.'), P(mon + 3, 750, 835, 'e2', 'Englisch 3-stdg.'), P(mon + 4, 930, 1015, 'e2', 'Englisch 3-stdg.'));
    periods.push(P(mon + 2, 750, 835, 'M2', 'Mathematik 5-stdg.'), P(mon + 2, 840, 925, 'M2', 'Mathematik 5-stdg.'), P(mon + 3, 930, 1015, 'M2', 'Mathematik 5-stdg.'), P(mon + 1, 1125, 1210, 'M2', 'Mathematik 5-stdg.'), P(mon + 1, 1225, 1310, 'M2', 'Mathematik 5-stdg.'));
  }
  periods.push(P(20261006, 750, 1515, 'MethTag', 'Methodentag', ['10a', '10b']));
  periods.push(P(20261007, 1315, 1445, 'KA', 'Klausur', ['Js2']));
  const courses = detectCourses(normalizeTimetable({ periods, timegrid: [] }).lessons);
  const byKey = Object.fromEntries(courses.map((c) => [c.key, c]));
  assert.equal(byKey.KA, undefined, 'KA ist kein Kurs');
  assert.equal(byKey.MethTag.occasional, true, 'Methodentag nur in einer Woche');
  assert.equal(byKey.e2.kind, 'GK');
  assert.equal(byKey.M2.kind, 'LK');
  assert.equal(byKey.e2.occasional, false);
  assert.ok(byKey.e2.labels.includes('e2') && byKey.e2.labels.includes('Js1'));
});
