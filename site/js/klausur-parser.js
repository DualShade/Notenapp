// Klausurplan-Parser: erkennt in PDF-Zeilen Datumsangaben und ordnet die
// Termine den eigenen Kursen (aus Untis bzw. den Fächern) zu.

const MONTHS = {
  januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, mrz: 3, april: 4, apr: 4, mai: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};

const LETTER = 'A-Za-zÄÖÜäöüß';

function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Jahr ohne Angabe aus dem Schuljahr ableiten (Aug–Dez = erstes Jahr, Jan–Jul = zweites). */
export function inferYear(month, now = new Date()) {
  const startYear = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  return month >= 8 ? startYear : startYear + 1;
}

/** Erstes gültiges Datum in einem Text als ISO-String, sonst null. */
export function parseDate(text, now = new Date()) {
  const numeric = new RegExp(`(?<![0-9.])(\\d{1,2})\\.\\s?(\\d{1,2})\\.(?:\\s?(\\d{4}|\\d{2})(?![0-9]))?`, 'g');
  const named = new RegExp(`(?<![0-9])(\\d{1,2})\\.?\\s*(${Object.keys(MONTHS).join('|')})\\.?(?![${LETTER}])(?:\\s*(\\d{4}))?`, 'gi');
  const found = [];
  let m;
  while ((m = numeric.exec(text))) {
    // "3./4. Std." o. ä. ist keine Datumsangabe
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 6);
    if (!m[3] && /^\s*(std|stunde)/i.test(after)) continue;
    found.push({ index: m.index, d: +m[1], m: +m[2], y: m[3] ? +m[3] : null });
  }
  while ((m = named.exec(text))) {
    found.push({ index: m.index, d: +m[1], m: MONTHS[m[2].toLowerCase()], y: m[3] ? +m[3] : null });
  }
  found.sort((a, b) => a.index - b.index);
  for (const f of found) {
    if (f.m < 1 || f.m > 12 || f.d < 1 || f.d > 31) continue;
    let y = f.y ?? inferYear(f.m, now);
    if (y < 100) y += 2000;
    const date = new Date(Date.UTC(y, f.m - 1, f.d));
    if (date.getUTCMonth() !== f.m - 1) continue;
    return iso(y, f.m, f.d);
  }
  return null;
}

/** Stundenangabe wie "3.-4. Std." oder "Std. 1–3" herauslösen. */
export function parsePeriods(text) {
  const a = text.match(/(\d{1,2})\s*\.?\s*(?:[-–/]|bis)\s*(\d{1,2})\s*\.?\s*(?:Std|Stunde)/i);
  if (a) return `${a[1]}.–${a[2]}. Std.`;
  const b = text.match(/(?:Std\.?|Stunden?)\s*(\d{1,2})\s*\.?\s*(?:[-–/]|bis)\s*(\d{1,2})/i);
  if (b) return `${b[1]}.–${b[2]}. Std.`;
  const c = text.match(/(\d{1,2})\s*\.\s*(?:Std|Stunde)/i);
  if (c) return `${c[1]}. Std.`;
  const t = text.match(/(\d{1,2}[:.]\d{2})\s*(?:[-–]|bis)\s*(\d{1,2}[:.]\d{2})\s*(?:Uhr)?/i);
  if (t) return `${t[1].replace('.', ':')}–${t[2].replace('.', ':')} Uhr`;
  return null;
}

function stripDates(text) {
  return text
    .replace(/(?<![0-9.])\d{1,2}\.\s?\d{1,2}\.(\s?\d{2,4})?/g, ' ')
    .replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So|Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag)\b\.?,?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verbundene Tabellenzellen: Ein Datum, das über mehrere Zeilen geht, steht
 * vertikal zentriert in einer eigenen Textzeile – oft *zwischen* seinen Zeilen.
 * Gehört die Zeile ohne Datum dazu (Datum steht weiter links, keine volle
 * Datumszeile dazwischen), wird das vertikal nächste solche Datum genommen.
 */
function mergedCellDate(rows, i) {
  const me = rows[i].row;
  if (me.x == null || me.y == null) return null;
  let best = null;
  for (const dir of [-1, 1]) {
    for (let j = i + dir; j >= 0 && j < rows.length; j += dir) {
      const r = rows[j];
      if (r.date && !r.dateOnly) break; // nächste vollständige Datumszeile = Blockgrenze
      if (r.dateOnly && r.row.x != null && r.row.x < me.x - 5) {
        const dist = Math.abs(r.row.y - me.y);
        if (!best || dist < best.dist) best = { dist, date: r.date };
        break;
      }
    }
  }
  return best?.date ?? null;
}

/**
 * Aus Seiten/Zeilen alle Zeilen mit Datum (auch geerbt aus verbundenen
 * Tabellenzellen darüber) als Klausur-Kandidaten liefern.
 */
