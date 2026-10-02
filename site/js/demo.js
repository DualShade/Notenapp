// Demo-Daten zum Ausprobieren ohne Untis-Zugang.

import { getState, update, uid, replaceState, defaultState } from './store.js';
import { normalizeTimetable, mondayKey, todayIso, addDaysIso } from './timetable.js';
import { syncSubjectsWithTimetable } from './data.js';
import { confirmDialog, toast } from './ui.js';
import { getAccount } from './sync.js';

const COURSES = {
  'M-L1': ['M', 'Mathematik', 'SCH', 'A104'],
  'PH-L1': ['PH', 'Physik', 'KRA', 'N201'],
  'D-G2': ['D', 'Deutsch', 'MÜL', 'A012'],
  'E-G1': ['E', 'Englisch', 'BRO', 'A110'],
  'GE-G3': ['GE', 'Geschichte', 'WEB', 'B007'],
  'SW-G1': ['SW', 'Sozialwissenschaften', 'HOF', 'B105'],
  'IF-G1': ['IF', 'Informatik', 'LAN', 'N014'],
  'SP-G4': ['SP', 'Sport', 'BEC', 'TH1'],
};

// [Tag (0 = Mo), Startstunde (0-basiert), Länge in Stunden, Kurs]
const WEEK = [
  [0, 0, 2, 'M-L1'], [0, 2, 2, 'D-G2'], [0, 4, 1, 'GE-G3'], [0, 5, 2, 'PH-L1'],
  [1, 0, 2, 'E-G1'], [1, 2, 2, 'PH-L1'], [1, 4, 2, 'SW-G1'],
  [2, 0, 2, 'M-L1'], [2, 2, 1, 'D-G2'], [2, 3, 2, 'IF-G1'], [2, 5, 2, 'SP-G4'],
  [3, 0, 2, 'GE-G3'], [3, 2, 1, 'M-L1'], [3, 3, 1, 'PH-L1'], [3, 4, 1, 'E-G1'], [3, 5, 1, 'SW-G1'],
  [4, 0, 1, 'IF-G1'], [4, 2, 1, 'SP-G4'],
];
const GRID = [[745, 830], [830, 915], [935, 1020], [1020, 1105], [1125, 1210], [1210, 1255], [1340, 1425], [1425, 1510]];

function untisDate(iso) {
  return Number(iso.replaceAll('-', ''));
}

export function demoTimetable(now = new Date()) {
  const start = addDaysIso(mondayKey(todayIso(now)), -7);
  const periods = [];
  let id = 1;
  for (let w = 0; w < 5; w++) {
    for (const [day, slot, len, course] of WEEK) {
      const [short, long, teacher, room] = COURSES[course];
      const date = addDaysIso(start, w * 7 + day);
      for (let i = 0; i < len; i++) {
        periods.push({
          id: id++, date: untisDate(date), startTime: GRID[slot + i][0], endTime: GRID[slot + i][1],
          su: [{ id: 1, name: short, longname: long }], te: [{ id: 2, name: teacher }], ro: [{ id: 3, name: room }], kl: [], sg: course,
        });
      }
    }
  }
  // Ein paar Änderungen der aktuellen Woche
  const thisMonday = untisDate(addDaysIso(start, 7));
  const thisWeek = periods.filter((p) => p.date >= thisMonday && p.date < thisMonday + 7);
  if (thisWeek[3]) thisWeek[3].code = 'cancelled';
  if (thisWeek[10]) { thisWeek[10].code = 'irregular'; thisWeek[10].te = [{ id: 9, name: 'VER', orgname: 'BRO' }]; thisWeek[10].substText = 'Vertretung'; }
  return normalizeTimetable({
    fetchedAt: new Date().toISOString(),
    school: 'Demo-Gymnasium',
    server: 'demo.webuntis.com',
    timegrid: [{ day: 2, timeUnits: GRID.map(([s, e], i) => ({ name: String(i + 1), startTime: s, endTime: e })) }],
    periods,
  });
}

export async function loadDemo() {
  const state = getState();
  if (getAccount()) {
    toast('Die Demo würde deine Cloud-Daten überschreiben. Melde dich dafür zuerst ab.', 'error');
    return;
  }
  if (state.subjects.length && !(await confirmDialog('Demo-Daten ersetzen deine aktuellen Fächer und Noten. Fortfahren?', { ok: 'Demo laden' }))) return;
  const base = defaultState();
  base.settings = { ...state.settings };
  replaceState(base);
  update((s) => { s.localTimetable = demoTimetable(); }, { silent: true });
  syncSubjectsWithTimetable();
  const today = todayIso();
  const pick = (short) => getState().subjects.find((s) => s.short === short)?.id;
  const g = (short, type, points, daysAgo, title = '') => ({
    id: uid(), subjectId: pick(short), halbjahr: getState().settings.halbjahr, type, points, date: addDaysIso(today, -daysAgo), title, weight: 1,
  });
  update((s) => {
    s.grades.push(
      g('M', 'klausur', 12, 20, 'Klausur Analysis'), g('M', 'muendlich', 11, 5), g('M', 'test', 13, 30, 'Test Ableitungen'),
      g('PH', 'klausur', 10, 18, 'Klausur Mechanik'), g('PH', 'muendlich', 12, 3),
      g('D', 'klausur', 9, 25, 'Erörterung'), g('D', 'muendlich', 10, 7),
      g('E', 'muendlich', 13, 9), g('E', 'referat', 14, 12, 'Referat'),
      g('GE', 'muendlich', 8, 6), g('SW', 'muendlich', 11, 4), g('IF', 'klausur', 14, 15, 'Klausur Java'), g('SP', 'sonstige', 13, 2),
    );
    const k = (short, days, info) => ({ id: uid(), subjectId: pick(short), date: addDaysIso(today, days), title: 'Klausur', info, source: 'manual', halbjahr: s.settings.halbjahr });
    s.klausuren.push(k('M', 6, '1.–3. Std.'), k('D', 9, '3.–4. Std.'), k('PH', 13, '1.–3. Std.'), k('E', 20, '5.–6. Std.'));
    const hw = (short, days, title, done = false) => ({ id: uid(), subjectId: pick(short), title, due: addDaysIso(today, days), done, notes: '', createdAt: Date.now() });
    s.homework.push(hw('M', 1, 'S. 112 Nr. 4a–d'), hw('E', 2, 'Vokabeln Unit 3'), hw('D', -1, 'Gedichtanalyse fertig schreiben'), hw('PH', 5, 'Protokoll Versuch 2'), hw('GE', -3, 'Quelle M4 lesen', true));
    s.absences.push({ id: uid(), date: addDaysIso(today, -12), subjectId: null, lessons: 6, excused: true, note: 'krank' }, { id: uid(), date: addDaysIso(today, -4), subjectId: pick('SP'), lessons: 2, excused: false, note: '' });
    s.subjects.find((x) => x.short === 'M').goal = 13;
  });
  toast('Demo geladen – M und PH wurden über 5 Wochenstunden als LK erkannt.', 'success');
  location.hash = '#/';
}
