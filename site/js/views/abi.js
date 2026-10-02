// Abi-Rechner: Block I (Qualifikationsphase) + Block II (Prüfungen).

import { h, icon, field } from '../ui.js';
import { getState, update, kindOf } from '../store.js';
import { effectivePoints, pointsTone, formatPoints } from '../grades.js';
import { selectCourses, blockOne, blockTwo, abiGrade, pointsForGrade, checkRules } from '../abi-calc.js';
import { activeSubjects, averageFor, kindBadge } from './common.js';

const fmt = (n, d = 1) => (n == null ? '–' : Number(n).toFixed(d).replace('.', ','));

function abiSettings() {
  const s = getState().settings;
  const defaults = {
    totalCourses: 40,
    halbjahre: s.halbjahre.filter((x) => /^Q/i.test(x)).slice(0, 4),
    forced: {},
    exams: Array.from({ length: 5 }, () => ({ subjectId: null, points: null })),
    target: 2.0,
  };
  return { ...defaults, ...(s.abi ?? {}) };
}

function setAbi(fn) {
  update((s) => {
    s.settings.abi = { ...abiSettings(), ...(s.settings.abi ?? {}) };
    fn(s.settings.abi);
  });
}

/** Alle Kurse der Q-Phase mit (ggf. geschätzten) Punkten. */
function buildCourses(cfg) {
  const courses = [];
  for (const subject of activeSubjects()) {
    const known = cfg.halbjahre.map((hj) => {
      const a = averageFor(subject, hj);
      return effectivePoints(a.computed, a.final);
    });
    // Prognose für fehlende Halbjahre: Schnitt der bekannten, sonst aktueller Schnitt
    const knownValues = known.filter((p) => p != null);
    const currentAvg = averageFor(subject).computed;
    const estimate = knownValues.length
      ? Math.round(knownValues.reduce((a, b) => a + b, 0) / knownValues.length)
      : currentAvg != null ? Math.round(currentAvg) : null;
    cfg.halbjahre.forEach((hj, i) => {
      courses.push({
        id: `${subject.id}|${hj}`,
        subject,
        hj,
        isLK: kindOf(subject) === 'LK',
        points: known[i] ?? estimate,
        estimated: known[i] == null,
      });
    });
  }
  return courses;
}

