// Klassenarbeits-/Klausurpläne im Kalender-Layout: Monate als Spalten, Tage als
// Zeilen ("12 Mo D2 (4.-7. Std.)"). Kurse stehen als Kürzel im Tageskästchen.
// Viele Schulen unterscheiden dabei Groß-/Kleinschreibung: "M2" = Leistungsfach,
// "m2" = Basisfach – das wird erkannt und berücksichtigt.

import { parsePeriods } from './klausur-parser.js';

const MONTHS = {
  januar: 1, februar: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7,
  august: 8, september: 9, oktober: 10, november: 11, dezember: 12,
};
const DAY_RE = /^(\d{1,2})\.?\s*(Mo|Di|Mi|Do|Fr|Sa|So)\b\.?\s*(.*)$/;
const LETTER = 'A-Za-zÄÖÜäöüß';
// Wörter, die wie Kürzel aussehen, aber keine sind
const STOP = new Set(['std', 'uhr', 'ab', 'bis', 'und', 'von', 'vom', 'zum', 'zur', 'der', 'die', 'das', 'im', 'in', 'am', 'js', 'hj', 'nr']);

function monthOf(text) {
  return MONTHS[String(text).trim().toLowerCase().replace(/\s+\d{4}$/, '')] ?? null;
}

/** Startjahr des Schuljahres aus "Schuljahr 2026/2027" bzw. "2026/27". */
export function schoolYearStart(pages, now = new Date()) {
  for (const page of pages) {
    for (const row of page.rows) {
      const m = row.text.match(/(20\d{2})\s*[/–-]\s*(?:20)?(\d{2})(?!\d)/);
      if (m && (Number(m[2]) === (Number(m[1]) + 1) % 100)) return Number(m[1]);
    }
  }
  return now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

function monthHeader(row) {
  if (!row.xs) return null;
  const cols = [];
  row.cells.forEach((cell, i) => {
    const month = monthOf(cell);
    if (month) cols.push({ month, x: row.xs[i] });
  });
  return cols.length >= 2 ? cols.sort((a, b) => a.x - b.x) : null;
}

function columnOf(cols, x) {
  for (let k = cols.length - 1; k >= 0; k--) if (x >= cols[k].x - 12) return k;
  return 0;
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Kürzel eines Tageseintrags: "Ch1 E1 E3 M4", "b1 d2 (1.–3. Std.) f2",
 * "gk1, gk3 (2.-3. Std.)" (Stunden gelten für die ganze Komma-Gruppe).
 */
export function parseCodes(rest) {
  const items = [];
  const re = new RegExp(`(?<![${LETTER}0-9*])([${LETTER}]{1,30})(\\d{0,2})(\\*?)(?![${LETTER}0-9])\\s*(?:\\(([^)]*)\\))?\\s*(,)?`, 'g');
  let m;
  let chain = [];
  let title = null; // z. B. "Exkursion Inf*" → Termin "Exkursion" statt Klausur
  while ((m = re.exec(rest))) {
    const letters = m[1];
    const isWord = letters.length > 4 && !m[2];
    if (isWord) {
      title = letters;
      chain = [];
      continue;
    }
    if (STOP.has(letters.toLowerCase())) {
      if (letters.toLowerCase() === 'std') title = null; // "Gottesdienst 1. Std." ist abgeschlossen
      chain = [];
      continue;
    }
    const item = {
      code: `${letters}${m[2]}${m[3]}`,
      letters,
      number: m[2] || null,
      title,
      periods: m[4] ? parsePeriods(m[4].includes('Std') ? m[4] : `${m[4]} Std.`) ?? m[4] : null,
    };
    items.push(item);
    // Klammer gilt für das Kürzel davor und eine Komma-Gruppe ("gk1, gk3 (2.-3. Std.)")
    chain.push(item);
    if (item.periods) {
      for (const c of chain) c.periods ??= item.periods;
      chain = [];
    } else if (!m[5]) {
      chain = [];
    }
  }
  return items;
}

/**
 * Liest alle Seiten im Kalender-Layout. Ergebnis: null, wenn kein Kalender
 * erkannt wurde, sonst { days: [{date, rest, items, page}], codes: [...] }.
 */
export function extractCalendar(pages, { now = new Date() } = {}) {
  const startYear = schoolYearStart(pages, now);
  const days = [];
  let found = false;
  for (const page of pages) {
    let cols = null;
    for (const row of page.rows) {
      const header = monthHeader(row);
      if (header) { cols = header; found = true; continue; }
      if (!cols || !row.xs) continue;
      const parts = cols.map(() => []);
      row.cells.forEach((cell, i) => parts[columnOf(cols, row.xs[i])].push(cell));
      cols.forEach((col, k) => {
        const m = parts[k].join(' ').replace(/\s+/g, ' ').trim().match(DAY_RE);
        if (!m) return;
        const day = Number(m[1]);
        const year = col.month >= 8 ? startYear : startYear + 1;
        const d = new Date(Date.UTC(year, col.month - 1, day));
        if (d.getUTCMonth() !== col.month - 1) return;
        const rest = m[3].trim();
        if (rest) days.push({ date: iso(year, col.month, day), rest, items: parseCodes(rest), page: page.page });
      });
    }
  }
  if (!found) return null;
  const codes = [...new Set(days.flatMap((d) => d.items.map((i) => normCode(i.code))))].sort((a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'case' }));
  return { startYear, days, codes, caseSensitive: caseSignificant(codes) };
}

export const normCode = (code) => String(code ?? '').replace(/\*/g, '').trim();

/** Kommen dieselben Kürzel groß und klein vor (M2 / m2)? Dann zählt die Schreibweise. */
export function caseSignificant(codes) {
  const seen = new Map();
  for (const c of codes) {
    const key = c.toLowerCase();
    if (seen.has(key) && seen.get(key) !== c) return true;
    seen.set(key, c);
  }
  return false;
}

const lettersOf = (code) => (normCode(code).match(new RegExp(`^[${LETTER}]+`)) ?? [''])[0];
const numberOf = (code) => (normCode(code).match(/(\d+)$/) ?? [null, null])[1];
const sameCode = (a, b, caseSensitive) => (caseSensitive ? normCode(a) === normCode(b) : normCode(a).toLowerCase() === normCode(b).toLowerCase());

/**
 * Kurskürzel aus der Untis-Schülergruppe, z. B. "M4" oder "J1_m2" → "m2".
 * Nur wenn die Buchstaben zum Fach passen ("D-G2" ist kein Geschichtskurs).
 */
export function untisCode(group, short = null) {
  const last = String(group ?? '').split(/[\s_\-/.]+/).filter(Boolean).at(-1) ?? '';
  const m = last.match(new RegExp(`^([${LETTER}]+)(\\d+)\\*?$`));
  if (!m) return null;
  if (short && m[1].toLowerCase() !== lettersOf(short).toLowerCase()) return null;
  return `${m[1]}${m[2]}`;
}

/**
 * Welches Plan-Kürzel gehört zu einem Fach?
 * Liefert {code, sure, options}: `options` = plausible Kürzel (gleiche Buchstaben),
 * `code` nur, wenn eindeutig (gespeichert, aus Untis-Kurs oder einzig passendes).
 */
export function resolvePlanCode(subject, info) {
  const { codes, caseSensitive } = info;
  if (subject.planCode) {
    const hit = codes.find((c) => sameCode(c, subject.planCode, true));
    if (hit || subject.planCode === '-') return { code: hit ?? null, sure: true, options: [], manual: true };
  }
  const fromUntis = untisCode(subject.group ?? subject.untisKey, subject.short);
  if (fromUntis) {
    const hit = codes.find((c) => sameCode(c, fromUntis, caseSensitive));
    if (hit) return { code: hit, sure: true, options: [hit] };
  }
  const wanted = new Set([subject.short, ...(subject.aliases ?? []), lettersOf(fromUntis)].filter(Boolean).map((x) => lettersOf(x).toLowerCase()).filter(Boolean));
  let options = codes.filter((c) => wanted.has(lettersOf(c).toLowerCase()));
  // Nur Abkürzungen: "B" passt zu "BIO", "Inf" zu "INF"
  if (!options.length) {
    options = codes.filter((c) => [...wanted].some((w) => w.length > 1 && (w.startsWith(lettersOf(c).toLowerCase()) || lettersOf(c).toLowerCase().startsWith(w))));
  }
  // Groß = Leistungsfach (LK), klein = Basisfach (GK), wenn der Plan das unterscheidet
  if (caseSensitive && subject.kind) {
    const byCase = options.filter((c) => {
      const upper = lettersOf(c)[0] === lettersOf(c)[0].toUpperCase();
      return subject.kind === 'LK' ? upper : !upper;
    });
    if (byCase.length) options = byCase;
  }
  // Eindeutig nur, wenn es genau ein Kürzel ohne Kursnummer gibt (z. B. "BK", "Gk")
  const single = options.length === 1 ? options[0] : null;
  return { code: single, sure: !!single && !numberOf(single), options };
}

/** Termine für die Fächer: [{candidate, subjectId, score, sure}] wie matchCandidates. */
export function matchCalendar(info, subjects, codeFor = (s) => resolvePlanCode(s, info).code) {
  const results = [];
  for (const s of subjects) {
    const code = codeFor(s);
    if (!code) continue;
    for (const day of info.days) {
      const item = day.items.find((i) => sameCode(i.code, code, info.caseSensitive));
      if (!item) continue;
      results.push({
        candidate: { date: day.date, text: day.rest, cells: [day.rest], periods: item.periods, page: day.page, code: normCode(item.code), title: item.title },
        subjectId: s.id,
        score: 3,
        sure: !item.title, // Exkursion o. ä. anzeigen, aber nicht vorab auswählen
        label: normCode(item.code),
      });
    }
  }
  return results.sort((a, b) => a.candidate.date.localeCompare(b.candidate.date));
}
