import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCalendar, parseCodes, resolvePlanCode, matchCalendar, untisCode } from '../site/js/klausur-calendar.js';

// Nachbau eines Klassenarbeitsplans im Kalender-Layout (Monate = Spalten)
const row = (y, cells) => ({ y, x: cells[0][1], xs: cells.map((c) => c[1]), cells: cells.map((c) => c[0]), text: cells.map((c) => c[0]).join(' | ') });
const pages = [{ page: 1, rows: [
  row(530, [['Klassenarbeitsplan Jahrgangsstufe 1 Halbjahr 1 Schuljahr 2026/2027', 43]]),
  row(491, [['September', 43], ['Oktober', 230], ['November', 440]]),
  row(449, [['3 Do', 48], ['3 Sa', 235], ['3 Di', 445], ['Gg G Inf* Rel Wi', 470]]),
  row(409, [['6 So', 48], ['6 Di', 235], ['Methodentag', 260], ['6 Fr', 445], ['B1 B2', 470]]),
  row(328, [['12 Sa', 43], ['12 Mo D2 (4.-7. Std.)', 230], ['12 Do', 440]]),
  row(234, [['19 Sa', 43], ['19 Mo Ch1 E1 E3 M4', 230], ['19 Do', 440]]),
  row(207, [['21 Mo', 43], ['21 Mi M2', 230], ['21 Sa', 440]]),
  row(180, [['23 Mi', 43], ['23 Fr', 230], ['Ch2 E2 E4 F L M1 M3', 260], ['23 Mo b1 d2 (1.–3. Std.) f2 it m2 nwt', 440]]),
  row(87, [['30 Mi', 43], ['30 Fr', 230], ['30 Mo g3', 440], ['Exkursion Inf* inf*', 480]]),
  row(73, [['31 Sa', 230]]),
] }, { page: 2, rows: [
  row(491, [['Dezember', 43], ['Januar', 300]]),
  row(194, [['22 Di', 48], ['Gottesdienst 1. Std.', 80], ['gk1, gk3 (2.-3. Std.)', 180], ['22 Fr', 305]]),
  row(341, [['11 Fr', 43], ['B1 B2', 70], ['11 Mo ast2 g6 gg1 psy2*', 300]]),
] }];

test('Kalender-Layout: Spalten = Monate, Jahr aus "Schuljahr 2026/2027"', () => {
  const cal = extractCalendar(pages);
  assert.ok(cal);
  assert.equal(cal.startYear, 2026);
  const byDate = Object.fromEntries(cal.days.map((d) => [d.date, d.items.map((i) => i.code).join(' ')]));
  assert.equal(byDate['2026-11-03'], 'Gg G Inf* Rel Wi');
  assert.equal(byDate['2026-10-12'], 'D2');
  assert.equal(byDate['2026-10-23'], 'Ch2 E2 E4 F L M1 M3');
  assert.equal(byDate['2026-11-23'], 'b1 d2 f2 it m2 nwt');
  assert.equal(byDate['2027-01-11'], 'ast2 g6 gg1 psy2*', 'Januar gehört zum Folgejahr');
  assert.equal(byDate['2026-10-06'], '', 'Methodentag ist kein Kurs');
  assert.ok(cal.caseSensitive, 'M2 und m2 kommen vor');
});

test('Kürzel mit Stunden, Komma-Gruppen und Ereignissen', () => {
  const s = (t) => parseCodes(t).map((i) => `${i.code}${i.periods ? `[${i.periods}]` : ''}${i.title ? `{${i.title}}` : ''}`).join(' ');
  assert.equal(s('BK Ch1 D2(4.-7. Std) E1'), 'BK Ch1 D2[4.–7. Std.] E1');
  assert.equal(s('Gk D3 (5.-8. Std.)'), 'Gk D3[5.–8. Std.]');
  assert.equal(s('Gottesdienst 1. Std. gk1, gk3 (2.-3. Std.)'), 'gk1[2.–3. Std.] gk3[2.–3. Std.]');
  assert.equal(s('g3 Exkursion Inf* inf*'), 'g3 Inf*{Exkursion} inf*{Exkursion}');
  assert.equal(s('Zeugnisausgabe Js1 und Js2'), '');
});