export function abiView() {
  const cfg = abiSettings();
  const subjects = activeSubjects();
  const courses = buildCourses(cfg);
  const chosen = selectCourses(courses, { totalCourses: cfg.totalCourses, forced: cfg.forced });
  const b1 = blockOne(courses, chosen);
  const lkCount = courses.filter((c) => c.isLK).length;

  // Prüfungen: eingetragene Punkte oder Prognose (Schnitt des Fachs in der Q-Phase)
  const chosenPoints = courses.filter((c) => chosen.has(c.id) && c.points != null).map((c) => c.points);
  const courseAvg = chosenPoints.length ? Math.round(chosenPoints.reduce((a, b) => a + b, 0) / chosenPoints.length) : null;
  const examPoints = cfg.exams.map((e) => {
    if (e.points != null) return { value: e.points, estimated: false };
    // Prognose: Schnitt des Prüfungsfachs, ohne Fach der Schnitt aller Kurse
    const vals = e.subjectId ? courses.filter((c) => c.subject.id === e.subjectId && c.points != null).map((c) => c.points) : [];
    const value = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : courseAvg;
    return { value, estimated: true };
  });
  const b2 = blockTwo(examPoints.map((e) => e.value));
  const total = b1.E + b2.E;
  const grade = abiGrade(total);
  const anyEstimate = courses.some((c) => chosen.has(c.id) && c.estimated) || examPoints.some((e) => e.estimated && e.value != null);
  const issues = checkRules(b1, b2, { totalCourses: cfg.totalCourses });

  // Wunsch-Abi: was brauche ich in den Prüfungen?
  const needTotal = pointsForGrade(cfg.target);
  const needB2 = needTotal - b1.E;
  const perExam = needB2 / 20; // 5 Prüfungen × 4
  let needText;
  if (needB2 <= 0) needText = 'Schon mit Block I sicher erreichbar 🎉';
  else if (perExam > 15) needText = `Mit den aktuellen Kursnoten nicht erreichbar (bräuchte im Schnitt ${fmt(perExam)} P pro Prüfung).`;
  else needText = `Du brauchst in den 5 Prüfungen im Schnitt ${fmt(Math.max(perExam, 0))} Punkte (${needB2} von 300 in Block II).`;

  const cycle = (id) => setAbi((a) => {
    const cur = a.forced[id];
    a.forced = { ...a.forced };
    // automatisch → manuell umgekehrt → wieder automatisch
    if (cur === undefined) a.forced[id] = !chosen.has(id);
    else delete a.forced[id];
  });

  if (!subjects.length) {
    return h('div', { class: 'view' }, h('section', { class: 'card' }, h('p', { class: 'muted' }, 'Lege zuerst Fächer an oder verbinde Untis.')));
  }

  return h('div', { class: 'view' },
    h('section', { class: 'card hero' },
      h('div', { class: 'avg-block' },
        h('div', { class: `avg-points ${grade == null ? 'tone-6' : pointsTone(17 - grade * 3)}` }, grade == null ? '–' : fmt(grade)),
        h('div', { class: 'avg-meta' },
          h('span', {}, anyEstimate ? 'Abi-Schnitt (Prognose)' : 'Abi-Schnitt'),
          h('strong', {}, `${total} von 900 Punkten`),
          h('span', {}, `Block I: ${b1.E}/600 · Block II: ${examPoints.some((e) => e.estimated) ? '≈ ' : ''}${b2.E}/300`))),
      issues.length ? h('ul', { class: 'issues' }, issues.map((t) => h('li', {}, icon('alert', 14), ' ', t))) : h('p', { class: 'ok small' }, icon('check', 14), ' Alle Bedingungen erfüllt.'),
      anyEstimate ? h('p', { class: 'muted small' }, 'Kursiv = geschätzt aus deinen bisherigen Noten. Trag Zeugnisnoten im Fach ein, dann wird die Prognose genauer.') : null),

    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, icon('target', 18), ' Wunsch-Abi'),
        h('select', { class: 'small-select', onchange: (e) => setAbi((a) => { a.target = Number(e.target.value); }) },
          Array.from({ length: 31 }, (_, i) => 1 + i / 10).map((n) => h('option', { value: n, selected: Math.abs(n - cfg.target) < 0.01 }, fmt(n))))),
      h('p', {}, needText),
      h('p', { class: 'muted small' }, `Für ${fmt(cfg.target)} brauchst du mindestens ${needTotal} Gesamtpunkte.`)),

    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, `Block I · ${b1.count}/${cfg.totalCourses} Kurse`),
        h('span', { class: `tag ${b1.under > 8 ? 'danger' : ''}` }, `${b1.under} Unterkurse`)),
      h('p', { class: 'muted small' }, `Alle ${lkCount} LK-Kurse zählen doppelt und sind gesetzt; dazu automatisch die besten GK-Kurse. Tippe einen Kurs an, um ihn fest einzubringen (●) oder auszuschließen (○). Pflichtkurse deines Bundeslands kannst du so erzwingen.`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table abi-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fach'), cfg.halbjahre.map((x) => h('th', {}, x)))),
        h('tbody', {}, subjects.map((s) => h('tr', {},
          h('td', {}, s.short || s.name, ' ', kindBadge(s)),
          cfg.halbjahre.map((hj) => {
            const c = courses.find((x) => x.id === `${s.id}|${hj}`);
            const forced = cfg.forced[c.id];
            return h('td', {}, c.points == null ? h('span', { class: 'muted' }, '–') : h('button', {
              class: `abi-cell ${pointsTone(c.points)}${chosen.has(c.id) ? ' chosen' : ''}${c.estimated ? ' estimated' : ''}`,
              title: `${chosen.has(c.id) ? 'eingebracht' : 'nicht eingebracht'}${forced !== undefined ? ' (manuell)' : ''}${c.estimated ? ', geschätzt' : ''}`,
              onclick: () => cycle(c.id),
            }, String(c.points), forced === true ? ' ●' : forced === false ? ' ○' : ''));
          }))))))),

    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Block II · Abiturprüfungen'),
      h('div', { class: 'stack' }, cfg.exams.map((e, i) => h('div', { class: 'exam-row' },
        h('span', { class: 'exam-no' }, `${i + 1}.`),
        h('select', { onchange: (ev) => setAbi((a) => { a.exams = a.exams.map((x, j) => (j === i ? { ...x, subjectId: ev.target.value || null } : x)); }) },
          h('option', { value: '' }, i < 2 ? `${i + 1}. Fach (LK)` : i < 4 ? `${i + 1}. Fach` : '5. Komponente'),
          subjects.map((s) => h('option', { value: s.id, selected: s.id === e.subjectId }, s.name))),
        h('select', { class: 'small-select', onchange: (ev) => setAbi((a) => { a.exams = a.exams.map((x, j) => (j === i ? { ...x, points: ev.target.value === '' ? null : Number(ev.target.value) } : x)); }) },
          h('option', { value: '', selected: e.points == null }, examPoints[i].value == null ? 'Punkte' : `≈ ${examPoints[i].value}`),
          Array.from({ length: 16 }, (_, p) => 15 - p).map((p) => h('option', { value: p, selected: e.points === p }, String(p)))))))),

    h('details', { class: 'card' },
      h('summary', {}, 'Einstellungen & Regeln'),
      field('Einzubringende Kurse in Block I', h('input', { type: 'number', min: '20', max: '60', value: cfg.totalCourses, onchange: (e) => setAbi((a) => { a.totalCourses = Number(e.target.value) || 40; }) }),
        'NRW: 40 Kurse (inkl. 8 LK-Kurse). Andere Bundesländer weichen teils ab.'),
      field('Halbjahre der Qualifikationsphase', h('input', { type: 'text', value: cfg.halbjahre.join(', '), onchange: (e) => setAbi((a) => { a.halbjahre = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); }) })),
      h('p', { class: 'muted small' }, 'Berechnung nach KMK: Block I = Punktsumme ÷ Kursanzahl (LK doppelt) × 40, max. 600. Block II = Prüfungspunkte × 4, max. 300. Bestanden ab 300 Punkten (mind. 200 in Block I und 100 in Block II, höchstens 8 Unterkurse). Abinote = 17/3 − Punkte/180.'),
      h('button', { class: 'btn ghost small', onclick: () => setAbi((a) => { a.forced = {}; }) }, 'Manuelle Kurswahl zurücksetzen')));
}
