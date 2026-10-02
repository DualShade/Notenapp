import { h, icon, empty, openModal, formatDate, formatDateTime, toast } from '../ui.js';
import { getState, update } from '../store.js';
import { mondayKey, addDaysIso, todayIso, weekMatrix, slotSpan, minutesOf } from '../timetable.js';
import { currentTimetable, currentCourses, subjectForLesson, untisAccount, refreshUntis, server } from '../data.js';
import { openUntisConnect } from './untis-connect.js';
import { openHomeworkEditor, nextLessonDate } from './homework.js';
import { openAbsenceEditor } from './absences.js';
import { kindBadge, colorDot } from './common.js';
import { loadDemo } from '../demo.js';

let shownMonday = null;
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];

function lessonDetails(lesson) {
  const subject = subjectForLesson(lesson);
  const rows = [
    ['Zeit', `${formatDate(lesson.date, { weekday: 'long', day: '2-digit', month: '2-digit' })}, ${lesson.start}–${lesson.end}`],
    ['Kurs', lesson.group ?? lesson.subject?.short],
    ['Lehrkraft', lesson.teachers.join(', ')],
    ['Raum', lesson.rooms.join(', ')],
    ['Status', { regular: 'Regulär', cancelled: 'Entfällt', irregular: 'Vertretung / Änderung', event: 'Veranstaltung' }[lesson.status]],
    ['Vertretungstext', lesson.substText],
    ['Info', lesson.info],
  ].filter(([, v]) => v);
  openModal(subject?.name ?? lesson.subject?.long ?? lesson.courseKey, h('div', { class: 'stack' },
    subject ? h('div', { class: 'row gap center' }, colorDot(subject), kindBadge(subject), h('span', { class: 'muted' }, subject.hours != null ? `${String(subject.hours).replace('.', ',')} Wochenstunden` : '')) : null,
    h('dl', { class: 'details' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
    subject ? h('div', { class: 'row gap wrap' },
      h('a', { class: 'btn primary', href: `#/fach/${subject.id}`, onclick: () => document.querySelector('dialog')?.close() }, 'Zum Fach'),
      h('button', { class: 'btn', onclick: () => { document.querySelector('dialog')?.close(); openHomeworkEditor(null, { subjectId: subject.id, due: nextLessonDate(subject.id, lesson.date) ?? lesson.date }); } }, icon('plus', 16), 'Hausaufgabe'),
      h('button', { class: 'btn ghost', onclick: () => { document.querySelector('dialog')?.close(); openAbsenceEditor(null, { subjectId: subject.id, date: lesson.date, lessons: lesson.lessonUnits ?? Math.max(1, Math.round((minutesOf(lesson.end) - minutesOf(lesson.start)) / 45)) }); } }, 'Gefehlt')) : null));
}

function lessonChip(lesson) {
  const subject = subjectForLesson(lesson);
  const label = subject?.short || lesson.subject?.short || lesson.courseKey;
  return h('button', {
    class: `lesson ${lesson.status}${lesson.roomChanged ? ' room-changed' : ''}${lesson.teacherChanged ? ' teacher-changed' : ''}`,
    style: { '--c': subject?.color ?? '#8b8d98' },
    title: `${subject?.name ?? lesson.subject?.long ?? ''} ${lesson.start}–${lesson.end}`,
    onclick: () => lessonDetails(lesson),
  },
  h('strong', {}, label),
  h('span', {}, lesson.rooms.join(', ')));
}

function weekGrid(timetable, monday) {
  const grid = timetable.timegrid.length ? timetable.timegrid : [{ name: '1', start: '08:00', end: '08:45' }];
  const days = weekMatrix(timetable.lessons, monday);
  const today = todayIso();
  const cells = [];
  cells.push(h('div', { class: 'tt-corner' }));
  days.forEach((d, i) => cells.push(h('div', { class: `tt-day${d.date === today ? ' today' : ''}`, style: { gridColumn: i + 2, gridRow: 1 } },
    h('strong', {}, WEEKDAYS[i]), h('small', {}, formatDate(d.date, { day: '2-digit', month: '2-digit' })))));
  grid.forEach((u, r) => cells.push(h('div', { class: 'tt-unit', style: { gridColumn: 1, gridRow: r + 2 } },
    h('strong', {}, u.name), h('small', {}, u.start))));
  days.forEach((d, col) => {
    // Stunden mit gleicher Position (z. B. Ausfall + Vertretung) in einer Zelle stapeln
    const slots = new Map();
    for (const l of d.lessons) {
      const span = slotSpan(l, grid);
      const key = `${span.first}-${span.last}`;
      if (!slots.has(key)) slots.set(key, { span, lessons: [] });
      slots.get(key).lessons.push(l);
    }
    for (const { span, lessons } of slots.values()) {
      cells.push(h('div', { class: 'tt-cell', style: { gridColumn: col + 2, gridRow: `${span.first + 2} / ${span.last + 3}` } }, lessons.map(lessonChip)));
    }
    if (!d.lessons.length) {
      cells.push(h('div', { class: 'tt-free', style: { gridColumn: col + 2, gridRow: `2 / ${grid.length + 2}` } }, 'frei'));
    }
  });
  return h('div', { class: 'tt-grid', style: { gridTemplateRows: `auto repeat(${grid.length}, minmax(3rem, auto))` } }, cells);
}

async function runLiveImport(button) {
  button.disabled = true;
  try {
    const { timetable, created } = await refreshUntis();
    toast(`Stundenplan geladen: ${timetable.lessons.length} Stunden${created ? `, ${created} Fächer angelegt` : ''}.`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    button.disabled = false;
  }
}

export function timetableView() {
  const timetable = currentTimetable();
  if (!timetable) {
    return h('div', { class: 'view' }, empty('Noch kein Stundenplan',
      'Verbinde dein WebUntis-Konto: Schule suchen, Benutzername und Passwort eingeben – fertig.',
      h('div', { class: 'row gap wrap center-x' },
        h('button', { class: 'btn primary', onclick: openUntisConnect }, icon('link', 18), 'Mit Untis verbinden'),
        h('button', { class: 'btn ghost', onclick: loadDemo }, 'Demo ansehen'))));
  }

  const today = todayIso();
  const weeks = [...new Set(timetable.lessons.map((l) => mondayKey(l.date)))].sort();
  if (!shownMonday) {
    const current = mondayKey(today);
    // Am Wochenende direkt die nächste Woche zeigen
    const dow = new Date(`${today}T12:00:00`).getDay();
    shownMonday = dow === 0 || dow === 6 ? addDaysIso(current, 7) : current;
    if (!weeks.includes(shownMonday) && weeks.length) shownMonday = weeks.find((w) => w >= shownMonday) ?? weeks.at(-1);
  }
  const rerender = () => update(() => {});
  const courses = currentCourses();
  const threshold = getState().settings.lkThreshold;
  const weekLessons = timetable.lessons.filter((l) => mondayKey(l.date) === shownMonday);
  const changes = weekLessons.filter((l) => l.status !== 'regular').length;

  return h('div', { class: 'view wide' },
    h('div', { class: 'row between center week-nav' },
      h('button', { class: 'icon-btn', 'aria-label': 'Vorherige Woche', disabled: shownMonday <= weeks[0], onclick: () => { shownMonday = addDaysIso(shownMonday, -7); rerender(); } }, icon('left')),
      h('button', { class: 'week-label', onclick: () => { shownMonday = null; rerender(); } },
        h('strong', {}, `${formatDate(shownMonday, { day: '2-digit', month: '2-digit' })} – ${formatDate(addDaysIso(shownMonday, 4), { day: '2-digit', month: '2-digit', year: 'numeric' })}`),
        h('small', {}, changes ? `${changes} Änderung${changes === 1 ? '' : 'en'}` : 'Diese Woche')),
      h('button', { class: 'icon-btn', 'aria-label': 'Nächste Woche', disabled: shownMonday >= weeks.at(-1), onclick: () => { shownMonday = addDaysIso(shownMonday, 7); rerender(); } }, icon('right'))),
    h('section', { class: 'card flush' }, weekGrid(timetable, shownMonday)),
    h('div', { class: 'legend small muted' },
      h('span', {}, h('i', { class: 'lg cancelled' }), 'Entfällt'),
      h('span', {}, h('i', { class: 'lg irregular' }), 'Vertretung/Änderung'),
      h('span', {}, `Stand: ${formatDateTime(timetable.fetchedAt)}`)),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, 'Kurse aus Untis'),
        untisAccount() ? h('button', { class: 'btn ghost small', onclick: (e) => runLiveImport(e.currentTarget) }, icon('refresh', 16), 'Aktualisieren') : null),
      h('p', { class: 'muted small' }, `Kurse mit mindestens ${String(threshold).replace('.', ',')} Wochenstunden werden als Leistungskurs (LK) erkannt, alle anderen als Grundkurs (GK). Ferien- und Feiertagswochen werden ignoriert. Im Fach kannst du die Einstufung manuell ändern.`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Kurs'), h('th', {}, 'Std.'), h('th', {}, 'Art'), h('th', {}, 'Lehrkraft'))),
        h('tbody', {}, courses.map((c) => {
          const subject = getState().subjects.find((s) => s.untisKey === c.key);
          return h('tr', {},
            h('td', {}, subject ? h('a', { href: `#/fach/${subject.id}` }, colorDot(subject), ' ', subject.name) : c.long, h('div', { class: 'muted small' }, c.key)),
            h('td', {}, String(c.hours).replace('.', ',')),
            h('td', {}, subject ? kindBadge(subject) : h('span', { class: `badge ${c.kind === 'LK' ? 'lk' : 'gk'}` }, c.kind)),
            h('td', {}, c.teachers.join(', ')));
        }))))));
}