test('Eigenes Kürzel: aus Untis-Kurs, Groß/Klein = LK/GK, eindeutig oder auswählen', () => {
  const cal = extractCalendar(pages);
  // Untis-Kurs "M4" → eindeutig
  assert.deepEqual(resolvePlanCode({ short: 'M', kind: 'LK', group: 'M4' }, cal).code, 'M4');
  assert.equal(untisCode('J1_m2', 'M'), 'm2');
  assert.equal(untisCode('D-G2', 'D'), null, 'NRW-Kurs D-G2 ist kein Kürzel G2');
  assert.equal(untisCode('M4', 'M'), 'M4');
  // Ohne Kursnummer: nur Leistungsfach-Kürzel (groß) als Auswahl, keine Automatik
  const m = resolvePlanCode({ short: 'M', kind: 'LK' }, cal);
  assert.equal(m.code, null);
  assert.deepEqual(m.options, ['M1', 'M2', 'M3', 'M4']);
  // Basisfach Mathe → nur kleine Kürzel
  assert.deepEqual(resolvePlanCode({ short: 'M', kind: 'GK' }, cal).options, ['m2']);
  // Einziges Kürzel ohne Nummer → automatisch
  const gk = resolvePlanCode({ short: 'Gg', kind: 'LK' }, cal);
  assert.equal(gk.code, 'Gg');
  // Gespeicherte Wahl gewinnt; "-" = nicht im Plan
  assert.equal(resolvePlanCode({ short: 'M', kind: 'LK', planCode: 'M2' }, cal).code, 'M2');
  assert.equal(resolvePlanCode({ short: 'M', kind: 'LK', planCode: '-' }, cal).code, null);
});

test('Termine: M2 und m2 werden nicht verwechselt', () => {
  const cal = extractCalendar(pages);
  const subjects = [
    { id: 'mLK', short: 'M', kind: 'LK', planCode: 'M2' },
    { id: 'dGK', short: 'D', kind: 'GK', planCode: 'd2' },
    { id: 'inf', short: 'Inf', kind: 'LK', planCode: 'Inf' },
  ];
  const res = matchCalendar(cal, subjects);
  const list = res.map((r) => `${r.subjectId}@${r.candidate.date}${r.candidate.periods ? `[${r.candidate.periods}]` : ''}${r.candidate.title ? `{${r.candidate.title}}` : ''}`);
  assert.deepEqual(list, ['mLK@2026-10-21', 'inf@2026-11-03', 'dGK@2026-11-23[1.–3. Std.]', 'inf@2026-11-30{Exkursion}']);
  assert.equal(res.find((r) => r.candidate.title).sure, false, 'Exkursion nicht vorausgewählt');
});

test('Kursnummer automatisch aus Untis-Daten (alle Felder)', () => {
  const cal = extractCalendar(pages);
  const r = (subject) => resolvePlanCode(subject, cal);
  // Schülergruppe ohne Trenner, Klassen-/Kursname, Stundentext
  assert.equal(r({ short: 'M', kind: 'LK', group: 'J1M4' }).code, 'M4');
  assert.equal(r({ short: 'M', kind: 'LK', untisLabels: ['J1', 'M', 'Mathematik', 'Kurs M3'] }).code, 'M3');
  assert.equal(r({ short: 'MA', kind: 'LK', untisLabels: ['MA2'] }).code, 'M2', 'Untis-Kürzel MA → Plan M');
  // Basisfach: Untis "m2" bzw. Kurs 2 in kleiner Schreibweise
  assert.equal(r({ short: 'M', kind: 'GK', untisLabels: ['J1_m2'] }).code, 'm2');
  assert.equal(r({ short: 'D', kind: 'GK', untisLabels: ['D2'] }).code, 'd2', 'GK → kleines Kürzel, auch wenn Untis groß schreibt');
  assert.equal(r({ short: 'M', kind: 'LK', untisLabels: ['J1M4'] }).source, 'untis');
  // NRW-Kursname D-G2 ist kein Geschichtskurs
  assert.equal(r({ short: 'G', kind: 'GK', untisLabels: ['D-G2'] }).code, null);
});

test('Klausur-Tage aus Untis grenzen das Kürzel ein', () => {
  const cal = extractCalendar(pages);
  // M2 schreibt am 21.10. – Untis hat an dem Tag "Klausur" beim Mathekurs vermerkt
  const res = resolvePlanCode({ short: 'M', kind: 'LK', untisExamDates: ['2026-10-21'] }, cal);
  assert.equal(res.code, 'M2');
  assert.equal(res.source, 'termine');
  // 23.10.: M1 und M3 schreiben gleichzeitig → nur eingegrenzt
  const two = resolvePlanCode({ short: 'M', kind: 'LK', untisExamDates: ['2026-10-23'] }, cal);
  assert.equal(two.code, null);
  assert.deepEqual(two.options, ['M1', 'M3']);
});

test('Exakte Fach-Buchstaben vor Abkürzungen', () => {
  const cal = extractCalendar(pages);
  // Plan hat "Gg" (Geographie) und "G" (Geschichte): Geographie darf nicht auf G fallen
  assert.deepEqual(resolvePlanCode({ short: 'Gg', kind: 'LK' }, cal).options, ['Gg']);
});
