// Fehlzeiten: einzelne Stunden oder ganze Tage, entschuldigt/unentschuldigt.

import { h, icon, openModal, field, toast, confirmDialog, formatDate, empty } from '../ui.js';
import { getState, update, uid, kindOf } from '../store.js';
import { todayIso, lessonsOnDate } from '../timetable.js';
import { currentTimetable } from '../data.js';
import { activeSubjects, subjectById, colorDot } from './common.js';

export function openAbsenceEditor(item = null, preset = {}) {
  const draft = item ? { ...item } : { id: uid(), date: todayIso(), subjectId: null, lessons: 1, excused: false, note: '', ...preset };
  openModal(item ? 'Fehlzeit bearbeiten' : 'Fehlzeit eintragen', (close) => {
    const lessonsInput = h('input', { type: 'number', min: '1', max: '12', value: draft.lessons, oninput: (e) => { draft.lessons = Math.max(1, Number(e.target.value) || 1); } });
    const fillFromPlan = () => {
      // Ganzer Tag: Anzahl der Stunden laut Stundenplan übernehmen
      const tt = currentTimetable();
      if (!tt || draft.subjectId) return;
      const n = lessonsOnDate(tt.lessons, draft.date).filter((l) => l.status !== 'cancelled').length;
      if (n) { draft.lessons = n; lessonsInput.value = n; }
    };
    return h('form', { class: 'stack', onsubmit: (e) => {
      e.preventDefault();
      update((s) => {
        const i = s.absences.findIndex((x) => x.id === draft.id);
        if (i >= 0) s.absences[i] = draft; else s.absences.push(draft);
      });
      toast('Gespeichert.', 'success');
      close();
    } },
    h('div', { class: 'grid-2' },
      field('Datum', h('input', { type: 'date', required: true, value: draft.date, onchange: (e) => { draft.date = e.target.value; fillFromPlan(); } })),
      field('Stunden', lessonsInput)),
    field('Fach', h('select', { onchange: (e) => { draft.subjectId = e.target.value || null; fillFromPlan(); } },
      h('option', { value: '', selected: !draft.subjectId }, 'Ganzer Tag / mehrere Fächer'),
      activeSubjects().map((s) => h('option', { value: s.id, selected: s.id === draft.subjectId }, `${s.name} (${kindOf(s)})`)))),
    h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: draft.excused, onchange: (e) => { draft.excused = e.target.checked; } }), h('span', {}, 'Entschuldigt')),
    field('Notiz', h('input', { type: 'text', value: draft.note ?? '', placeholder: 'z. B. Arzttermin', oninput: (e) => { draft.note = e.target.value; } })),
    h('div', { class: 'row gap end' },
      item ? h('button', { type: 'button', class: 'btn danger ghost', onclick: async () => {
        if (!(await confirmDialog('Diesen Eintrag löschen?'))) return;
        update((s) => { s.absences = s.absences.filter((x) => x.id !== draft.id); });
        close();
      } }, icon('trash', 18), 'Löschen') : null,
      h('button', { type: 'submit', class: 'btn primary' }, icon('check', 18), 'Speichern')));
  });
}

export function absencesView() {
  const list = [...getState().absences].sort((a, b) => b.date.localeCompare(a.date));
  const total = list.reduce((a, x) => a + x.lessons, 0);
  const unexcused = list.filter((x) => !x.excused).reduce((a, x) => a + x.lessons, 0);
  const days = new Set(list.filter((x) => !x.subjectId).map((x) => x.date)).size;
  const perSubject = new Map();
  for (const x of list) {
    if (!x.subjectId) continue;
    const e = perSubject.get(x.subjectId) ?? { lessons: 0, unexcused: 0 };
    e.lessons += x.lessons;
    if (!x.excused) e.unexcused += x.lessons;
    perSubject.set(x.subjectId, e);
  }
  return h('div', { class: 'view' },
    h('button', { class: 'btn primary', onclick: () => openAbsenceEditor() }, icon('plus', 18), 'Fehlzeit eintragen'),
    h('section', { class: 'card' },
      h('div', { class: 'stats' },
        h('div', {}, h('span', { class: 'muted' }, 'Stunden'), h('strong', {}, String(total))),
        h('div', {}, h('span', { class: 'muted' }, 'Unentschuldigt'), h('strong', { class: unexcused ? 'danger' : '' }, String(unexcused))),
        h('div', {}, h('span', { class: 'muted' }, 'Ganze Tage'), h('strong', {}, String(days))))),
    perSubject.size ? h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Nach Fach'),
      h('div', { class: 'list compact' }, [...perSubject.entries()].sort((a, b) => b[1].lessons - a[1].lessons).map(([id, e]) => {
        const s = subjectById(id);
        return h('div', { class: 'list-item' }, colorDot(s), h('div', { class: 'grow title' }, s?.name ?? 'Fach'),
          h('span', {}, `${e.lessons} Std.`), e.unexcused ? h('span', { class: 'tag danger' }, `${e.unexcused} unent.`) : null);
      }))) : null,
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Einträge'),
      list.length ? h('div', { class: 'list' }, list.map((x) => {
        const s = subjectById(x.subjectId);
        return h('button', { class: 'list-item', onclick: () => openAbsenceEditor(x) },
          s ? colorDot(s) : icon('calendar', 16),
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, formatDate(x.date, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }), ' · ', s?.name ?? 'Ganzer Tag'),
            h('div', { class: 'sub' }, [`${x.lessons} Std.`, x.note].filter(Boolean).join(' · '))),
          h('span', { class: `tag ${x.excused ? 'ok' : 'danger'}` }, x.excused ? 'entschuldigt' : 'offen'));
      })) : empty('Keine Fehlzeiten', 'Super! Trag hier versäumte Stunden ein, um den Überblick zu behalten.')));
}
