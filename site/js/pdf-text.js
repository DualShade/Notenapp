// Text aus PDFs zeilenweise extrahieren (pdf.js, Browser + Node).
// Tabellen werden zu Zeilen mit Zellen rekonstruiert.

/** Gruppiert pdf.js-Textelemente einer Seite in Zeilen und Zellen. */
export function itemsToRows(items) {
  const parts = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width ?? 0,
      h: Math.abs(it.height || it.transform[3] || 10),
    }));
  parts.sort((a, b) => b.y - a.y || a.x - b.x);

  const lines = [];
  for (const p of parts) {
    const tol = Math.max(2, p.h * 0.45);
    const line = lines.find((l) => Math.abs(l.y - p.y) <= tol);
    if (line) line.parts.push(p);
    else lines.push({ y: p.y, parts: [p] });
  }
  lines.sort((a, b) => b.y - a.y);

  return lines.map((line) => {
    line.parts.sort((a, b) => a.x - b.x);
    const cells = [];
    let current = null;
    for (const p of line.parts) {
      const gap = current ? p.x - (current.x + current.w) : Infinity;
      if (current && gap < Math.max(4, p.h * 0.9)) {
        current.text += (gap > p.h * 0.15 ? ' ' : '') + p.str;
        current.w = p.x + p.w - current.x;
      } else {
        current = { text: p.str, x: p.x, w: p.w };
        cells.push(current);
      }
    }
    const kept = cells.map((c) => ({ ...c, text: c.text.replace(/\s+/g, ' ').trim() })).filter((c) => c.text);
    const texts = kept.map((c) => c.text);
    return { y: Math.round(line.y), x: Math.round(kept[0]?.x ?? 0), cells: texts, text: texts.join(' | ') };
  });
}

/** Öffnet ein PDF (ArrayBuffer/Uint8Array) mit pdf.js und liefert Seiten mit Zeilen. */
export async function extractPdfRows(pdfjsLib, data, options = {}) {
  const doc = await pdfjsLib.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: true,
    ...options,
  }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    pages.push({ page: n, rows: itemsToRows(content.items) });
  }
  await doc.destroy?.();
  return pages;
}
