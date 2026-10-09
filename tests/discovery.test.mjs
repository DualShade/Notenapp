import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schoolHalf, planTargets, slugMatches, discoverPlans, sameDestination } from '../site/js/plan-discovery.js';
import { findDownloadManagerLink } from '../site/js/link-finder.js';
import { extractCalendar } from '../site/js/klausur-calendar.js';

const TPL = 'https://www.lgoe.de/download/klassenarbeitsplan-{jahrgang}-{halbjahr}/';
const cfg = { jahrgang: 11, jahrgangSchuljahr: 2026 };

test('Halbjahre: August–Januar = 1, Februar–Juli = 2', () => {
  assert.deepEqual(schoolHalf(new Date(2026, 9, 9)), { startYear: 2026, halbjahr: 1 });
  assert.deepEqual(schoolHalf(new Date(2027, 0, 20)), { startYear: 2026, halbjahr: 1 });
  assert.deepEqual(schoolHalf(new Date(2027, 1, 3)), { startYear: 2026, halbjahr: 2 });
  assert.deepEqual(schoolHalf(new Date(2027, 6, 10)), { startYear: 2026, halbjahr: 2 });
});

test('Jahrgang rückt jedes Schuljahr weiter', () => {
  assert.deepEqual(planTargets(cfg, new Date(2026, 9, 9)).map((t) => t.label), ['11/1', '11/2']);
  assert.deepEqual(planTargets(cfg, new Date(2027, 2, 1)).map((t) => t.label), ['11/2', '12/1']);
  assert.deepEqual(planTargets(cfg, new Date(2027, 8, 1)).map((t) => t.label), ['12/1', '12/2']);
});

test('Slugs: 11-2 passt, 11-1 und 111-2 nicht', () => {
  assert.ok(slugMatches('klassenarbeitsplan-11-2', { jahrgang: 11, halbjahr: 2 }));
  assert.ok(slugMatches('klassenarbeitsplan-q1-11-2-2', { jahrgang: 11, halbjahr: 2 }));
  assert.ok(!slugMatches('klassenarbeitsplan-11-1', { jahrgang: 11, halbjahr: 2 }));
  assert.ok(!slugMatches('klassenarbeitsplan-111-2', { jahrgang: 11, halbjahr: 2 }));
});

test('Vorlage: aktuelles Halbjahr, nächstes erst wenn online', async () => {
  const online = new Set(['https://www.lgoe.de/download/klassenarbeitsplan-11-1/']);
  const res = await discoverPlans({ template: TPL, ...cfg, now: new Date(2026, 9, 9), exists: async (u) => online.has(u), fetchText: async () => ({ text: '[]' }) });
  assert.deepEqual(res.plans.map((p) => p.label), ['11/1']);
  online.add('https://www.lgoe.de/download/klassenarbeitsplan-11-2/');
  const both = await discoverPlans({ template: TPL, ...cfg, now: new Date(2026, 9, 9), exists: async (u) => online.has(u) });
  assert.deepEqual(both.plans.map((p) => p.url), [...online]);
});

test('Andere Adresse: Paketsuche der Homepage findet den Plan', async () => {
  const calls = [];
  const res = await discoverPlans({
    template: TPL, ...cfg, now: new Date(2027, 1, 10),
    exists: async () => false,
    fetchText: async (u) => {
      calls.push(u);
      return { text: JSON.stringify([
        { slug: 'klassenarbeitsplan-11-1', link: 'https://www.lgoe.de/download/klassenarbeitsplan-11-1/', title: { rendered: 'Klassenarbeitsplan 11/1' } },
        { slug: 'klassenarbeitsplan-11-2-neu', link: 'https://www.lgoe.de/download/klassenarbeitsplan-11-2-neu/', title: { rendered: 'Klassenarbeitsplan 11/2' } },
      ]) };
    },
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /wp-json\/wp\/v2\/wpdmpro\?search=klassenarbeitsplan/);
  assert.deepEqual(res.plans.map((p) => [p.label, p.url, p.via]), [['11/2', 'https://www.lgoe.de/download/klassenarbeitsplan-11-2-neu/', 'suche']]);
});

test('Umleitung auf eine andere Seite zählt nicht als vorhanden', () => {
  assert.ok(sameDestination('https://x.de/download/plan-11-2/', 'https://x.de/download/plan-11-2'));
  assert.ok(!sameDestination('https://x.de/download/plan-11-2/', 'https://x.de/download/plan-11-1/'));
});

test('Paketseite: eigener Download statt „Ähnliche Downloads“', () => {
  const base = 'https://www.lgoe.de/download/klassenarbeitsplan-11-2/';
  const html = `<a href="https://www.lgoe.de/download/klassenarbeitsplan-10-2/?wpdmdl=200">Klassenarbeitsplan 10/2 (pdf)</a>
    <a class="wpdm-download-link" data-downloadurl="https://www.lgoe.de/download/klassenarbeitsplan-11-2/?wpdmdl=240&amp;refresh=abc" href="#">Download</a>`;
  assert.equal(findDownloadManagerLink(html, base).url, 'https://www.lgoe.de/download/klassenarbeitsplan-11-2/?wpdmdl=240&refresh=abc');
});

test('Zwei Pläne aus verschiedenen Schuljahren: Jahr pro Seite', () => {
  const page = (n, year, month, day) => ({ page: n, rows: [
    { text: `Klassenarbeitsplan Schuljahr ${year}/${year + 1}`, cells: [`Klassenarbeitsplan Schuljahr ${year}/${year + 1}`], xs: [10] },
    { text: `${month} Juli`, cells: [month, 'Juli'], xs: [10, 300] },
    { text: `${day} Mo M2`, cells: [`${day} Mo M2`], xs: [10] },
  ] });
  const cal = extractCalendar([page(1, 2026, 'März', 1), page(2, 2027, 'September', 6)]);
  assert.deepEqual(cal.days.map((d) => d.date), ['2027-03-01', '2027-09-06']);
});
