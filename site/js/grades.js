// Notenberechnung im Punktesystem der Oberstufe (0–15 Punkte).

export const POINT_LABELS = {
  15: '1+', 14: '1', 13: '1-',
  12: '2+', 11: '2', 10: '2-',
  9: '3+', 8: '3', 7: '3-',
  6: '4+', 5: '4', 4: '4-',
  3: '5+', 2: '5', 1: '5-',
  0: '6',
};

export const NOTE_WORDS = {
  1: 'sehr gut', 2: 'gut', 3: 'befriedigend', 4: 'ausreichend', 5: 'mangelhaft', 6: 'ungenügend',
};

// Standard-Notenschlüssel (KMK / Abitur): Mindestprozent je Punktzahl.
export const SCALE_PRESETS = {
  abitur: {
    name: 'Abitur (Standard, KMK)',
    scale: { 15: 95, 14: 90, 13: 85, 12: 80, 11: 75, 10: 70, 9: 65, 8: 60, 7: 55, 6: 50, 5: 45, 4: 39, 3: 33, 2: 27, 1: 20, 0: 0 },
  },
  linear: {
    name: 'Linear (je 5 %)',
    scale: { 15: 95, 14: 90, 13: 85, 12: 80, 11: 75, 10: 70, 9: 65, 8: 60, 7: 55, 6: 50, 5: 45, 4: 40, 3: 33, 2: 26, 1: 20, 0: 0 },
  },
  streng: {
    name: 'Streng (ab 50 % ausreichend)',
    scale: { 15: 96, 14: 92, 13: 88, 12: 84, 11: 80, 10: 75, 9: 71, 8: 67, 7: 63, 6: 59, 5: 55, 4: 50, 3: 40, 2: 30, 1: 20, 0: 0 },
  },
};

export const GRADE_TYPES = {
  klausur: { label: 'Klausur', group: 'schriftlich' },
  test: { label: 'Test', group: 'schriftlich' },
  muendlich: { label: 'Mündlich', group: 'muendlich' },
  referat: { label: 'Referat', group: 'muendlich' },
  sonstige: { label: 'Sonstige', group: 'muendlich' },
};

export const GROUP_LABELS = { schriftlich: 'Schriftlich', muendlich: 'Sonstige Mitarbeit' };

/** Punkte (auch Kommazahl) → Notenwert nach (17 − P) / 3, z. B. 11 P → 2,0. */
export function pointsToNoteValue(points) {
  if (points == null || Number.isNaN(points)) return null;
  if (points < 1) return 6;
  return Math.min(6, Math.max(0.66, (17 - points) / 3));
}

export function formatNoteValue(points) {
  const v = pointsToNoteValue(points);
  if (v == null) return '–';
  return v.toFixed(1).replace('.', ',');
}

export function formatPoints(points, digits = 1) {
  if (points == null || Number.isNaN(points)) return '–';
  return Number(points).toFixed(digits).replace('.', ',');
}

/** Ganze Note (1–6) zu einer Punktzahl: 15–13 → 1, …, 3–1 → 5, 0 → 6. */
export function noteNumber(points) {
  const p = Math.round(points);
  return p <= 0 ? 6 : 1 + Math.floor((15 - p) / 3);
}

export function noteWord(points) {
  return NOTE_WORDS[noteNumber(points)];
}

export function pointsLabel(points) {
  return POINT_LABELS[Math.round(points)] ?? '–';
}

