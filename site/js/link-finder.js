// Findet auf einer Schul-Homepage den aktuellen Klausurplan-PDF-Link.

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/** Alle Links einer HTML-Seite mit Text, absolut aufgelöst. */
export function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const href = decodeEntities((m[1] ?? m[2] ?? m[3] ?? '').trim());
    if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    let url;
    try {
      url = new URL(href, baseUrl).href;
    } catch {
      continue;
    }
    const text = decodeEntities(m[4].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    links.push({ url, text });
  }
  return links;
}

/**
 * Wählt den passendsten PDF-Link. `pattern` (Regex-Text, Standard "klausur")
 * muss in URL oder Linktext vorkommen. Bei mehreren Treffern gewinnt der mit
 * dem jüngsten Datum im Namen, sonst der erste auf der Seite.
 */
export function findPdfLink(html, baseUrl, pattern = 'klausur') {
  const re = new RegExp(pattern || 'klausur', 'i');
  const candidates = extractLinks(html, baseUrl).filter((l) => {
    const isPdf = /\.pdf(\?|#|$)/i.test(l.url) || /pdf/i.test(l.text);
    return isPdf && (re.test(decodeURIComponent(l.url)) || re.test(l.text));
  });
  if (!candidates.length) return null;
  const scored = candidates.map((c, index) => ({ ...c, index, stamp: dateStamp(`${c.text} ${decodeURIComponent(c.url)}`) }));
  scored.sort((a, b) => b.stamp - a.stamp || a.index - b.index);
  return scored[0];
}

function dateStamp(s) {
  let best = 0;
  const re = /(\d{1,2})[._-](\d{1,2})[._-](\d{2,4})|(20\d{2})[._-]?(\d{2})[._-]?(\d{2})/g;
  let m;
  while ((m = re.exec(s))) {
    let y; let mo; let d;
    if (m[1]) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; } else { y = +m[4]; mo = +m[5]; d = +m[6]; }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) best = Math.max(best, y * 10000 + mo * 100 + d);
  }
  return best;
}

/** Beginnt der Inhalt mit "%PDF" (ggf. nach ein paar Leerzeichen)? */
export function looksLikePdf(bytes) {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
  return head.includes('%PDF-');
}

/** Download-Links von WordPress-Download-Manager-Seiten (…?wpdmdl=123). */
export function findDownloadManagerLink(html, baseUrl) {
  const fromLinks = extractLinks(html, baseUrl).find((l) => /[?&]wpdmdl=\d+/.test(l.url));
  if (fromLinks) return fromLinks;
  // Buttons tragen die Adresse oft in data-downloadurl="…"
  const m = html.match(/https?:\/\/[^"'\s<>]*[?&](?:amp;)?wpdmdl=\d+[^"'\s<>]*/i);
  if (m) return { url: decodeEntities(m[0]), text: 'Download' };
  return null;
}

/**
 * Lädt eine PDF. Liefert die Adresse statt der PDF eine Download-Seite (HTML),
 * wird dort der eigentliche Download-Link gesucht (PDF-Link oder Download-Manager).
 * fetchBytes(url) → { bytes: Uint8Array, url: finalUrl }
 */
export async function fetchPdf(url, { fetchBytes, pattern = 'klausur|klassenarbeit', depth = 0 } = {}) {
  const { bytes, url: finalUrl } = await fetchBytes(url);
  if (looksLikePdf(bytes)) return { bytes, url: finalUrl ?? url };
  if (depth >= 2) throw new Error(`Unter ${url} liegt keine PDF.`);
  const html = new TextDecoder().decode(bytes);
  const link = findPdfLink(html, finalUrl ?? url, pattern) ?? findDownloadManagerLink(html, finalUrl ?? url);
  if (!link || link.url === url) throw new Error(`Unter ${url} liegt keine PDF und kein Download-Link.`);
  return fetchPdf(link.url, { fetchBytes, pattern, depth: depth + 1 });
}
