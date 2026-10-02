// Aufbereitung der Untis-Rohdaten + LK/GK-Erkennung anhand der Wochenstunden.

export const DEFAULT_LK_THRESHOLD = 4; // ab so vielen Wochenstunden gilt ein Kurs als LK
const SCHOOL_HOUR_MINUTES = 45;

function untisTime(t) {
  const s = String(t).padStart(4, '0');
  return `${s.slice(0, 2)}:${s.slice(2)}`;
}

function untisDate(d) {
  const s = String(d);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

export function minutesOf(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function mondayKey(isoDate) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export function addDaysIso(isoDate, n) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayIso(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function resolveNames(list, lookup) {
  return (list ?? []).map((el) => {
    const found = lookup?.find((x) => x.id === el.id);
    return {
      id: el.id,
      name: el.name ?? found?.name ?? (el.id ? `#${el.id}` : ''),
      longname: el.longname ?? found?.longName ?? found?.longname ?? '',
      orgname: el.orgname ?? null,
    };
  });
}

/** Kurs-Schlüssel: Schülergruppe (z. B. "M-L1"), sonst Fachkürzel. */
export function courseKeyOf(lesson) {
  return lesson.group || lesson.subject?.short || lesson.info || 'Unbekannt';
}

/** Untis-Rohdaten → flache, sortierte Stundenliste. */
export function normalizeTimetable(raw) {
  const lookups = raw.lookups ?? {};
  const lessons = (raw.periods ?? []).map((p) => {
    const subjects = resolveNames(p.su, lookups.subjects);
    const teachers = resolveNames(p.te, lookups.teachers);
    const rooms = resolveNames(p.ro, lookups.rooms);
    const classes = resolveNames(p.kl, lookups.klassen);
    const subject = subjects[0] ?? null;
    let status = 'regular';
    if (p.code === 'cancelled') status = 'cancelled';
    else if (p.code === 'irregular') status = 'irregular';
    if (p.activityType && p.activityType !== 'Unterricht' && status === 'regular' && !subject) status = 'event';
    const lesson = {
      id: p.id,
      date: untisDate(p.date),
      start: untisTime(p.startTime),
      end: untisTime(p.endTime),
      subject: subject ? { short: subject.name, long: subject.longname || subject.name } : null,
      group: p.sg || null,
      teachers: teachers.map((t) => t.name).filter(Boolean),
      teacherChanged: teachers.some((t) => t.orgname),
      rooms: rooms.map((r) => r.name).filter(Boolean),
      roomChanged: rooms.some((r) => r.orgname),
      classes: classes.map((c) => c.name).filter(Boolean),
      status,
      info: [p.lstext, p.info].filter(Boolean).join(' · ') || null,
      substText: p.substText || null,
      lessonNumber: p.lsnumber ?? null,
    };
    lesson.courseKey = courseKeyOf(lesson);
    return lesson;
  });
  lessons.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));

  const timegrid = normalizeTimegrid(raw.timegrid, lessons);
  return {
    fetchedAt: raw.fetchedAt,
    server: raw.server,
    school: raw.school,
    range: raw.range,
    timegrid,
    lessons,
    warnings: raw.warnings ?? [],
  };
}

/** Stundenraster aus Untis; fällt auf die tatsächlich vorkommenden Startzeiten zurück. */
export function normalizeTimegrid(rawGrid, lessons = []) {
  const units = new Map();
  for (const day of rawGrid ?? []) {
    for (const u of day.timeUnits ?? []) {
      const start = untisTime(u.startTime);
      if (!units.has(start)) units.set(start, { name: String(u.name ?? ''), start, end: untisTime(u.endTime) });
    }
  }
  if (!units.size) {
    for (const l of lessons) {
      if (!units.has(l.start)) units.set(l.start, { name: '', start: l.start, end: l.end });
    }
  }
  const list = [...units.values()].sort((a, b) => a.start.localeCompare(b.start));
  list.forEach((u, i) => { if (!u.name) u.name = String(i + 1); });
  return list;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Ermittelt alle Kurse und ihre Wochenstunden. Gezählt wird der reguläre Plan
 * (auch ausgefallene Stunden, aber keine Vertretungs-/Sonderstunden). Pro Kurs
 * wird der Median über "volle" Schulwochen genommen, damit Ferien, Feiertage
 * und einzelne Zusatzstunden das Ergebnis nicht verfälschen.
 * Kurse mit ≥ threshold Wochenstunden (Standard 4; LK = 5, GK = 3) sind LKs.
 */
export function detectCourses(lessons, { threshold = DEFAULT_LK_THRESHOLD } = {}) {
  const courses = new Map();
  const weekTotals = new Map();
  const plannedLessons = lessons.filter((l) => l.status !== 'irregular' && l.status !== 'event');
  const source = plannedLessons.length ? plannedLessons : lessons;

  for (const l of source) {
    if (!l.subject && !l.group) continue;
    const key = l.courseKey ?? courseKeyOf(l);
    const week = mondayKey(l.date);
    const units = (minutesOf(l.end) - minutesOf(l.start)) / SCHOOL_HOUR_MINUTES;
    weekTotals.set(week, (weekTotals.get(week) ?? 0) + units);
    if (!courses.has(key)) {
      courses.set(key, {
        key,
        short: l.subject?.short ?? key,
        long: l.subject?.long ?? key,
        group: l.group,
        teachers: new Set(),
        rooms: new Set(),
        weeks: new Map(),
      });
    }
    const c = courses.get(key);
    l.teachers.forEach((t) => c.teachers.add(t));
    l.rooms.forEach((r) => c.rooms.add(r));
    c.weeks.set(week, (c.weeks.get(week) ?? 0) + units);
  }

  // Volle Wochen: mindestens 70 % der Stunden der stärksten Woche.
  const maxWeek = Math.max(0, ...weekTotals.values());
  let fullWeeks = [...weekTotals.entries()].filter(([, t]) => t >= maxWeek * 0.7).map(([w]) => w);
  if (!fullWeeks.length) fullWeeks = [...weekTotals.keys()];

  const result = [];
  for (const c of courses.values()) {
    const perWeek = fullWeeks.map((w) => c.weeks.get(w) ?? 0);
    // Kurse, die nur in manchen Wochen stattfinden (A/B-Wochen), über alle Wochen mitteln.
    const nonZero = perWeek.filter((x) => x > 0);
    const raw = nonZero.length === perWeek.length ? median(perWeek) : perWeek.reduce((a, b) => a + b, 0) / perWeek.length;
    const hours = Math.round(raw * 2) / 2;
    result.push({
      key: c.key,
      short: c.short,
      long: c.long,
      group: c.group,
      teachers: [...c.teachers],
      rooms: [...c.rooms],
      hours,
      kind: hours >= threshold ? 'LK' : 'GK',
    });
  }
  result.sort((a, b) => (a.kind === b.kind ? b.hours - a.hours || a.long.localeCompare(b.long) : a.kind === 'LK' ? -1 : 1));
  return result;
}

export function lessonsOnDate(lessons, isoDate) {
  return lessons.filter((l) => l.date === isoDate);
}

/** Stunden einer Woche, gruppiert nach Wochentag (0 = Montag). */
export function weekMatrix(lessons, monday) {
  const days = [0, 1, 2, 3, 4].map((i) => ({ date: addDaysIso(monday, i), lessons: [] }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const l of lessons) byDate.get(l.date)?.lessons.push(l);
  return days;
}

/** Welche Rasterzeile(n) belegt eine Stunde? (Doppelstunden über mehrere Zeilen) */
export function slotSpan(lesson, grid) {
  const s = minutesOf(lesson.start);
  const e = minutesOf(lesson.end);
  let first = -1;
  let last = -1;
  grid.forEach((u, i) => {
    const us = minutesOf(u.start);
    const ue = minutesOf(u.end);
    if (us < e && ue > s) {
      if (first === -1) first = i;
      last = i;
    }
  });
  if (first === -1) {
    // Nicht im Raster: nächstgelegene Zeile.
    let best = 0;
    grid.forEach((u, i) => { if (Math.abs(minutesOf(u.start) - s) < Math.abs(minutesOf(grid[best].start) - s)) best = i; });
    first = best;
    last = best;
  }
  return { first, last };
}
