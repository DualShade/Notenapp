// Findet den Klassenarbeitsplan des aktuellen (und schon veröffentlichten
// nächsten) Halbjahres auf der Schul-Homepage – statt an einem festen Link zu hängen.
//
// Vorlage z. B. "https://www.lgoe.de/download/klassenarbeitsplan-{jahrgang}-{halbjahr}/"
// Der Jahrgang rückt jedes Schuljahr eins weiter (Q1 = 11 → Q2 = 12).

/** Halbjahr zu einem Datum: 1. Halbjahr August–Januar, 2. Halbjahr Februar–Juli. */
export function schoolHalf(now = new Date()) {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 8) return { startYear: year, halbjahr: 1 };
  if (month === 1) return { startYear: year - 1, halbjahr: 1 };
  return { startYear: year - 1, halbjahr: 2 };
}

/** Jahrgang im Schuljahr `startYear`, ausgehend von "Jahrgang X im Schuljahr ab Y". */
export function jahrgangIn(startYear, { jahrgang, jahrgangSchuljahr }) {
  const base = Number(jahrgang);
  if (!base) return null;
  const from = Number(jahrgangSchuljahr) || startYear;
  return base + (startYear - from);
}

/** Aktuelles und nächstes Halbjahr: [{ jahrgang, halbjahr, startYear, label }]. */
export function planTargets(cfg, now = new Date()) {
  const cur = schoolHalf(now);
  const next = cur.halbjahr === 1 ? { startYear: cur.startYear, halbjahr: 2 } : { startYear: cur.startYear + 1, halbjahr: 1 };
  return [cur, next]
    .map((t) => ({ ...t, jahrgang: jahrgangIn(t.startYear, cfg) }))
    .filter((t) => t.jahrgang)
    .map((t) => ({ ...t, label: `${t.jahrgang}/${t.halbjahr}` }));
}

export function fillTemplate(template, { jahrgang, halbjahr }) {
  return template.replace(/\{jahrgang\}/g, jahrgang).replace(/\{halbjahr\}/g, halbjahr);
}

const pathOf = (u) => new URL(u).pathname.replace(/\/$/, '');

/**
 * WordPress-Download-Manager-Pakete per REST-API suchen (falls die Seite sie anbietet).
 * fetchText(url) → { text, url }. Liefert [{ slug, link, title }] oder [].
 */
export async function searchPackages(origin, query, fetchText) {
  try {
    const api = `${origin}/wp-json/wp/v2/wpdmpro?search=${encodeURIComponent(query)}&per_page=100&_fields=slug,link,title,modified`;
    const { text } = await fetchText(api);
    const list = JSON.parse(text);
    if (!Array.isArray(list)) return [];
    return list.filter((p) => p?.slug && p?.link).map((p) => ({ slug: p.slug, link: p.link, title: String(p.title?.rendered ?? p.slug), modified: p.modified ?? null }));
  } catch {
    return [];
  }
}

/** Passt ein Paket-Slug ("klassenarbeitsplan-11-2") zu Jahrgang + Halbjahr? */
export function slugMatches(slug, { jahrgang, halbjahr }) {
  return new RegExp(`(^|\\D)${jahrgang}\\D{1,3}${halbjahr}(\\D|$)`).test(slug);
}

/**
 * Sucht die Pläne. Für jedes Ziel (aktuelles/nächstes Halbjahr) wird zuerst die
 * Vorlage probiert, sonst die Paketsuche der Homepage. Nicht veröffentlichte
 * Pläne werden übersprungen. Ergebnis: { plans: [{ ...target, url, via }], packages }.
 */
export async function discoverPlans({ template, jahrgang, jahrgangSchuljahr, now = new Date(), exists, fetchText, query = 'klassenarbeitsplan' }) {
  const targets = planTargets({ jahrgang, jahrgangSchuljahr }, now);
  const origin = new URL(template).origin;
  let packages = null;
  const plans = [];
  for (const target of targets) {
    const url = fillTemplate(template, target);
    if (await exists(url)) {
      plans.push({ ...target, url, via: 'vorlage' });
      continue;
    }
    packages ??= fetchText ? await searchPackages(origin, query, fetchText) : [];
    const hit = packages.find((p) => slugMatches(p.slug, target));
    if (hit) plans.push({ ...target, url: hit.link, via: 'suche' });
  }
  return { plans, packages: packages ?? [], targets };
}

/** Prüft, ob unter der Adresse wirklich diese Seite liegt (keine Umleitung auf eine andere). */
export function sameDestination(requested, final) {
  try {
    return pathOf(requested) === pathOf(final);
  } catch {
    return false;
  }
}
