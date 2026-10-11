import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchUntisTimetable } from '../site/js/untis-client.js';
import { normalizeTimetable, detectCourses, mergeUntisHomework } from '../site/js/timetable.js';

function mockUntis({ failOptions = false, homework = null } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    if (init.method === 'GET') {
      calls.push({ url, method: 'GET', cookie: init.headers.Cookie });
      if (!homework) return { ok: false, status: 405, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: homework }) };
    }
    const body = JSON.parse(init.body);
    calls.push({ url, method: body.method, params: body.params, cookie: init.headers.Cookie });
    const ok = (result) => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) });
    const err = (code, message) => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: body.id, error: { code, message } }) });
    switch (body.method) {
      case 'authenticate':
        return body.params.password === 'geheim' ? ok({ sessionId: 'ABC123', personType: 5, personId: 42, klasseId: 7 }) : err(-8504, 'bad credentials');
      case 'getTimetable': {
        if (failOptions && body.params.options) return err(-32601, 'unknown params');
        const start = body.params.options?.startDate ?? body.params.startDate;
        const d = (offset) => start + offset;
        const p = (date, s, e, su, sg) => ({ id: date * 10000 + s, date, startTime: s, endTime: e, su: [{ id: 1, name: su, longname: su === 'M' ? 'Mathematik' : 'Deutsch' }], te: [{ id: 1, name: 'XY' }], ro: [{ id: 1, name: 'R1' }], kl: [], sg });
        return ok([
          p(d(0), 800, 930, 'M', 'M-L1'), p(d(2), 800, 930, 'M', 'M-L1'), p(d(4), 800, 845, 'M', 'M-L1'),
          p(d(1), 800, 930, 'D', 'D-G1'), p(d(3), 800, 845, 'D', 'D-G1'),
        ]);
      }
      case 'getTimegridUnits':
        return ok([{ day: 2, timeUnits: [{ name: '1', startTime: 800, endTime: 845 }, { name: '2', startTime: 845, endTime: 930 }] }]);
      case 'logout':
        return ok(null);
      default:
        return err(-1, 'unknown');
    }
  };
  return { calls, fetchImpl };
}

test('WebUntis: Login, Wochen abrufen, Logout, LK/GK', async () => {
  const { calls, fetchImpl } = mockUntis();
  const raw = await fetchUntisTimetable({
    server: 'https://demo.webuntis.com/WebUntis', school: 'Test Schule', username: 'max', password: 'geheim',
    weeksBack: 0, weeksAhead: 1, now: new Date('2026-10-07T10:00:00Z'), fetchImpl,
  });
  assert.equal(calls[0].url, 'https://demo.webuntis.com/WebUntis/jsonrpc.do?school=Test%20Schule');
  assert.equal(calls[0].method, 'authenticate');
  assert.match(calls[1].cookie, /JSESSIONID=ABC123/);
  assert.deepEqual(calls[1].params.options.element, { id: 42, type: 5 });
  assert.equal(calls[1].params.options.startDate, 20261005);
  assert.equal(calls.filter((c) => c.method === 'getTimetable').length, 2);
  assert.equal(calls.at(-1).method, 'logout');
  const tt = normalizeTimetable(raw);
  assert.equal(tt.lessons.length, 10);
  assert.equal(tt.lessons[0].start, '08:00');
  const courses = detectCourses(tt.lessons);
  assert.deepEqual(courses.map((c) => [c.key, c.kind, c.hours]), [['M-L1', 'LK', 5], ['D-G1', 'GK', 3]]);
});

test('WebUntis: falsches Passwort gibt verständlichen Fehler', async () => {
  const { fetchImpl } = mockUntis();
  await assert.rejects(
    fetchUntisTimetable({ server: 'x.webuntis.com', school: 's', username: 'max', password: 'falsch', fetchImpl }),
    /bad credentials/,
  );
});

test('WebUntis: Fallback auf einfaches getTimetable-Format', async () => {
  const { calls, fetchImpl } = mockUntis({ failOptions: true });
  const raw = await fetchUntisTimetable({ server: 'x.webuntis.com', school: 's', username: 'max', password: 'geheim', weeksBack: 0, weeksAhead: 0, fetchImpl });
  assert.equal(raw.periods.length, 5);
  assert.ok(calls.some((c) => c.method === 'getTimetable' && c.params.id === 42 && c.params.type === 5));
});

