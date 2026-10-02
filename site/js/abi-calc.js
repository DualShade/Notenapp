// Abiturberechnung (KMK-Standard, wie z. B. in NRW):
//   Block I:  N Kurse aus der Qualifikationsphase, LK-Kurse doppelt gewichtet
//             E_I = round(P / S · 40), max. 600 (P = Punktsumme, S = Anzahl inkl. LK doppelt)
//   Block II: 5 Prüfungskomponenten × 4, max. 300
//   Gesamt:   E = E_I + E_II, Note = 17/3 − E/180, auf eine Nachkommastelle abgeschnitten

export const ABI_DEFAULTS = { totalCourses: 40, maxUnderCourses: 8, exams: 5 };

/**
 * Wählt die einzubringenden Kurse: alle LK-Kurse + die besten GK-Kurse, bis
 * `totalCourses` erreicht ist. `forced[id]` = true/false erzwingt Ein-/Ausschluss.
 * courses: [{id, points, isLK}]
 */
export function selectCourses(courses, { totalCourses = ABI_DEFAULTS.totalCourses, forced = {} } = {}) {
  const usable = courses.filter((c) => c.points != null);
  const chosen = new Set();
  for (const c of usable) if (forced[c.id] === true || (c.isLK && forced[c.id] !== false)) chosen.add(c.id);
  const rest = usable
    .filter((c) => !chosen.has(c.id) && forced[c.id] !== false)
    .sort((a, b) => b.points - a.points);
  for (const c of rest) {
    if (chosen.size >= totalCourses) break;
    chosen.add(c.id);
  }
  return chosen;
}

export function blockOne(courses, chosen) {
  let P = 0;
  let S = 0;
  let under = 0;
  let count = 0;
  for (const c of courses) {
    if (!chosen.has(c.id) || c.points == null) continue;
    const w = c.isLK ? 2 : 1;
    P += c.points * w;
    S += w;
    count++;
    if (c.points < 5) under++;
  }
  const E = S ? Math.round((P / S) * 40) : 0;
  return { E, P, S, count, under };
}

export function blockTwo(examPoints) {
  const valid = examPoints.filter((p) => p != null);
  const E = valid.reduce((a, p) => a + p * 4, 0);
  return { E, count: valid.length, atLeastFive: valid.filter((p) => p >= 5).length };
}

/** Abiturnote aus Gesamtpunkten (300–900). */
export function abiGrade(total) {
  if (total < 300) return null;
  const n = Math.floor((17 / 3 - total / 180) * 10 + 1e-9) / 10;
  return Math.max(1, Math.min(4, n));
}

/** Mindest-Gesamtpunktzahl für eine Wunsch-Abinote (z. B. 1,5 → 714). */
export function pointsForGrade(target) {
  if (target <= 1) return 823;
  return Math.max(300, Math.floor((17 / 3 - target - 0.1) * 180 + 1e-9) + 1);
}

/** Bestehensbedingungen (vereinfacht) als Liste von Warnungen. */
export function checkRules(b1, b2, { totalCourses = ABI_DEFAULTS.totalCourses, maxUnder = ABI_DEFAULTS.maxUnderCourses } = {}) {
  const issues = [];
  if (b1.count < totalCourses) issues.push(`Erst ${b1.count} von ${totalCourses} Kursen mit Noten.`);
  if (b1.E < 200) issues.push(`Block I: mindestens 200 Punkte nötig (aktuell ${b1.E}).`);
  if (b1.under > maxUnder) issues.push(`Zu viele Unterkurse (unter 5 Punkten): ${b1.under} von höchstens ${maxUnder}.`);
  if (b2.count === 5 && b2.E < 100) issues.push(`Block II: mindestens 100 Punkte nötig (aktuell ${b2.E}).`);
  if (b2.count === 5 && b2.atLeastFive < 3) issues.push('Block II: in mindestens 3 Prüfungen sind 5 Punkte nötig.');
  return issues;
}
