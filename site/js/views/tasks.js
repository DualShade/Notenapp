// Tab "Aufgaben": Hausaufgaben und Klausuren an einem Ort.

import { h } from '../ui.js';
import { getState } from '../store.js';
import { todayIso } from '../timetable.js';
import { homeworkSection, openHomework } from './homework.js';
import { klausurenView } from './klausuren.js';

let segment = 'hausaufgaben';

export function tasksView(requested) {
  if (requested) segment = requested;
  const state = getState();
  const today = todayIso();
  const hwCount = openHomework(state).length;
  const kCount = state.klausuren.filter((k) => k.date >= today).length;
  const tab = (key, label, count) => h('a', {
    href: `#/aufgaben/${key}`, class: segment === key ? 'active' : '', 'aria-current': segment === key ? 'page' : null,
  }, label, count ? h('span', { class: 'count' }, String(count)) : null);
  return h('div', { class: 'view' },
    h('nav', { class: 'segmented' }, tab('hausaufgaben', 'Hausaufgaben', hwCount), tab('klausuren', 'Klausuren', kCount)),
    segment === 'klausuren' ? klausurenView() : homeworkSection());
}
