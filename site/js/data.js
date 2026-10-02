// Datenquellen: Untis-Login in der App (über den Proxy), von der GitHub Action
// erzeugte JSON-Dateien und PDF-Verarbeitung im Browser.

import { getState, update, uid, kindOf, nextColor } from './store.js';
import { normalizeTimetable, detectCourses, todayIso } from './timetable.js';
import { extractPdfRows } from './pdf-text.js';
import { extractCandidates, matchCandidates, klausurKey } from './klausur-parser.js';
import { findPdfLink } from './link-finder.js';
import { fetchUntisTimetable, searchSchools, UntisError } from './untis-client.js';
import { APP_CONFIG } from './config.js';

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

// ---------- Untis-Login direkt in der App (über den Notenapp-Proxy) ----------
// Browser dürfen WebUntis nicht direkt ansprechen (CORS, Session-Cookie). Der
// Proxy reicht die JSON-RPC-Aufrufe nur durch; die Logik läuft hier in der App.

function proxyBase() {
  const url = getState().settings.proxyUrl?.trim() || APP_CONFIG.proxyUrl?.trim();
  return url || null;
}

export function hasProxy() {
  return !!proxyBase();
}

function proxyUrl(params) {
  const u = new URL(proxyBase(), location.href);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.href;
}

/** fetch-Ersatz, der Anfragen an *.webuntis.com durch den Proxy tunnelt. */
function tunnelFetch(url, init = {}) {
  return fetch(proxyUrl({ route: 'rpc' }), {
    method: 'POST',
    // text/plain = "einfache" Anfrage ohne CORS-Preflight
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ url, cookie: init.headers?.Cookie ?? null, body: init.body ?? '' }),
  });
}

const NO_PROXY = 'Für den Untis-Login wird der Notenapp-Proxy benötigt. Er ist für diese Seite noch nicht eingerichtet (siehe README → „Untis-Login in der App“).';

/** Schulsuche: erst direkt versuchen, sonst über den Proxy. */
export async function findSchools(query) {
  try {
    return await searchSchools(query);
  } catch (err) {
    if (err instanceof UntisError) throw err; // echte Antwort von Untis (z. B. zu viele Treffer)
    if (!hasProxy()) throw new Error(NO_PROXY);
    return searchSchools(query, { fetchImpl: tunnelFetch });
  }
}

export function untisAccount() {
  const u = getState().settings.untis;
  return u?.server && u?.school && u?.username ? u : null;
}

async function loadUntis(account) {
  if (!hasProxy()) throw new Error(NO_PROXY);
  const raw = await fetchUntisTimetable({
    server: account.server,
    school: account.school,
    username: account.username,
    password: account.password,
    weeksBack: 1,
    weeksAhead: 5,
    fetchImpl: tunnelFetch,
  });
  return normalizeTimetable(raw);
}

function friendlyUntisError(err) {
  if (err instanceof UntisError && err.code === -8504) return new Error('Benutzername oder Passwort ist falsch.');
  if (err instanceof UntisError && err.code === -8500) return new Error('Schule nicht gefunden – bitte neu suchen.');
  if (err instanceof TypeError) return new Error('Proxy nicht erreichbar. Bitte später erneut versuchen.');
  return err;
}

/** Zugangsdaten prüfen, Stundenplan laden und Konto speichern. */
export async function connectUntis(account) {
  let timetable;
  try {
    timetable = await loadUntis(account);
  } catch (err) {
    throw friendlyUntisError(err);
  }
  update((s) => {
    s.settings.untis = { ...account };
    s.localTimetable = timetable;
  }, { silent: true });
  const created = syncSubjectsWithTimetable();
  update(() => {});
  return { timetable, created };
}

/** Stundenplan mit gespeichertem Konto neu laden. */
export async function refreshUntis({ silent = false } = {}) {
  const account = untisAccount();
  if (!account) throw new Error('Kein Untis-Konto verbunden.');
  let timetable;
  try {
    timetable = await loadUntis(account);
  } catch (err) {
    throw friendlyUntisError(err);
  }
  update((s) => { s.localTimetable = timetable; }, { silent: true });
  const created = syncSubjectsWithTimetable();
  if (!silent) update(() => {});
  return { timetable, created };
}

export function disconnectUntis() {
  update((s) => {
    s.settings.untis = { server: '', school: '', schoolName: '', username: '', password: '' };
    s.localTimetable = null;
  });
}

/** Holt eine fremde URL – erst direkt, dann über den Proxy (CORS). */
export async function fetchExternal(url, as = 'text') {
  const tryRead = async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return as === 'buffer' ? res.arrayBuffer() : res.text();
  };
  try {
    return await tryRead(await fetch(url));
  } catch {
    if (!hasProxy()) {
      throw new Error('Die Seite erlaubt keinen direkten Abruf aus dem Browser (CORS). Nutze die GitHub Action oder richte den Proxy ein.');
    }
    return tryRead(await fetch(proxyUrl({ route: 'fetch', url })));
  }
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