/** CSS-Klasse für die Farbe einer Punktzahl. */
export function pointsTone(points) {
  if (points == null) return 'tone-none';
  if (points >= 13) return 'tone-1';
  if (points >= 10) return 'tone-2';
  if (points >= 7) return 'tone-3';
  if (points >= 4) return 'tone-4';
  if (points >= 1) return 'tone-5';
  return 'tone-6';
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weightedMean(items) {
  const total = items.reduce((a, it) => a + (it.weight ?? 1), 0);
  if (!total) return null;
  return items.reduce((a, it) => a + it.points * (it.weight ?? 1), 0) / total;
}

/**
 * Schnitt eines Fachs: Schriftlich und Sonstige Mitarbeit werden getrennt
 * gemittelt und dann gewichtet. Fehlt eine Gruppe, zählt nur die andere.
 */
export function subjectAverage(grades, weights = { schriftlich: 1, muendlich: 1 }) {
  const groups = { schriftlich: [], muendlich: [] };
  for (const g of grades) {
    const group = GRADE_TYPES[g.type]?.group ?? 'muendlich';
    groups[group].push(g);
  }
  const parts = {};
  for (const [group, items] of Object.entries(groups)) parts[group] = weightedMean(items);
  let sum = 0;
  let total = 0;
  for (const [group, avg] of Object.entries(parts)) {
    if (avg == null) continue;
    const w = Number(weights[group] ?? 1);
    sum += avg * w;
    total += w;
  }
  return { average: total ? sum / total : null, parts, count: grades.length };
}

/** Anteil einer Gruppe in Prozent, z. B. 2:1 → schriftlich 67 %. */
export function weightPercent(weights, group) {
  const total = Number(weights.schriftlich) + Number(weights.muendlich);
  return total > 0 ? Math.round((Number(weights[group]) / total) * 100) : 0;
}

/** "2 : 1" (Kommazahlen mit Komma). */
export function formatRatio(weights) {
  const f = (n) => String(Math.round(Number(n) * 100) / 100).replace('.', ',');
  return `${f(weights.schriftlich)} : ${f(weights.muendlich)}`;
}

/** Gesamtschnitt über Fächer; LKs optional doppelt gewichtet. */
export function overallAverage(subjectAverages, { lkDouble = false } = {}) {
  const items = subjectAverages
    .filter((s) => s.average != null)
    .map((s) => ({ points: s.average, weight: lkDouble && s.kind === 'LK' ? 2 : 1 }));
  return weightedMean(items);
}

/** Prozent → Punkte anhand eines Schlüssels {punkte: mindestProzent}. */
export function percentToPoints(percent, scale) {
  for (let p = 15; p >= 0; p--) {
    if (percent >= scale[p]) return p;
  }
  return 0;
}

/**
 * Mindest-Rohpunkte (BE) je Punktzahl für eine Klausur mit maxPoints BE.
 * step = 0.5 erlaubt halbe Bewertungseinheiten.
 */
export function scaleTable(scale, maxPoints, step = 0.5) {
  const rows = [];
  for (let p = 15; p >= 0; p--) {
    const minPct = scale[p];
    const maxPct = p === 15 ? 100 : scale[p + 1];
    let minRaw = null;
    let maxRaw = null;
    if (maxPoints > 0) {
      minRaw = Math.ceil((minPct / 100) * maxPoints / step) * step;
      const upper = p === 15 ? maxPoints : Math.ceil((maxPct / 100) * maxPoints / step) * step - step;
      maxRaw = Math.max(minRaw, Math.min(maxPoints, upper));
    }
    rows.push({ points: p, label: POINT_LABELS[p], minPct, maxPct: p === 15 ? 100 : maxPct - 1, minRaw, maxRaw });
  }
  return rows;
}

export function averageOf(values) {
  return mean(values);
}

/**
 * Wunschnote: Welche Punktzahl braucht die nächste Note der Gruppe `group`,
 * damit der Fachschnitt `target` erreicht? Ergebnis ungerundet (kann < 0 oder > 15 sein).
 */
export function requiredPoints(grades, weights, target, group, weight = 1) {
  const sums = { schriftlich: { sum: 0, w: 0 }, muendlich: { sum: 0, w: 0 } };
  for (const g of grades) {
    const gr = GRADE_TYPES[g.type]?.group ?? 'muendlich';
    sums[gr].sum += g.points * (g.weight ?? 1);
    sums[gr].w += g.weight ?? 1;
  }
  const other = group === 'schriftlich' ? 'muendlich' : 'schriftlich';
  const wg = Number(weights[group] ?? 1);
  const wo = Number(weights[other] ?? 1);
  const otherAvg = sums[other].w ? sums[other].sum / sums[other].w : null;
  // Ziel-Gruppenschnitt, den die Gruppe nach der neuen Note haben muss
  const neededGroupAvg = otherAvg == null || wo === 0 ? target : (target * (wg + wo) - wo * otherAvg) / wg;
  const s = sums[group];
  return (neededGroupAvg * (s.w + weight) - s.sum) / weight;
}

/** Zeugnisnote eines Halbjahres: manuell gesetzt oder gerundeter Schnitt. */
export function effectivePoints(average, finalPoints) {
  if (finalPoints != null) return finalPoints;
  return average == null ? null : Math.round(average);
}
