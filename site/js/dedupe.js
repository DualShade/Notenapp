// Doppelte Fächer zusammenführen.
//
// Entstehen, wenn zwei Geräte dieselben Untis-Kurse unabhängig anlegen und
// danach synchronisieren (früher mit zufälligen IDs). Alle Noten, Klausuren,
// Hausaufgaben, Fehlzeiten und Zeugnisnoten wandern zum verbleibenden Fach.
// Die Wahl des verbleibenden Fachs ist deterministisch, damit alle Geräte
// unabhängig voneinander zum gleichen Ergebnis kommen.

/** Stabile ID für aus Untis angelegte Fächer – auf allen Geräten gleich. */
export function untisSubjectId(untisKey) {
  // Groß/Klein bleibt erhalten: "M2" (LK) und "m2" (GK) sind verschiedene Kurse
  return `u-${String(untisKey).replace(/[^A-Za-z0-9ÄÖÜäöüß]+/g, '_')}`;
}

function groupKeys(subject) {
  const keys = [];
  if (subject.untisKey) keys.push(`k:${subject.untisKey}`);
  // Gleiche Untis-Bezeichnung (Kürzel + Name) = gleicher Kurs, auch bei anderem Schlüssel.
  // Kürzel case-sensitiv: "M2" (LK) und "m2" (GK) sind verschiedene Kurse.
  if (subject.untisKey && subject.short) keys.push(`n:${subject.short}|${String(subject.untisName ?? subject.name).toLowerCase()}`);
  return keys;
}

const REF_COLLECTIONS = ['grades', 'klausuren', 'homework', 'absences', 'finals'];

function refCount(state, id) {
  return REF_COLLECTIONS.reduce((n, c) => n + (state[c] ?? []).filter((x) => x.subjectId === id).length, 0);
}

/** Führt doppelte Fächer zusammen. Mutiert `state`, liefert die Anzahl entfernter Fächer. */
export function dedupeSubjects(state) {
  const subjects = state.subjects ?? [];
  // Union-Find über gemeinsame Schlüssel
  const parent = new Map(subjects.map((s) => [s.id, s.id]));
  const find = (id) => { while (parent.get(id) !== id) id = parent.get(id); return id; };
  const owner = new Map();
  for (const s of subjects) {
    for (const key of groupKeys(s)) {
      if (owner.has(key)) parent.set(find(s.id), find(owner.get(key)));
      else owner.set(key, s.id);
    }
  }
  const groups = new Map();
  for (const s of subjects) {
    const root = find(s.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(s);
  }

  let removed = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Behalten: das Fach mit den meisten Einträgen, sonst die stabile Untis-ID, sonst kleinste ID
    const ranked = [...group].sort((a, b) => refCount(state, b.id) - refCount(state, a.id)
      || Number(b.id.startsWith('u-')) - Number(a.id.startsWith('u-'))
      || a.id.localeCompare(b.id));
    const keep = ranked[0];
    for (const other of ranked.slice(1)) {
      // Einstellungen übernehmen, die nur das Duplikat hat
      for (const field of ['planCode', 'goal', 'weights', 'kindOverride', 'kindAuto', 'hours', 'group', 'teachers', 'untisLabels', 'untisName', 'untisExamDates']) keep[field] ??= other[field];
      keep.aliases = [...new Set([...(keep.aliases ?? []), ...(other.aliases ?? [])])];
      keep.archived = keep.archived && other.archived;
      for (const c of ['grades', 'klausuren', 'homework', 'absences']) {
        for (const item of state[c] ?? []) if (item.subjectId === other.id) item.subjectId = keep.id;
      }
      for (const f of state.finals ?? []) {
        if (f.subjectId !== other.id) continue;
        f.subjectId = keep.id;
        f.id = `${keep.id}|${f.halbjahr}`;
      }
      removed++;
    }
    const drop = new Set(ranked.slice(1).map((s) => s.id));
    state.subjects = state.subjects.filter((s) => !drop.has(s.id));
  }
  if (removed) {
    // Doppelte Termine/Zeugnisnoten nach dem Umhängen entfernen
    const seen = new Set();
    state.klausuren = (state.klausuren ?? []).filter((k) => {
      const key = `${k.date}|${k.subjectId}|${k.title ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const finals = new Map();
    for (const f of state.finals ?? []) if (!finals.has(f.id)) finals.set(f.id, f);
    state.finals = [...finals.values()];
  }
  return removed;
}

/** Gibt es doppelte Fächer? (ohne zu verändern) */
export function hasDuplicateSubjects(state) {
  return dedupeSubjects(structuredClone(state)) > 0;
}

/** "Englisch 3-stdg." → "Englisch" (die Stunden stehen ohnehin beim Fach). */
export function cleanSubjectName(name) {
  const cleaned = String(name ?? '').replace(/\s*[(,–-]?\s*\d+(?:[.,]\d)?\s*-?\s*(?:stdg|std|stündig|h)\.?\)?\s*$/i, '').trim();
  return cleaned || String(name ?? '');
}
