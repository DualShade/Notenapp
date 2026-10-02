// Notenübersicht zum Drucken bzw. "Als PDF sichern".

import { h, icon, formatDate } from '../ui.js';
import { getState, kindOf, subjectWeights } from '../store.js';
import { overallAverage, formatPoints, formatNoteValue, GRADE_TYPES, formatRatio, pointsLabel } from '../grades.js';
import { activeSubjects, averageFor, gradesFor } from './common.js';
import { getAccount } from '../sync.js';

let printHj = null;

export function printView() {
  const state = getState();
  const hj = printHj ?? state.settings.halbjahr;
  const subjects = activeSubjects();
  const rows = subjects.map((s) => ({ s, ...averageFor(s, hj), grades: gradesFor(s.id, hj).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')) }));
  const overall = overallAverage(rows.map((r) => ({ ...r, kind: kindOf(r.s) })), { lkDouble: state.settings.lkDouble });
  const account = getAccount();
  return h('div', { class: 'view print-view' },
    h('div', { class: 'row gap wrap no-print' },
      h('select', { class: 'small-select', onchange: (e) => { printHj = e.target.value; e.target.closest('.view').replaceWith(printView()); } },
        state.settings.halbjahre.map((x) => h('option', { value: x, selected: x === hj }, x))),
      h('button', { class: 'btn primary', onclick: () => window.print() }, icon('printer', 18), 'Drucken / als PDF sichern')),
    h('section', { class: 'card print-sheet' },
      h('div', { class: 'print-head' },
        h('div', {}, h('h2', {}, `Notenübersicht ${hj}`), h('p', { class: 'muted small' }, [account?.email, `Stand ${formatDate(new Date().toISOString().slice(0, 10), { day: '2-digit', month: '2-digit', year: 'numeric' })}`].filter(Boolean).join(' · '))),
        h('div', { class: 'print-total' }, h('strong', {}, formatPoints(overall)), h('span', {}, `Punkte · ≈ ${formatNoteValue(overall)}`))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table print-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fach'), h('th', {}, 'Art'), h('th', { class: 'nowrap' }, 'S : M'), h('th', {}, 'Schriftlich'), h('th', {}, 'Mündlich'), h('th', {}, 'Schnitt'), h('th', {}, 'Note'))),
        h('tbody', {}, rows.map((r) => h('tr', {},
          h('td', {}, h('strong', {}, r.s.name), r.grades.length ? h('div', { class: 'print-grades' }, r.grades.map((g) => `${GRADE_TYPES[g.type]?.label ?? ''} ${g.points}`).join(' · ')) : null),
          h('td', {}, kindOf(r.s)),
          h('td', { class: 'nowrap' }, formatRatio(subjectWeights(r.s))),
          h('td', { class: 'mono' }, formatPoints(r.parts.schriftlich)),
          h('td', { class: 'mono' }, formatPoints(r.parts.muendlich)),
          h('td', { class: 'mono' }, h('strong', {}, formatPoints(r.average)), r.final != null ? ' (Z)' : ''),
          h('td', {}, r.average == null ? '–' : pointsLabel(r.average))))))),
      h('p', { class: 'muted small' }, '(Z) = Zeugnisnote eingetragen. Erstellt mit der Notenapp.')));
}
