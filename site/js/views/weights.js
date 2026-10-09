// Gewichtung schriftlich : mündlich – Standards für LK/GK und jedes Fach einzeln.

import { h, icon } from '../ui.js';
import { getState, update, kindOf } from '../store.js';
import { formatRatio, weightPercent } from '../grades.js';
import { activeSubjects, colorDot, kindBadge, ratioInput } from './common.js';

function setSubjectWeights(id, weights, { silent = false } = {}) {
  update((s) => {
    const x = s.subjects.find((y) => y.id === id);
    if (x) x.weights = weights;
  }, { silent });
}

function subjectRow(subject) {
  const { weights } = getState().settings;
  const standard = weights[kindOf(subject)];
  const custom = !!subject.weights;
  const effective = subject.weights ?? standard;
  return h('div', { class: 'weight-row' },
    h('div', { class: 'row gap', style: { alignItems: 'center' } },
      colorDot(subject),
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, subject.name, ' ', kindBadge(subject)),
        h('div', { class: 'sub' }, `${formatRatio(effective)} · ${weightPercent(effective, 'schriftlich')} % schriftlich`)),
      h('div', { class: 'segmented small', role: 'group', 'aria-label': `Gewichtung ${subject.name}` },
        h('button', { class: custom ? '' : 'active', 'aria-pressed': String(!custom), onclick: () => setSubjectWeights(subject.id, null) }, 'Standard'),
        h('button', { class: custom ? 'active' : '', 'aria-pressed': String(custom), onclick: () => { if (!custom) setSubjectWeights(subject.id, { ...standard }); } }, 'Eigen'))),
    custom ? h('div', { class: 'weight-custom' },
      ratioInput(subject.weights, (w) => setSubjectWeights(subject.id, w, { silent: true })),
      h('small', { class: 'hint' }, `Standard für ${kindOf(subject)} wäre ${formatRatio(standard)}.`)) : null);
}

export function weightsView() {
  const { settings } = getState();
  const subjects = activeSubjects();
  const customCount = subjects.filter((s) => s.weights).length;
  return h('div', { class: 'view' },
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Standard'),
      h('p', { class: 'muted small' }, 'Gilt für alle Fächer, die auf „Standard“ stehen. Verhältnis schriftlich (Klausuren, Tests) zu mündlich (Sonstige Mitarbeit).'),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Leistungskurse'),
        ratioInput(settings.weights.LK, (w) => update((s) => { s.settings.weights.LK = w; }, { silent: true }))),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Grundkurse / Basisfächer'),
        ratioInput(settings.weights.GK, (w) => update((s) => { s.settings.weights.GK = w; }, { silent: true }))),
      h('button', { class: 'btn ghost small', onclick: () => update(() => {}) }, icon('refresh', 16), 'Fächerliste aktualisieren')),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, `Pro Fach${customCount ? ` · ${customCount} eigen` : ''}`),
        customCount ? h('button', { class: 'btn ghost small', onclick: () => update((s) => { for (const x of s.subjects) x.weights = null; }) }, 'Alle auf Standard') : null),
      subjects.length
        ? h('div', { class: 'list weight-list' }, subjects.map(subjectRow))
        : h('p', { class: 'muted small' }, 'Noch keine Fächer.')));
}
