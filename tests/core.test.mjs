import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, parsePeriods, extractCandidates, matchCandidates, matchSubject, inferYear } from '../site/js/klausur-parser.js';
import { normalizeTimetable, detectCourses } from '../site/js/timetable.js';
import { subjectAverage, overallAverage, percentToPoints, scaleTable, SCALE_PRESETS, pointsToNoteValue } from '../site/js/grades.js';
import { findPdfLink } from '../site/js/link-finder.js';
import { itemsToRows } from '../site/js/pdf-text.js';

const NOW = new Date('2026-10-02T10:00:00');

test('Datumsangaben', () => {
  assert.equal(parseDate('Mo, 14.10.', NOW), '2026-10-14');
  assert.equal(parseDate('Di 12.01.', NOW), '2027-01-12');
  assert.equal(parseDate('14.10.2026 | M-L1', NOW), '2026-10-14');
  assert.equal(parseDate('14.10.26', NOW), '2026-10-14');
  assert.equal(parseDate('Donnerstag, 5. November', NOW), '2026-11-05');
  assert.equal(parseDate('3./4. Std. Deutsch', NOW), null);
  assert.equal(parseDate('31.02.', NOW), null);
  assert.equal(inferYear(9, new Date('2027-03-01')), 2026);
});

test('Stundenangaben', () => {
  assert.equal(parsePeriods('Mathe 3.-4. Std.'), '3.–4. Std.');
  assert.equal(parsePeriods('Std. 1-3 Deutsch'), '1.–3. Std.');
  assert.equal(parsePeriods('7:55 - 9:25 Uhr'), '7:55–9:25 Uhr');
});

const subjects = [
  { id: 'm', name: 'Mathematik', short: 'M', group: 'M-L1', kind: 'LK' },
  { id: 'd', name: 'Deutsch', short: 'D', group: 'D-G2', kind: 'GK' },
  { id: 'e', name: 'Englisch', short: 'E', group: 'E-G1', kind: 'GK' },
  { id: 'ph', name: 'Physik', short: 'PH', group: 'PH-L1', kind: 'LK' },
];

test('Kurszuordnung inkl. LK/GK und Kursnummer', () => {
  assert.equal(matchSubject('14.10. M-L1 Raum 201', subjects[0]).score, 3);
  assert.equal(matchSubject('14.10. M-G1', subjects[0]), null);
  assert.equal(matchSubject('Deutsch GK 1', subjects[1]), null, 'anderer GK');
  assert.ok(matchSubject('Deutsch GK 2', subjects[1]));
  assert.ok(matchSubject('Deutsch', subjects[1]));
  assert.equal(matchSubject('Mit Hilfsmitteln', subjects[0]), null);
  assert.equal(matchSubject('Mathematik LK', subjects[0]).score, 3);
  assert.equal(matchSubject('Mathematik GK', subjects[0]), null);
});

test('Kandidaten aus Tabelle mit verbundenen Datumszellen', () => {
  const pages = [{ page: 1, rows: [
    { cells: ['Klausurplan Q1 – 1. Halbjahr'], text: 'Klausurplan Q1 – 1. Halbjahr' },
    { cells: ['Datum', 'Stunde', 'Kurs'], text: 'Datum | Stunde | Kurs' },
    { cells: ['Mo 12.10.', '1.-3. Std.', 'M-L1'], text: 'Mo 12.10. | 1.-3. Std. | M-L1' },
    { cells: ['3.-4. Std.', 'D-G2, E-G1'], text: '3.-4. Std. | D-G2, E-G1' },
    { cells: ['Di 13.10.', '1.-5. Std.', 'PH-L1'], text: 'Di 13.10. | 1.-5. Std. | PH-L1' },
    { cells: ['Mi 14.10.', 'Bio-L1'], text: 'Mi 14.10. | Bio-L1' },
  ] }];
  const cands = extractCandidates(pages, { now: NOW });
  assert.equal(cands.length, 4);
  const matched = matchCandidates(cands, subjects);
  const byId = Object.fromEntries(matched.filter((r) => r.subjectId).map((r) => [r.subjectId, r.candidate.date]));
  assert.deepEqual(byId, { m: '2026-10-12', d: '2026-10-12', e: '2026-10-12', ph: '2026-10-13' });
  assert.ok(matched.some((r) => r.subjectId === null && r.candidate.text.includes('Bio')));
});