export function extractCandidates(pages, { now = new Date(), stufe = '' } = {}) {
  let usePages = pages;
  if (stufe) {
    const needle = stufe.toLowerCase();
    const filtered = pages.filter((p) => p.rows.some((r) => r.text.toLowerCase().includes(needle)));
    if (filtered.length) usePages = filtered;
  }
  const candidates = [];
  for (const page of usePages) {
    const rows = page.rows.map((row) => {
      const date = parseDate(row.text, now);
      const rest = stripDates(row.text.replace(/\|/g, ' '));
      const hasContent = rest.replace(/[^A-Za-zÄÖÜäöü]/g, '').length >= 1;
      return { row, date, hasContent, dateOnly: !!date && !hasContent };
    });
    let lastDate = null;
    rows.forEach((r, i) => {
      if (r.date) lastDate = r.date;
      if (!r.hasContent) return; // reine Datums- oder Leerzeilen
      if (!r.date && /\b(Datum|Termin|Tag)\b/i.test(r.row.text)) return; // Tabellenkopf
      const effective = r.date ?? mergedCellDate(rows, i) ?? lastDate;
      if (!effective) return;
      candidates.push({
        date: effective,
        inherited: !r.date,
        page: page.page,
        text: r.row.text,
        cells: r.row.cells,
        periods: parsePeriods(r.row.text),
      });
    });
  }
  return candidates;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Flexibler Regex für Kurskennungen: "M-L1" passt auch auf "M L1", "m_l1", "ML1". */
function groupRegex(group) {
  const chunks = group.split(/[^0-9A-Za-zÄÖÜäöüß]+/).filter(Boolean);
  if (!chunks.length) return null;
  const body = chunks.map(escapeRe).join('[\\s\\-_/.]*');
  return new RegExp(`(?<![${LETTER}0-9])${body}(?![0-9])`, 'i');
}

function qualifierAfter(text, endIndex) {
  const m = text.slice(endIndex).match(/^[\s\-_/.]*(LK|GK|L|G|eA|gA)\s*(\d)?(?![A-Za-z])/i);
  if (!m) return null;
  const kindRaw = m[1].toUpperCase();
  const kind = kindRaw.startsWith('L') || kindRaw === 'EA' ? 'LK' : 'GK';
  return { kind, number: m[2] ?? null };
}

function groupNumber(group) {
  const m = group?.match(/(\d+)\s*$/);
  return m ? m[1] : null;
}

/** Matcher für ein Fach: Kursname (stark), Langname/Aliasse (mittel), Kürzel (schwach). */
export function subjectMatchers(subject) {
  const out = [];
  if (subject.group) {
    const re = groupRegex(subject.group);
    if (re) out.push({ re, score: 3, label: subject.group, exact: true });
  }
  const words = new Set();
  for (const name of [subject.name, ...(subject.aliases ?? [])]) {
    if (!name) continue;
    const n = name.trim();
    if (n.length >= 3) words.add(n);
    const first = n.split(/\s+/)[0];
    if (first.length >= 4) words.add(first);
  }
  for (const w of words) {
    out.push({ re: new RegExp(`(?<![${LETTER}])${escapeRe(w)}(?![${LETTER}])`, 'i'), score: 2, label: w });
  }
  const short = subject.short?.trim();
  if (short && !words.has(short)) {
    // Kürzel case-sensitiv, damit "M" nicht auf "Mit" o. ä. passt
    out.push({ re: new RegExp(`(?<![${LETTER}0-9])${escapeRe(short)}(?![a-zäöüß])`), score: 1, label: short });
  }
  return out;
}

/** Bewertet, ob eine Zeile zu einem Fach gehört. Liefert {score, label} oder null. */
export function matchSubject(text, subject) {
  let best = null;
  const ownNumber = groupNumber(subject.group);
  for (const m of subjectMatchers(subject)) {
    const re = new RegExp(m.re.source, m.re.flags.includes('g') ? m.re.flags : `${m.re.flags}g`);
    let hit;
    while ((hit = re.exec(text))) {
      let score = m.score;
      if (!m.exact) {
        const q = qualifierAfter(text, hit.index + hit[0].length);
        if (q) {
          if (subject.kind && q.kind !== subject.kind) continue; // anderer Kurstyp
          if (q.number && ownNumber && q.number !== ownNumber) continue; // anderer Kurs
          score += 1;
        }
      }
      if (!best || score > best.score) best = { score, label: m.label };
      if (hit[0].length === 0) re.lastIndex++;
    }
  }
  return best;
}

/**
 * Ordnet Kandidaten Fächern zu. Ergebnis: Liste {candidate, subjectId, score, sure}.
 * Zeilen ohne Treffer kommen mit subjectId = null zurück.
 */
export function matchCandidates(candidates, subjects) {
  const results = [];
  for (const c of candidates) {
    const hits = [];
    for (const s of subjects) {
      const hit = matchSubject(c.text, s);
      if (hit) hits.push({ subjectId: s.id, score: hit.score, label: hit.label });
    }
    if (!hits.length) {
      results.push({ candidate: c, subjectId: null, score: 0, sure: false });
      continue;
    }
    hits.sort((a, b) => b.score - a.score);
    // Mehrere Fächer in einer Zeile (z. B. alle Kurse eines Tages) sind erlaubt.
    for (const h of hits) {
      results.push({ candidate: c, subjectId: h.subjectId, score: h.score, label: h.label, sure: h.score >= 2 });
    }
  }
  return dedupe(results);
}

function dedupe(results) {
  const seen = new Map();
  for (const r of results) {
    const key = `${r.candidate.date}|${r.subjectId ?? r.candidate.text}`;
    const prev = seen.get(key);
    if (!prev || r.score > prev.score) seen.set(key, r);
  }
  return [...seen.values()].sort((a, b) => a.candidate.date.localeCompare(b.candidate.date));
}

export function klausurKey(date, subjectId) {
  return `${date}|${subjectId}`;
}
