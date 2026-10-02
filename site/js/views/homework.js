// Hausaufgaben: Fälligkeit standardmäßig zur nächsten Stunde des Fachs (aus Untis).

import { h, icon, openModal, field, toast, confirmDialog, formatDate, empty, setChildren } from '../ui.js';
import { getState, update, uid, kindOf } from '../store.js';
import { todayIso, addDaysIso } from '../timetable.js';
import { currentTimetable } from '../data.js';
import { activeSubjects, subjectById, colorDot } from './common.js';

/** Datum der nächsten (nicht ausfallenden) Stunde eines Fachs nach `after`. */
export function nextLessonDate(subjectId, after = todayIso()) {
  const subject = subjectById(subjectId);
  const tt = currentTimetable();
  if (!subject?.untisKey || !tt) return null;
  return tt.lessons
    .filter((l) => l.courseKey === subject.untisKey && l.date > after && l.status !== 'cancelled')
    .map((l) => l.date)
    .sort()[0] ?? null;
}

function dueLabel(due, today = todayIso()) {
  const days = Math.round((new Date(`${due}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000);
  if (days < 0) return { text: days === -1 ? 'seit gestern' : `seit ${-days} Tagen`, cls: 'danger' };
  if (days === 0) return { text: 'heute', cls: 'warn' };
  if (days === 1) return { text: 'morgen', cls: 'warn' };
  return { text: formatDate(due), cls: '' };
}

export function openHomeworkEditor(item = null, preset = {}) {
  const today = todayIso();
  const firstSubject = preset.subjectId ?? activeSubjects()[0]?.id ?? null;
  const draft = item ? { ...item } : {
    id: uid(), subjectId: firstSubject, title: '', notes: '', done: false, createdAt: Date.now(),
    due: nextLessonDate(firstSubject) ?? addDaysIso(today, 1), ...preset,
  };
  openModal(item ? 'Hausaufgabe bearbeiten' : 'Neue Hausaufgabe', (close) => {
    const dueInput = h('input', { type: 'date', required: true, value: draft.due, onchange: (e) => { draft.due = e.target.value; renderChips(); } });
    const chips = h('div', { class: 'row gap wrap' });
    const renderChips = () => {
      const next = nextLessonDate(draft.subjectId);
      const options = [
        next ? [`Nächste Stunde (${formatDate(next)})`, next] : null,
        ['Morgen', addDaysIso(today, 1)],
        ['In 1 Woche', addDaysIso(today, 7)],
      ].filter(Boolean);
      setChildren(chips, options.map(([label, date]) => h('button', {
        type: 'button', class: `chip-btn${draft.due === date ? ' active' : ''}`,
        onclick: () => { draft.due = date; dueInput.value = date; renderChips(); },
      }, label)));
    };
    renderChips();
    const save = () => {
      if (!draft.title.trim()) { toast('Was ist zu tun?', 'error'); return; }
      update((s) => {
        const i = s.homework.findIndex((x) => x.id === draft.id);
        if (i >= 0) s.homework[i] = draft; else s.homework.push(draft);
      });
      close();
    };
    return h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
      field('Aufgabe', h('input', { type: 'text', required: true, value: draft.title, placeholder: 'z. B. S. 42 Nr. 3a–c', oninput: (e) => { draft.title = e.target.value; } })),
      field('Fach', h('select', { onchange: (e) => {
        draft.subjectId = e.target.value || null;
        const next = nextLessonDate(draft.subjectId);
        if (!item && next) { draft.due = next; dueInput.value = next; }
        renderChips();
      } },
      h('option', { value: '', selected: !draft.subjectId }, '– ohne Fach –'),
      activeSubjects().map((s) => h('option', { value: s.id, selected: s.id === draft.subjectId }, `${s.name} (${kindOf(s)})`)))),
      field('Fällig am', dueInput),
      chips,
      field('Notizen', h('textarea', { rows: 2, oninput: (e) => { draft.notes = e.target.value; } }, draft.notes ?? '')),
      h('div', { class: 'row gap end' },
        item ? h('button', { type: 'button', class: 'btn danger ghost', onclick: async () => {
          if (!(await confirmDialog('Diese Hausaufgabe löschen?'))) return;
          update((s) => { s.homework = s.homework.filter((x) => x.id !== draft.id); });
          close();
        } }, icon('trash', 18), 'Löschen') : null,
        h('button', { type: 'submit', class: 'btn primary' }, icon('check', 18), 'Speichern')));
  });
}

export function toggleHomework(id) {
  update((s) => {
    const hw = s.homework.find((x) => x.id === id);
    if (hw) { hw.done = !hw.done; hw.doneAt = hw.done ? Date.now() : null; }
  });
}

export function homeworkRow(hw, today = todayIso()) {
  const subject = subjectById(hw.subjectId);
  const due = dueLabel(hw.due, today);
  return h('div', { class: `hw-row${hw.done ? ' done' : ''}` },
    h('button', { class: `hw-check${hw.done ? ' checked' : ''}`, 'aria-label': hw.done ? 'Als offen markieren' : 'Als erledigt markieren', onclick: () => toggleHomework(hw.id) },
      hw.done ? icon('check', 16) : null),
    h('button', { class: 'hw-body', onclick: () => openHomeworkEditor(hw) },
      h('div', { class: 'title' }, hw.title),
      h('div', { class: 'sub' }, subject ? colorDot(subject) : null, subject ? ` ${subject.name}` : 'Ohne Fach', hw.notes ? ` · ${hw.notes}` : '')),
    hw.done ? null : h('span', { class: `due ${due.cls}` }, due.text));
}

export function openHomework(state = getState()) {
  return state.homework.filter((x) => !x.done).sort((a, b) => a.due.localeCompare(b.due));
}

export function homeworkSection() {
  const state = getState();
  const today = todayIso();
  const open = openHomework(state);
  const overdue = open.filter((x) => x.due < today);
  const soon = open.filter((x) => x.due >= today && x.due <= addDaysIso(today, 1));
  const later = open.filter((x) => x.due > addDaysIso(today, 1));
  const done = state.homework.filter((x) => x.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 30);
  const group = (title, items, cls = '') => (items.length ? h('section', { class: `card ${cls}` },
    h('h3', { class: 'card-title' }, `${title} (${items.length})`),
    h('div', { class: 'list' }, items.map((x) => homeworkRow(x, today)))) : null);
  return h('div', { class: 'stack' },
    h('button', { class: 'btn primary', onclick: () => openHomeworkEditor() }, icon('plus', 18), 'Hausaufgabe'),
    open.length ? null : empty('Alles erledigt 🎉', 'Keine offenen Hausaufgaben.'),
    group('Überfällig', overdue, 'danger-card'),
    group('Heute & morgen', soon),
    group('Später', later),
    done.length ? h('details', { class: 'card' },
      h('summary', {}, `Erledigt (${done.length})`),
      h('div', { class: 'list' }, done.map((x) => homeworkRow(x, today)))) : null);
}
