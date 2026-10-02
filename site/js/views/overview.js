import { h, icon, formatDateTime, formatDate } from '../ui.js';
import { getState, kindOf } from '../store.js';
import { overallAverage, formatPoints } from '../grades.js';
import { todayIso, lessonsOnDate } from '../timetable.js';
import { currentTimetable, pendingServerProposals, server, subjectForLesson } from '../data.js';
import { activeSubjects, averageFor, averageBlock, colorDot, pointsPill, kindBadge, klausurRow, openGradeEditor, openSubjectEditor } from './common.js';
import { openKlausurImport } from './klausuren.js';
import { loadDemo } from '../demo.js';
import { openUntisConnect } from './untis-connect.js';
import { openHomeworkEditor, homeworkRow, openHomework } from './homework.js';

function nextSchoolDay(timetable, today) {
  if (!timetable) return null;
  const dates = [...new Set(timetable.lessons.map((l) => l.date))].filter((d) => d >= today).sort();
  return dates[0] ?? null;
}

function dayCard(timetable, today) {
  const date = nextSchoolDay(timetable, today);
  if (!date) return null;
  const lessons = lessonsOnDate(timetable.lessons, date);
  const label = date === today ? 'Heute' : formatDate(date, { weekday: 'long', day: '2-digit', month: '2-digit' });
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { class: 'card-title' }, `Stundenplan · ${label}`),
      h('a', { class: 'link', href: '#/plan' }, 'Woche')),
    h('div', { class: 'list compact' }, lessons.map((l) => {
      const subject = subjectForLesson(l);
      return h('div', { class: `list-item lesson-row ${l.status}` },
        h('span', { class: 'time' }, l.start, h('br'), l.end),
        h('span', { class: 'bar', style: { background: subject?.color ?? 'var(--muted)' } }),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, subject?.name ?? l.subject?.long ?? l.courseKey, ' ', subject ? kindBadge(subject) : null),
          h('div', { class: 'sub' }, [l.rooms.join(', '), l.teachers.join(', '), l.substText, l.info].filter(Boolean).join(' · '))),
        l.status === 'cancelled' ? h('span', { class: 'tag danger' }, 'Entfällt') : null,
        l.status === 'irregular' ? h('span', { class: 'tag warn' }, 'Vertretung') : null);
    })));
}

export function overviewView() {
  const state = getState();
  const today = todayIso();
  const subjects = activeSubjects();
  const timetable = currentTimetable();
  const averages = subjects.map((s) => ({ subject: s, ...averageFor(s), kind: kindOf(s) }));
  const overall = overallAverage(averages, { lkDouble: state.settings.lkDouble });
  const lk = overallAverage(averages.filter((a) => a.kind === 'LK'));
  const gk = overallAverage(averages.filter((a) => a.kind === 'GK'));
  const upcoming = state.klausuren.filter((k) => k.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
  const proposals = state.settings.autoImportKlausuren ? [] : pendingServerProposals();

  if (!subjects.length && !timetable) {
    return h('div', { class: 'view' },
      h('section', { class: 'card hero welcome' },
        h('h2', {}, 'Willkommen in deiner Notenapp 👋'),
        h('p', {}, 'Dein Stundenplan kommt automatisch aus WebUntis: Kurse mit 5 Wochenstunden werden als LK erkannt, alle anderen als GK. Klausurtermine kannst du aus dem PDF-Klausurplan deiner Schul-Homepage übernehmen.'),
        h('p', { class: 'muted small' }, 'Such einfach deine Schule und melde dich mit deinem Untis-Benutzernamen und Passwort an.'),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn primary', onclick: openUntisConnect }, icon('link', 18), 'Mit Untis verbinden'),
          h('button', { class: 'btn ghost', onclick: () => openSubjectEditor() }, icon('plus', 18), 'Fach manuell anlegen'),
          h('button', { class: 'btn ghost', onclick: loadDemo }, 'Demo ansehen'))));
  }

  return h('div', { class: 'view' },
    proposals.length ? h('button', { class: 'banner', onclick: () => openKlausurImport('server') },
      icon('file', 20),
      h('div', { class: 'grow' },
        h('strong', {}, `${proposals.length} neue${proposals.length === 1 ? 'r' : ''} Klausurtermin${proposals.length === 1 ? '' : 'e'} im Klausurplan`),
        h('div', { class: 'sub' }, 'Aus der PDF deiner Schul-Homepage – tippen zum Prüfen & Übernehmen')),
      icon('chevron', 18)) : null,
    h('section', { class: 'card hero' },
      averageBlock(overall, `Gesamtschnitt ${state.settings.halbjahr}`),
      h('div', { class: 'stats' },
        h('div', {}, h('span', { class: 'muted' }, 'LKs'), h('strong', {}, formatPoints(lk))),
        h('div', {}, h('span', { class: 'muted' }, 'GKs'), h('strong', {}, formatPoints(gk))),
        h('div', {}, h('span', { class: 'muted' }, 'Noten'), h('strong', {}, String(averages.reduce((a, b) => a + b.count, 0)))))),
    h('div', { class: 'grid-2' },
      h('button', { class: 'btn primary', onclick: () => openGradeEditor(null) }, icon('plus', 18), 'Note'),
      h('button', { class: 'btn', onclick: () => openHomeworkEditor() }, icon('plus', 18), 'Hausaufgabe')),
    dayCard(timetable, today),
    homeworkCard(today),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, 'Nächste Klausuren'),
        h('a', { class: 'link', href: '#/klausuren' }, 'Alle')),
      upcoming.length ? h('div', { class: 'list' }, upcoming.map((k) => klausurRow(k, today))) : h('p', { class: 'muted small' }, 'Keine anstehenden Termine.')),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, 'Fächer'),
        h('a', { class: 'link', href: '#/faecher' }, 'Details')),
      h('div', { class: 'list compact' }, averages.map((a) => h('a', { class: 'list-item', href: `#/fach/${a.subject.id}` },
        colorDot(a.subject),
        h('div', { class: 'grow title' }, a.subject.name, ' ', kindBadge(a.subject)),
        pointsPill(a.average))))),
    h('p', { class: 'muted small center' },
      timetable ? `Stundenplan: ${formatDateTime(timetable.fetchedAt)} (${timetable.origin === 'live' ? 'Live-Import' : 'automatisch'})` : 'Kein Stundenplan geladen',
      server.klausuren ? ` · Klausurplan: ${formatDateTime(server.klausuren.fetchedAt)}` : ''));
}

function homeworkCard(today) {
  const open = openHomework();
  if (!open.length) return null;
  const overdue = open.filter((x) => x.due < today).length;
  return h('section', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h3', { class: 'card-title' }, `Hausaufgaben (${open.length})`, overdue ? h('span', { class: 'tag danger' }, `${overdue} überfällig`) : null),
      h('a', { class: 'link', href: '#/aufgaben/hausaufgaben' }, 'Alle')),
    h('div', { class: 'list' }, open.slice(0, 4).map((x) => homeworkRow(x, today))));
}
