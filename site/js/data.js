// Datenquellen: von der GitHub Action erzeugte JSON-Dateien, optionaler
// CORS-Proxy für Live-Abrufe und PDF-Verarbeitung im Browser.

import { getState, update, uid, kindOf, nextColor } from './store.js';
import { normalizeTimetable, detectCourses, todayIso } from './timetable.js';
import { extractPdfRows } from './pdf-text.js';
import { extractCandidates, matchCandidates, klausurKey } from './klausur-parser.js';
import { findPdfLink } from './link-finder.js';

export const server = {
  timetable: null,
  klausuren: null,
  status: null,
  loaded: false,
};

async function getJson(path) {
  try {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Lädt die aktuellsten Daten der GitHub Action (immer frisch, kein Cache). */
export async function loadServerData() {
  const [timetable, klausuren, status] = await Promise.all([
    getJson('data/timetable.json'),
    getJson('data/klausuren.json'),
    getJson('data/status.json'),
  ]);
  Object.assign(server, { timetable, klausuren, status, loaded: true });
  return server;
}

/** Neuester verfügbarer Stundenplan: Action-Daten oder eigener Live-Import. */
export function currentTimetable() {
  const local = getState().localTimetable;
  const remote = server.timetable;
  if (local && (!remote || local.fetchedAt > remote.fetchedAt)) return { ...local, origin: 'live' };
  if (remote) return { ...remote, origin: 'action' };
  return null;
}

export function currentCourses() {
  const tt = currentTimetable();
  if (!tt) return [];
  return detectCourses(tt.lessons, { threshold: getState().settings.lkThreshold });
}

/** Legt für alle Untis-Kurse Fächer an bzw. aktualisiert Stundenzahl & LK/GK. */
export function syncSubjectsWithTimetable() {
  const courses = currentCourses();
  if (!courses.length) return 0;
  let created = 0;
  update((s) => {
    for (const c of courses) {
      let subject = s.subjects.find((x) => x.untisKey === c.key);
      if (!subject) {
        if (!s.settings.autoSubjects) continue;
        // Gleichnamiges manuell angelegtes Fach übernehmen statt doppelt anzulegen
        subject = s.subjects.find((x) => !x.untisKey && (x.short === c.short || x.name === c.long));
        if (!subject) {
          subject = { id: uid(), name: c.long, short: c.short, color: nextColor(s.subjects), aliases: [], createdAt: Date.now() };
          s.subjects.push(subject);
          created++;
        }
        subject.untisKey = c.key;
      }
      subject.group = c.group ?? subject.group ?? null;
      subject.hours = c.hours;
      subject.kindAuto = c.kind;
      subject.teachers = c.teachers;
      if (!subject.short) subject.short = c.short;
    }
  }, { silent: true });
  return created;
}

export function subjectForLesson(lesson) {
  return getState().subjects.find((s) => s.untisKey && s.untisKey === lesson.courseKey) ?? null;
}

// ---------- Proxy (optional, für Live-Abrufe direkt aus der App) ----------

function proxyBase() {
  const url = getState().settings.proxyUrl?.trim();
  return url ? url.replace(/\/$/, '') : null;
}

export function hasProxy() {
  return !!proxyBase();
}

/** Holt eine fremde URL – erst direkt, dann über den Proxy (CORS). */
export async function fetchExternal(url, as = 'text') {
  const tryRead = async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return as === 'buffer' ? res.arrayBuffer() : res.text();
  };
  try {
    return await tryRead(await fetch(url));
  } catch (direct) {
    const base = proxyBase();
    if (!base) {
      throw new Error('Die Seite erlaubt keinen direkten Abruf aus dem Browser (CORS). Trage in den Einstellungen einen Proxy ein oder nutze die GitHub Action.');
    }
    return tryRead(await fetch(`${base}/fetch?url=${encodeURIComponent(url)}`));
  }
}

/** Live-Abruf des Stundenplans über den Proxy (Zugangsdaten bleiben im Browser). */
export async function liveUntisImport() {
  const base = proxyBase();
  if (!base) throw new Error('Kein Proxy konfiguriert.');
  const { untis } = getState().settings;
  const res = await fetch(`${base}/untis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...untis, weeksBack: 1, weeksAhead: 5 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Proxy antwortet mit HTTP ${res.status}`);
  const timetable = normalizeTimetable(data);
  update((s) => { s.localTimetable = timetable; }, { silent: true });
  const created = syncSubjectsWithTimetable();
  update(() => {});
  return { timetable, created };
}

// ---------- Klausurplan-PDF ----------

let pdfjsPromise;
async function pdfjs() {
  if (!pdfjsPromise) {
    const base = new URL('vendor/pdfjs/', document.baseURI).href;
    pdfjsPromise = import(`${base}pdf.min.mjs`).then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function pdfToPages(buffer) {
  return extractPdfRows(await pdfjs(), buffer);
}

/** Aktuellen Klausurplan live von der Homepage holen (direkt oder per Proxy). */
export async function liveKlausurPages() {
  const src = getState().settings.klausurSource;
  let pdfUrl = src.pdfUrl?.trim();
  if (!pdfUrl) {
    if (!src.pageUrl) throw new Error('Keine Homepage oder PDF-URL in den Einstellungen hinterlegt.');
    const html = await fetchExternal(src.pageUrl, 'text');
    const link = findPdfLink(html, src.pageUrl, src.linkPattern);
    if (!link) throw new Error(`Kein PDF-Link mit „${src.linkPattern}“ auf der Seite gefunden.`);
    pdfUrl = link.url;
  }
  const buffer = await fetchExternal(pdfUrl, 'buffer');
  return { pages: await pdfToPages(buffer), pdfUrl, fetchedAt: new Date().toISOString() };
}

/** Vorschläge (Datum + Fach) aus PDF-Seiten, ohne bereits importierte/ignorierte. */
export function klausurProposals(pages, { stufe, includePast = false } = {}) {
  const state = getState();
  const subjects = state.subjects.filter((s) => !s.archived).map((s) => ({ ...s, kind: kindOf(s) }));
  const candidates = extractCandidates(pages, { stufe: stufe ?? state.settings.klausurSource.stufe });
  const today = todayIso();
  const existing = new Set(state.klausuren.filter((k) => k.subjectId).map((k) => klausurKey(k.date, k.subjectId)));
  const ignored = new Set(state.ignoredKlausurKeys);
  return matchCandidates(candidates, subjects)
    .filter((r) => includePast || r.candidate.date >= today)
    .map((r) => ({ ...r, key: r.subjectId ? klausurKey(r.candidate.date, r.subjectId) : null }))
    .filter((r) => !r.key || (!existing.has(r.key) && !ignored.has(r.key)));
}

export function importKlausuren(items, { source = 'pdf', sourceUrl = null } = {}) {
  update((s) => {
    for (const it of items) {
      const key = klausurKey(it.date, it.subjectId);
      if (s.klausuren.some((k) => k.subjectId && klausurKey(k.date, k.subjectId) === key)) continue;
      s.klausuren.push({
        id: uid(),
        subjectId: it.subjectId,
        date: it.date,
        title: it.title ?? 'Klausur',
        info: it.info ?? null,
        raw: it.raw ?? null,
        source,
        sourceUrl,
        halbjahr: s.settings.halbjahr,
      });
    }
  });
}

export function ignoreProposals(keys) {
  update((s) => {
    s.ignoredKlausurKeys = [...new Set([...s.ignoredKlausurKeys, ...keys])];
  });
}

/** Neue, sicher zugeordnete Termine aus dem Action-Klausurplan. */
export function pendingServerProposals() {
  if (!server.klausuren?.pages) return [];
  return klausurProposals(server.klausuren.pages, { stufe: server.klausuren.stufe ?? undefined })
    .filter((r) => r.subjectId && r.sure);
}

export function proposalToItem(r) {
  return {
    subjectId: r.subjectId,
    date: r.candidate.date,
    info: r.candidate.periods ?? null,
    raw: r.candidate.text,
  };
}

/** Beim Start: neue Klausurtermine automatisch übernehmen (falls aktiviert). */
export function autoImportFromServer() {
  const state = getState();
  if (!state.settings.autoImportKlausuren || !server.klausuren) return 0;
  const proposals = pendingServerProposals();
  if (proposals.length) importKlausuren(proposals.map(proposalToItem), { sourceUrl: server.klausuren.pdfUrl });
  return proposals.length;
}
