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
  const tokens = untisTokens([group]);
  const own = short ? tokens.filter((t) => lettersMatch(t.letters, short)) : tokens;
  const t = own.at(-1);
  return t ? `${t.letters}${t.number}` : null;
}

/** Alle "Buchstaben+Zahl"-Teile aus Untis-Bezeichnungen: "J1M4" → J1, M4. */
export function untisTokens(labels) {
  const out = [];
  const re = new RegExp(`([${LETTER}]+)(\\d+)\\*?`, 'g');
  for (const label of labels) {
    if (!label) continue;
    let m;
    while ((m = re.exec(String(label)))) out.push({ letters: m[1], number: String(Number(m[2])) });
  }
  return out;
}

/** Gleiche Buchstaben ("M" = "m"), mit prefix auch Abkürzungen ("M" ↔ "MA", "B" ↔ "BIO"). */
function lettersMatch(a, b, { prefix = true } = {}) {
  const x = lettersOf(a).toLowerCase();
  const y = lettersOf(b).toLowerCase();
  if (!x || !y) return false;
  return x === y || (prefix && (x.startsWith(y) || y.startsWith(x)));
}

const isUpper = (code) => { const l = lettersOf(code)[0]; return !!l && l === l.toUpperCase(); };

/** Plan-Termine (Datumsliste) eines Kürzels. */
function datesOf(info, code) {
  return info.days.filter((d) => d.items.some((i) => sameCode(i.code, code, info.caseSensitive))).map((d) => d.date);
}

/**
 * Welches Plan-Kürzel gehört zu einem Fach?
 * Reihenfolge: gespeicherte Wahl → Untis-Bezeichnungen (Kursname, Klassen,
 * Fach, Stundentext) → Klausur-Tage aus Untis → einziges passendes Kürzel.
 * Liefert {code, sure, options, source}.
 */
export function resolvePlanCode(subject, info) {
  const { codes, caseSensitive } = info;
  if (subject.planCode) {
    const hit = codes.find((c) => sameCode(c, subject.planCode, true));
    if (hit || subject.planCode === '-') return { code: hit ?? null, sure: true, options: [], manual: true, source: 'manual' };
  }
  const kindFits = (c) => !caseSensitive || !subject.kind || (subject.kind === 'LK') === isUpper(c);
  const names = [subject.short, ...(subject.aliases ?? [])].filter(Boolean);
  // Exakte Buchstaben haben Vorrang: Bei "Gk" im Plan passt Gemeinschaftskunde nicht auf "G"
  const exact = codes.some((c) => names.some((n) => lettersMatch(c, n, { prefix: false })));
  const subjectFits = (letters) => names.some((n) => lettersMatch(letters, n, { prefix: !exact }));

  // 1. Kursnummer aus Untis: Token mit passenden Buchstaben + Nummer im Plan
  const labels = [subject.group, subject.untisKey, ...(subject.untisLabels ?? [])];
  const tokens = untisTokens(labels).filter((t) => subjectFits(t.letters));
  const fromUntis = [...new Set(tokens.flatMap((t) => {
    // Exakte Buchstaben zuerst: "e2" ist Englisch, nicht Ethik "et2"; "g1" nicht "gg1"
    const withNumber = codes.filter((c) => numberOf(c) === t.number);
    const exactLetters = withNumber.filter((c) => lettersMatch(c, t.letters, { prefix: false }));
    const same = exactLetters.length ? exactLetters : withNumber.filter((c) => lettersMatch(c, t.letters));
    // M2 vs. m2: LK/GK entscheidet; ist die Kursart unbekannt, die Schreibweise aus Untis
    if (!caseSensitive || same.length < 2) return same.filter(kindFits);
    if (subject.kind) return same.filter(kindFits);
    return same.filter((c) => sameCode(c, `${t.letters}${t.number}`, true));
  }))];
  if (fromUntis.length === 1) return { code: fromUntis[0], sure: true, options: fromUntis, source: 'untis' };

  // Plausible Kürzel: gleiche Fach-Buchstaben, passende Schreibweise (LK groß / GK klein)
  let options = codes.filter((c) => subjectFits(c));
  const byKind = options.filter(kindFits);
  if (byKind.length) options = byKind;
  if (fromUntis.length > 1) options = fromUntis;

  // 2. Klausur-Tage, die Untis für den Kurs vermerkt hat, grenzen ein
  const examDates = new Set(subject.untisExamDates ?? []);
  if (examDates.size && options.length > 1) {
    const hits = options.filter((c) => datesOf(info, c).some((d) => examDates.has(d)));
    if (hits.length === 1) return { code: hits[0], sure: true, options: hits, source: 'termine' };
    if (hits.length > 1) options = hits;
  }

  // 3. Eindeutig nur, wenn es genau ein Kürzel ohne Kursnummer gibt (z. B. "BK", "Gk")
  const single = options.length === 1 ? options[0] : null;
  return { code: single && !numberOf(single) ? single : null, sure: !!single && !numberOf(single), options, source: single ? 'eindeutig' : null };
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