const HOMEWORK = {
  homeworks: [
    { id: 1, lessonId: 900, date: 20261005, dueDate: 20261009, text: 'S. 42 Nr. 3', remark: 'mit Lösungsweg', completed: false },
    { id: 2, lessonId: 901, date: 20261006, dueDate: 20261008, text: 'Gedicht lesen', remark: '', completed: true },
    { id: 3, lessonId: 902, date: 20261006, dueDate: 20261008, text: 'Unbekanntes Fach', remark: '', completed: false },
  ],
  lessons: [{ id: 900, subject: 'M' }, { id: 901, subject: 'Deutsch' }, { id: 902, subject: 'XY' }],
};

test('WebUntis: Hausaufgaben über die REST-API mit derselben Session', async () => {
  const { calls, fetchImpl } = mockUntis({ homework: HOMEWORK });
  const raw = await fetchUntisTimetable({
    server: 'demo.webuntis.com', school: 's', username: 'max', password: 'geheim',
    weeksBack: 0, weeksAhead: 0, now: new Date('2026-10-07T10:00:00Z'), fetchImpl,
  });
  const get = calls.find((c) => c.method === 'GET');
  assert.equal(get.url, 'https://demo.webuntis.com/WebUntis/api/homeworks/lessons?startDate=20260914&endDate=20261011');
  assert.match(get.cookie, /JSESSIONID=ABC123/);
  const tt = normalizeTimetable(raw);
  assert.deepEqual(tt.homework.map((h) => [h.id, h.due, h.courseKey]), [[2, '2026-10-08', 'D-G1'], [3, '2026-10-08', null], [1, '2026-10-09', 'M-L1']]);
});

test('WebUntis: ohne Hausaufgaben-API läuft der Stundenplan trotzdem', async () => {
  const { fetchImpl } = mockUntis();
  const raw = await fetchUntisTimetable({ server: 'x.webuntis.com', school: 's', username: 'max', password: 'geheim', weeksBack: 0, weeksAhead: 0, fetchImpl });
  assert.equal(raw.periods.length, 5);
  assert.equal(normalizeTimetable(raw).homework, null);
  assert.match(raw.warnings.join(), /Hausaufgaben/);
});

test('Untis-Hausaufgaben übernehmen: anlegen, eigene Änderungen behalten, Löschung respektieren', () => {
  const list = [
    { id: 1, date: '2026-10-05', due: '2026-10-09', text: 'S. 42 Nr. 3', remark: 'mit Lösungsweg', completed: false, subject: 'M', courseKey: 'M-L1' },
    { id: 2, date: '2026-10-06', due: '2026-10-08', text: 'Gedicht lesen', remark: null, completed: true, subject: 'Deutsch', courseKey: 'D-G1' },
  ];
  const subjectFor = (key) => ({ 'M-L1': 'math', 'D-G1': 'deu' }[key] ?? null);
  const state = { homework: [], deleted: {} };
  assert.equal(mergeUntisHomework(state, list, { subjectFor, now: 1 }), 2);
  assert.deepEqual(state.homework.map((h) => [h.id, h.subjectId, h.title, h.notes, h.due, h.done]), [
    ['untis-hw-1', 'math', 'S. 42 Nr. 3', 'mit Lösungsweg', '2026-10-09', false],
    ['untis-hw-2', 'deu', 'Gedicht lesen', '', '2026-10-08', true],
  ]);
  // Eigene Änderungen bleiben, wenn sich in Untis nichts tut
  state.homework[0].done = true;
  state.homework[0].title = 'Nr. 3 (nur a)';
  assert.equal(mergeUntisHomework(state, list, { subjectFor }), 0);
  assert.equal(state.homework[0].title, 'Nr. 3 (nur a)');
  assert.equal(state.homework[0].done, true);
  // Neue Fälligkeit in Untis wird übernommen, Titel bleibt
  mergeUntisHomework(state, [{ ...list[0], due: '2026-10-12' }], { subjectFor });
  assert.equal(state.homework[0].due, '2026-10-12');
  assert.equal(state.homework[0].title, 'Nr. 3 (nur a)');
  // Selbst gelöscht → kommt nicht wieder
  state.homework = state.homework.filter((h) => h.id !== 'untis-hw-2');
  state.deleted.homework = { 'untis-hw-2': 5 };
  assert.equal(mergeUntisHomework(state, list, { subjectFor }), 0);
  assert.equal(state.homework.length, 1);
});
