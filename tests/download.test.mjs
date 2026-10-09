import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPdf, looksLikePdf, findDownloadManagerLink } from '../site/js/link-finder.js';

const enc = (s) => new TextEncoder().encode(s);
const PDF = enc('%PDF-1.4\n%âãÏÓ\n1 0 obj ...');

function site(pages) {
  const calls = [];
  return {
    calls,
    fetchBytes: async (url) => {
      calls.push(url);
      if (!(url in pages)) throw new Error(`404 ${url}`);
      const p = pages[url];
      if (typeof p === 'string') return { bytes: enc(p), url };
      if (p instanceof Uint8Array) return { bytes: p, url };
      return { bytes: p.bytes, url: p.redirect ?? url };
    },
  };
}

test('Direkter Download-Link (WordPress Download Manager) liefert die PDF', async () => {
  const url = 'https://www.lgoe.de/download/klassenarbeitsplan-11-1/?wpdmdl=228';
  const s = site({ [url]: { bytes: PDF, redirect: 'https://www.lgoe.de/wp-content/uploads/download-manager-files/Klassenarbeitsplan.pdf' } });
  const res = await fetchPdf(url, s);
  assert.ok(looksLikePdf(res.bytes));
  assert.equal(s.calls.length, 1);
});

test('Download-Seite statt PDF: Button-Link wird gefunden', async () => {
  const page = 'https://www.lgoe.de/download/klassenarbeitsplan-11-1/';
  const dl = 'https://www.lgoe.de/download/klassenarbeitsplan-11-1/?wpdmdl=228&refresh=6705f3e1';
  const html = `<html><body><h1>Klassenarbeitsplan 11/1</h1>
    <a href="https://www.lgoe.de/impressum/">Impressum</a>
    <a class="wpdm-download-link" data-downloadurl="${dl.replace('&', '&amp;')}" href="#">Download</a></body></html>`;
  const s = site({ [page]: html, [dl]: PDF });
  const res = await fetchPdf(page, s);
  assert.ok(looksLikePdf(res.bytes));
  assert.deepEqual(s.calls, [page, dl]);
  assert.equal(findDownloadManagerLink(html, page).url, dl);
});

test('Download-Seite mit normalem PDF-Link', async () => {
  const page = 'https://schule.de/termine/';
  const s = site({ [page]: '<a href="/files/Klassenarbeitsplan_J1.pdf">Klassenarbeitsplan J1</a>', 'https://schule.de/files/Klassenarbeitsplan_J1.pdf': PDF });
  assert.ok(looksLikePdf((await fetchPdf(page, s)).bytes));
});

test('Keine PDF, kein Link → verständlicher Fehler', async () => {
  const page = 'https://schule.de/leer/';
  await assert.rejects(fetchPdf(page, site({ [page]: '<html>Seite nicht gefunden</html>' })), /keine PDF/);
});
