import { h, icon, empty, formatDate } from '../ui.js';
import { getState, update, kindOf, subjectWeights } from '../store.js';
import { overallAverage, GRADE_TYPES, GROUP_LABELS, pointsTone, formatPoints, pointsLabel, weightPercent, requiredPoints, effectivePoints, POINT_LABELS } from '../grades.js';
import { openHomeworkEditor, homeworkRow } from './homework.js';
import { todayIso } from '../timetable.js';
import {
  activeSubjects, averageFor, kindBadge, colorDot, pointsPill, averageBlock, gradesFor,
  openGradeEditor, openSubjectEditor, openKlausurEditor, subjectById, klausurRow, setFinal,
} from './common.js';

export function subjectsView() {
  const state = getState();
  const subjects = activeSubjects();
  const averages = subjects.map((s) => ({ subject: s, ...averageFor(s), kind: kindOf(s) }));
  const overall = overallAverage(averages, { lkDouble: state.settings.lkDouble });

  if (!subjects.length) {
    return h('div', { class: 'view' }, empty('Noch keine Fächer',
      'Fächer werden automatisch aus deinem Untis-Stundenplan angelegt. Du kannst sie auch manuell hinzufügen.',
      h('button', { class: 'btn primary', onclick: () => openSubjectEditor() }, icon('plus', 18), 'Fach hinzufügen')));
  }

  const section = (kind) => {
    const items = averages.filter((a) => a.kind === kind);
    if (!items.length) return null;
    return h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, kind === 'LK' ? 'Leistungskurse' : 'Grundkurse'),
      h('div', { class: 'list' }, items.map((a) => h('a', { class: 'list-item', href: `#/fach/${a.subject.id}` },
        colorDot(a.subject),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, a.subject.name, ' ', kindBadge(a.subject)),
          h('div', { class: 'sub' }, [
            a.subject.hours != null ? `${String(a.subject.hours).replace('.', ',')} Std./Woche` : null,
            a.count ? `${a.count} ${a.count === 1 ? 'Note' : 'Noten'}` : 'keine Noten',
          ].filter(Boolean).join(' · '))),
        pointsPill(a.average),
        icon('chevron', 18)))));
  };

  const archived = state.subjects.filter((s) => s.archived);
  return h('div', { class: 'view' },
    h('section', { class: 'card hero' }, averageBlock(overall, `Schnitt ${state.settings.halbjahr}${state.settings.lkDouble ? ' (LK doppelt)' : ''}`)),
    section('LK'),
    section('GK'),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn primary', onclick: () => openGradeEditor(null) }, icon('plus', 18), 'Note eintragen'),
      h('button', { class: 'btn ghost', onclick: () => openSubjectEditor() }, icon('plus', 18), 'Fach hinzufügen'),
      h('a', { class: 'btn ghost', href: '#/gewichtung' }, 'Gewichtung')),
    archived.length ? h('details', { class: 'card' },
      h('summary', {}, `Ausgeblendete Fächer (${archived.length})`),
      h('div', { class: 'list' }, archived.map((s) => h('button', { class: 'list-item', onclick: () => openSubjectEditor(s) }, colorDot(s), h('div', { class: 'grow title' }, s.name))))) : null);
}

export function subjectDetailView(id) {
  const state = getState();
  const subject = subjectById(id);
  if (!subject) return h('div', { class: 'view' }, empty('Fach nicht gefunden', null, h('a', { class: 'btn', href: '#/faecher' }, 'Zurück')));
  const grades = gradesFor(subject.id).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const { average, parts, computed, final } = averageFor(subject);
  const weights = subjectWeights(subject);
  const today = todayIso();
  const upcoming = state.klausuren.filter((k) => k.subjectId === subject.id && k.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const otherHalbjahre = state.settings.halbjahre
    .filter((hj) => hj !== state.settings.halbjahr)
    .map((hj) => ({ hj, avg: averageFor(subject, hj).average }))
    .filter((x) => x.avg != null);

  const groupList = (group) => {
    const items = grades.filter((g) => (GRADE_TYPES[g.type]?.group ?? 'muendlich') === group);
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, GROUP_LABELS[group], h('span', { class: 'muted' }, ` · ${weightPercent(weights, group)} %`)),
        pointsPill(parts[group])),
      items.length
        ? h('div', { class: 'list' }, items.map((g) => h('button', { class: 'list-item', onclick: () => openGradeEditor(subject.id, g) },
          h('span', { class: `grade-chip ${pointsTone(g.points)}` }, String(g.points)),
          h('div', { class: 'grow' },
            h('div', { class: 'title' }, g.title || GRADE_TYPES[g.type]?.label || 'Note'),
            h('div', { class: 'sub' }, [GRADE_TYPES[g.type]?.label, g.date ? formatDate(g.date, { day: '2-digit', month: '2-digit', year: 'numeric' }) : null, g.weight !== 1 ? `×${String(g.weight).replace('.', ',')}` : null].filter(Boolean).join(' · '))),
          h('span', { class: 'muted' }, pointsLabel(g.points)))))
        : h('p', { class: 'muted small' }, 'Noch keine Noten.'));
  };

  return h('div', { class: 'view' },
    h('div', { class: 'row between center' },
      h('a', { class: 'btn ghost small', href: '#/faecher' }, icon('back', 18), 'Fächer'),
      h('button', { class: 'btn ghost small', onclick: () => openSubjectEditor(subject) }, icon('edit', 18), 'Bearbeiten')),
    h('section', { class: 'card hero', style: { borderTop: `4px solid ${subject.color}` } },
      h('div', { class: 'row gap center' }, h('h2', { class: 'subject-title' }, subject.name), kindBadge(subject)),
      h('p', { class: 'muted small' }, [
        subject.group ?? subject.short,
        subject.hours != null ? `${String(subject.hours).replace('.', ',')} Wochenstunden` : null,
        subject.teachers?.length ? subject.teachers.join(', ') : null,
      ].filter(Boolean).join(' · ')),
      averageBlock(average, final != null ? `Zeugnisnote ${state.settings.halbjahr} · berechnet ${formatPoints(computed)}` : `Schnitt ${state.settings.halbjahr}`),
      otherHalbjahre.length ? h('div', { class: 'row gap wrap small' }, otherHalbjahre.map((x) => h('span', { class: 'chip' }, `${x.hj}: ${formatPoints(x.avg)} P`))) : null),
    h('button', { class: 'btn primary block', onclick: () => openGradeEditor(subject.id) }, icon('plus', 18), 'Note eintragen'),
    groupList('schriftlich'),
    groupList('muendlich'),
    goalCard(subject, grades, weights, computed),
    finalCard(subject, computed, final),
    subjectHomework(subject),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, 'Anstehende Termine'),
        h('button', { class: 'icon-btn', 'aria-label': 'Termin hinzufügen', onclick: () => openKlausurEditor(null, { subjectId: subject.id }) }, icon('plus'))),
      upcoming.length ? h('div', { class: 'list' }, upcoming.map((k) => klausurRow(k, today))) : h('p', { class: 'muted small' }, 'Keine Termine.')));
}

