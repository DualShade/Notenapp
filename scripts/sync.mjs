#!/usr/bin/env node
// Holt Stundenplan (WebUntis) und Klausurplan (PDF von der Schul-Homepage)
// und schreibt sie als JSON in das Datenverzeichnis der Website.
// Läuft in der GitHub Action (Zugangsdaten als Secrets) oder lokal.
//
// Umgebungsvariablen (überschreiben notenapp.config.json):
//   UNTIS_SERVER, UNTIS_SCHOOL, UNTIS_USER, UNTIS_PASSWORD
//   KLAUSUR_PAGE_URL, KLAUSUR_PDF_URL, KLAUSUR_LINK_PATTERN, KLAUSUR_STUFE
//   LK_THRESHOLD, OUT_DIR (Standard: dist/data), PAGES_URL (Fallback auf alte Daten)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchUntisTimetable } from '../site/js/untis-client.js';
import { normalizeTimetable, detectCourses, DEFAULT_LK_THRESHOLD } from '../site/js/timetable.js';
import { findPdfLink } from '../site/js/link-finder.js';
import { extractPdfRows } from '../site/js/pdf-text.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const USER_AGENT = 'Mozilla/5.0 (compatible; Notenapp-Sync/1.0; +https://github.com)';

async function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(await readFile(path.join(root, 'notenapp.config.json'), 'utf8'));
  } catch {
    // keine Konfigurationsdatei
  }
  const pick = (...vals) => vals.find((v) => v != null && String(v).trim() !== '') ?? '';
  return {
    untis: {
      server: pick(env.UNTIS_SERVER, cfg.untis?.server),
      school: pick(env.UNTIS_SCHOOL, cfg.untis?.school),
      username: pick(env.UNTIS_USER, cfg.untis?.username),
      password: pick(env.UNTIS_PASSWORD),
      weeksBack: Number(pick(env.UNTIS_WEEKS_BACK, cfg.untis?.weeksBack, 1)),
      weeksAhead: Number(pick(env.UNTIS_WEEKS_AHEAD, cfg.untis?.weeksAhead, 5)),
    },
    klausuren: {
      pageUrl: pick(env.KLAUSUR_PAGE_URL, cfg.klausuren?.pageUrl),
      pdfUrl: pick(env.KLAUSUR_PDF_URL, cfg.klausuren?.pdfUrl),
      linkPattern: pick(env.KLAUSUR_LINK_PATTERN, cfg.klausuren?.linkPattern, 'klausur'),
      stufe: pick(env.KLAUSUR_STUFE, cfg.klausuren?.stufe),
    },
    lkThreshold: Number(pick(env.LK_THRESHOLD, cfg.lkThreshold, DEFAULT_LK_THRESHOLD)),
    outDir: path.resolve(root, pick(env.OUT_DIR, 'dist/data')),
    pagesUrl: pick(env.PAGES_URL).replace(/\/$/, ''),
  };
}

async function previous(cfg, file) {
  if (!cfg.pagesUrl) return null;
  try {
    const res = await fetch(`${cfg.pagesUrl}/data/${file}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function syncUntis(cfg) {
  const u = cfg.untis;
  if (!u.server || !u.school || !u.username || !u.password) {
    return { skipped: true, reason: 'Untis nicht konfiguriert (UNTIS_SERVER/UNTIS_SCHOOL/UNTIS_USER/UNTIS_PASSWORD).' };
  }
  const raw = await fetchUntisTimetable(u);
  const timetable = normalizeTimetable(raw);
  timetable.lkThreshold = cfg.lkThreshold;
  timetable.courses = detectCourses(timetable.lessons, { threshold: cfg.lkThreshold });
  return { data: timetable, summary: `${timetable.lessons.length} Stunden, ${timetable.courses.length} Kurse` };
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
  return { buffer: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
}

async function syncKlausuren(cfg) {
  const k = cfg.klausuren;
  if (!k.pageUrl && !k.pdfUrl) {
    return { skipped: true, reason: 'Keine Klausurplan-Quelle (KLAUSUR_PAGE_URL oder KLAUSUR_PDF_URL).' };
  }
  let pdfUrl = k.pdfUrl;
  let linkText = null;
  if (!pdfUrl) {
    const res = await fetch(k.pageUrl, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Homepage antwortet mit HTTP ${res.status}`);
    const link = findPdfLink(await res.text(), res.url || k.pageUrl, k.linkPattern);
    if (!link) throw new Error(`Kein PDF-Link mit „${k.linkPattern}“ auf ${k.pageUrl} gefunden.`);
    pdfUrl = link.url;
    linkText = link.text;
  }
  const { buffer } = await fetchBuffer(pdfUrl);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pages = await extractPdfRows(pdfjs, buffer, { verbosity: 0 });
  return {
    data: {
      fetchedAt: new Date().toISOString(),
      pageUrl: k.pageUrl || null,
      pdfUrl,
      linkText,
      stufe: k.stufe || null,
      pages,
    },
    summary: `${pages.length} Seiten aus ${pdfUrl}`,
  };
}

async function run(name, file, cfg, fn, status) {
  try {
    const result = await fn(cfg);
    if (result.skipped) {
      console.log(`⏭  ${name}: ${result.reason}`);
      status[name] = { ok: false, skipped: true, message: result.reason };
      return;
    }
    await writeFile(path.join(cfg.outDir, file), JSON.stringify(result.data));
    console.log(`✅ ${name}: ${result.summary}`);
    status[name] = { ok: true, message: result.summary, fetchedAt: new Date().toISOString() };
  } catch (err) {
    console.warn(`⚠️  ${name}: ${err.message}`);
    status[name] = { ok: false, message: err.message };
    const old = await previous(cfg, file);
    if (old) {
      await writeFile(path.join(cfg.outDir, file), JSON.stringify(old));
      status[name].message += ' – letzte erfolgreiche Daten werden weiter angezeigt.';
      console.log(`↩️  ${name}: alte Daten von ${cfg.pagesUrl} übernommen.`);
    }
  }
}

const cfg = await loadConfig();
await mkdir(cfg.outDir, { recursive: true });
const status = { generatedAt: new Date().toISOString() };
await run('untis', 'timetable.json', cfg, syncUntis, status);
await run('klausuren', 'klausuren.json', cfg, syncKlausuren, status);
await writeFile(path.join(cfg.outDir, 'status.json'), JSON.stringify(status, null, 2));
console.log(`Daten geschrieben nach ${path.relative(root, cfg.outDir)}`);