test('Verbundene Datumszelle steht zwischen ihren Zeilen', () => {
  const row = (y, x, cells) => ({ y, x, cells, text: cells.join(' | ') });
  const pages = [{ page: 1, rows: [
    row(760, 60, ['Datum', 'Stunde', 'Kurse']),
    row(740, 140, ['1.-3. Std.', 'M-L1']),
    row(730, 50, ['Do 08.10.']),
    row(720, 140, ['4.-5. Std.', 'D-G2']),
    row(700, 50, ['Mo 12.10.', '1.-2. Std.', 'E-G1']),
    // Überschriften-Stil: Einträge stehen bündig unter dem Datum
    row(680, 50, ['Mi 14.10.']),
    row(670, 50, ['PH-L1 3.-5. Std.']),
    row(660, 50, ['Fr 16.10.']),
  ] }];
  const byText = Object.fromEntries(extractCandidates(pages, { now: NOW }).map((c) => [c.cells.at(-1), c.date]));
  assert.deepEqual(byText, { 'M-L1': '2026-10-08', 'D-G2': '2026-10-08', 'E-G1': '2026-10-12', 'PH-L1 3.-5. Std.': '2026-10-14' });
});

function period(date, start, end, su, sg, code) {
  return { id: Math.random(), date, startTime: start, endTime: end, su: [{ id: 1, name: su, longname: su }], te: [{ id: 2, name: 'ABC' }], ro: [{ id: 3, name: 'A1' }], kl: [], sg, code };
}

test('LK/GK-Erkennung über Wochenstunden', () => {
  const periods = [];
  // Zwei volle Wochen: LK Mathe 5 Std (2 Doppel + 1 Einzel), GK Deutsch 3 Std, GK Englisch 3 Std (90-Min-Block + 45)
  for (const mon of [20261005, 20261012]) {
    periods.push(period(mon, 800, 930, 'M', 'M-L1'), period(mon + 2, 800, 930, 'M', 'M-L1'), period(mon + 4, 1000, 1045, 'M', 'M-L1'));
    periods.push(period(mon, 1000, 1045, 'D', 'D-G2'), period(mon + 3, 800, 930, 'D', 'D-G2'));
    periods.push(period(mon + 1, 800, 930, 'E', 'E-G1'), period(mon + 2, 1000, 1045, 'E', 'E-G1'));
  }
  // Ein Ausfall zählt trotzdem (geplante Stunde), Vertretung (irregular) nicht
  periods[0].code = 'cancelled';
  periods.push(period(20261007, 1100, 1145, 'D', 'D-G2', 'irregular'));
  // Ferienwoche mit nur einer Stunde
  periods.push(period(20261019, 800, 845, 'M', 'M-L1'));
  const tt = normalizeTimetable({ periods, timegrid: [] });
  const courses = detectCourses(tt.lessons);
  const kinds = Object.fromEntries(courses.map((c) => [c.key, [c.kind, c.hours]]));
  assert.deepEqual(kinds, { 'M-L1': ['LK', 5], 'D-G2': ['GK', 3], 'E-G1': ['GK', 3] });
  assert.deepEqual(tt.timegrid.map((t) => t.start), ['08:00', '10:00', '11:00']);
});

test('Notenberechnung', () => {
  const grades = [
    { type: 'klausur', points: 12 }, { type: 'klausur', points: 10 },
    { type: 'muendlich', points: 9 },
  ];
  assert.equal(subjectAverage(grades).average, 10);
  assert.equal(subjectAverage(grades, { schriftlich: 100, muendlich: 0 }).average, 11);
  assert.equal(subjectAverage([{ type: 'muendlich', points: 7 }]).average, 7);
  assert.equal(overallAverage([{ average: 12, kind: 'LK' }, { average: 9, kind: 'GK' }], { lkDouble: true }), 11);
  assert.equal(pointsToNoteValue(11), 2);
  assert.equal(percentToPoints(94.9, SCALE_PRESETS.abitur.scale), 14);
  assert.equal(percentToPoints(39, SCALE_PRESETS.abitur.scale), 4);
  const table = scaleTable(SCALE_PRESETS.abitur.scale, 60);
  assert.equal(table[0].minRaw, 57);
  assert.equal(table[0].maxRaw, 60);
  assert.equal(table[1].minRaw, 54);
  assert.equal(table[1].maxRaw, 56.5);
  assert.equal(table.at(-1).minRaw, 0);
});

test('PDF-Link auf Homepage finden', () => {
  const html = `<a href="/files/vertretung.pdf">Vertretungsplan</a>
    <a href='/files/klausurplan_q1_2026-08-20.pdf'>Klausurplan Q1 (alt)</a>
    <a href="uploads/Klausurplan_Q1_2026-09-28.pdf">Klausurplan Q1</a>`;
  const link = findPdfLink(html, 'https://schule.de/oberstufe/', 'klausur');
  assert.equal(link.url, 'https://schule.de/oberstufe/uploads/Klausurplan_Q1_2026-09-28.pdf');
});

test('PDF-Zeilen rekonstruieren', () => {
  const item = (str, x, y, width) => ({ str, transform: [1, 0, 0, 10, x, y], width, height: 10 });
  const rows = itemsToRows([
    item('12.10.', 50, 700, 30), item('M-L1', 200, 700.5, 25), item('Raum', 300, 700, 22), item('201', 324, 700, 15),
    item('13.10.', 50, 680, 30),
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].cells, ['12.10.', 'M-L1', 'Raum 201']);
});