/** Wunschnote: was brauche ich in der nächsten Klausur / mündlich? */
function goalCard(subject, grades, weights, computed) {
  const goal = subject.goal ?? null;
  const select = h('select', { class: 'small-select', 'aria-label': 'Ziel', onchange: (e) => update((s) => {
    const x = s.subjects.find((y) => y.id === subject.id);
    if (x) x.goal = e.target.value === '' ? null : Number(e.target.value);
  }) },
  h('option', { value: '', selected: goal == null }, 'kein Ziel'),
  Array.from({ length: 15 }, (_, i) => 15 - i).map((p) => h('option', { value: p, selected: goal === p }, `${p} P (${POINT_LABELS[p]})`)));
  let body = h('p', { class: 'muted small' }, 'Wähle eine Wunschnote – die App rechnet aus, was du in der nächsten Klausur oder mündlich brauchst.');
  if (goal != null) {
    const line = (group, label) => {
      const x = requiredPoints(grades, weights, goal - 0.5, group); // ab x,5 wird aufgerundet
      if (x <= 0) return h('li', {}, h('strong', {}, label), ': Ziel ist sicher – selbst mit 0 Punkten.');
      if (x > 15) return h('li', {}, h('strong', {}, label), `: mit einer Note nicht erreichbar (bräuchte ${formatPoints(x)} P).`);
      const need = Math.ceil(x - 1e-9);
      return h('li', {}, h('strong', {}, label), ': mindestens ', h('span', { class: `pill ${pointsTone(need)}` }, `${need} P`), ` (${POINT_LABELS[need]})`);
    };
    body = h('div', { class: 'stack' },
      h('p', { class: 'small' }, computed == null ? `Ziel: ${goal} Punkte.` : `Aktuell ${formatPoints(computed)} P – Ziel ${goal} P ${computed >= goal - 0.5 ? '✅ erreicht' : ''}`),
      h('ul', { class: 'goal-list' },
        line('schriftlich', 'Nächste Klausur'),
        line('muendlich', 'Nächste mündliche Note')));
  }
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', { class: 'card-title' }, icon('target', 18), ' Wunschnote'), select),
    body);
}

/** Zeugnisnote (Halbjahresnote) – automatisch gerundet oder manuell. */
function finalCard(subject, computed, final) {
  const hj = getState().settings.halbjahr;
  const auto = effectivePoints(computed, null);
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { class: 'card-title' }, `Zeugnisnote ${hj}`),
      h('select', { class: 'small-select', 'aria-label': 'Zeugnisnote', onchange: (e) => setFinal(subject.id, hj, e.target.value === '' ? null : Number(e.target.value)) },
        h('option', { value: '', selected: final == null }, auto == null ? 'noch offen' : `automatisch (${auto} P)`),
        Array.from({ length: 16 }, (_, i) => 15 - i).map((p) => h('option', { value: p, selected: final === p }, `${p} P (${POINT_LABELS[p]})`)))),
    h('p', { class: 'muted small' }, 'Trag hier die Note aus dem Zeugnis ein, sobald du sie kennst. Sie zählt dann für Gesamtschnitt und Abi-Rechner.'));
}

function subjectHomework(subject) {
  const open = getState().homework.filter((x) => x.subjectId === subject.id && !x.done).sort((a, b) => a.due.localeCompare(b.due));
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { class: 'card-title' }, 'Hausaufgaben'),
      h('button', { class: 'icon-btn', 'aria-label': 'Hausaufgabe hinzufügen', onclick: () => openHomeworkEditor(null, { subjectId: subject.id }) }, icon('plus'))),
    open.length ? h('div', { class: 'list' }, open.map((x) => homeworkRow(x))) : h('p', { class: 'muted small' }, 'Keine offenen Hausaufgaben.'));
}
