// Statistik: Verlauf, Verteilung, Stärken/Schwächen.
// Diagramme sind schlichtes SVG: eine Achse (0–15 Punkte), dünne Linien,
// Tooltips beim Antippen/Überfahren; pro Fach ein eigenes kleines Diagramm,
// damit Farbe nie das einzige Unterscheidungsmerkmal ist.

import { h, empty, formatDate } from '../ui.js';
import { getState, kindOf } from '../store.js';
import { overallAverage, formatPoints, pointsLabel, GRADE_TYPES, formatNoteValue } from '../grades.js';
import { activeSubjects, averageFor, gradesFor, colorDot, kindBadge, pointsPill } from './common.js';

let scope = 'halbjahr'; // halbjahr | alle

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Tooltip für alle Elemente mit data-tip innerhalb von root. */
function withTooltips(root) {
  const tip = h('div', { class: 'chart-tip', role: 'status' });
  root.style.position = 'relative';
  root.append(tip);
  const show = (e) => {
    const t = e.target.closest('[data-tip]');
    if (!t || !root.contains(t)) { tip.classList.remove('show'); return; }
    tip.textContent = t.dataset.tip;
    const r = root.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    tip.classList.add('show');
    const x = Math.min(Math.max(tr.left + tr.width / 2 - r.left, tip.offsetWidth / 2), r.width - tip.offsetWidth / 2);
    tip.style.left = `${x}px`;
    tip.style.top = `${tr.top - r.top - 8}px`;
  };
  root.addEventListener('pointerover', show);
  root.addEventListener('pointerdown', show);
  root.addEventListener('pointerleave', () => tip.classList.remove('show'));
  return root;
}

/** Linie über Halbjahre (eine Reihe, 0–15). points: [{label, value}] */
function lineChart(points, { color = 'var(--accent)', height = 180 } = {}) {
  const W = 340;
  const H = height;
  const pad = { l: 28, r: 14, t: 16, b: 26 };
  const n = points.length;
  const x = (i) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (n - 1));
  const y = (v) => pad.t + (1 - v / 15) * (H - pad.t - pad.b);
  const grid = [0, 5, 10, 15].map((v) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${v}</text>`).join('');
  const valid = points.map((p, i) => ({ ...p, i })).filter((p) => p.value != null);
  const path = valid.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const dots = valid.map((p) => `<circle cx="${x(p.i)}" cy="${y(p.value)}" r="5" fill="${color}" class="dot-mark"/><circle cx="${x(p.i)}" cy="${y(p.value)}" r="16" fill="transparent" data-tip="${esc(p.label)}: ${formatPoints(p.value)} P (≈ Note ${formatNoteValue(p.value)})"/>`).join('');
  const labels = points.map((p, i) => `<text x="${x(i)}" y="${H - 6}" class="axis" text-anchor="middle">${esc(p.label)}</text>`).join('');
  const last = valid.at(-1);
  const lastLabel = last ? `<text x="${x(last.i)}" y="${y(last.value) - 10}" class="value-label" text-anchor="middle">${formatPoints(last.value)}</text>` : '';
  return withTooltips(h('div', { class: 'chart', html: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf">${grid}<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}${lastLabel}${labels}</svg>` }));
}

/** Kleines Verlaufsdiagramm einer Fachnote (laufender Schnitt). */
function sparkline(values, color) {
  const W = 120;
  const H = 36;
  if (values.length < 2) return h('span', { class: 'muted small' }, values.length ? '1 Note' : '–');
  const x = (i) => 4 + (i * (W - 8)) / (values.length - 1);
  const y = (v) => 4 + (1 - v / 15) * (H - 8);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return h('span', { class: 'spark', html: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><line x1="0" x2="${W}" y1="${y(5)}" y2="${y(5)}" class="grid"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${x(values.length - 1)}" cy="${y(values.at(-1))}" r="3.5" fill="${color}"/></svg>` });
}

/** Säulen 0–15: wie oft kam welche Punktzahl vor? */
function distribution(grades) {
  const counts = Array.from({ length: 16 }, (_, p) => grades.filter((g) => g.points === p).length);
  const max = Math.max(1, ...counts);
  const W = 340;
  const H = 150;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const bw = (W - pad.l - pad.r) / 16;
  const bars = counts.map((c, p) => {
    const bh = (c / max) * (H - pad.t - pad.b);
    const x = pad.l + p * bw + 1;
    const yTop = H - pad.b - bh;
    const r = Math.min(4, bh / 2);
    const bar = c ? `<path d="M${x},${H - pad.b}V${yTop + r}q0,-${r} ${r},-${r}h${bw - 2 - 2 * r}q${r},0 ${r},${r}V${H - pad.b}Z" fill="var(--accent)"/>` : '';
    const label = c ? `<text x="${x + (bw - 2) / 2}" y="${yTop - 4}" class="value-label small" text-anchor="middle">${c}</text>` : '';
    return `${bar}${label}<rect x="${x - 1}" y="${pad.t}" width="${bw}" height="${H - pad.t - pad.b}" fill="transparent" data-tip="${p} Punkte (${pointsLabel(p)}): ${c}×"/><text x="${x + (bw - 2) / 2}" y="${H - 6}" class="axis" text-anchor="middle">${p}</text>`;
  }).join('');
  return withTooltips(h('div', { class: 'chart', html: `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Notenverteilung"><line x1="${pad.l}" x2="${W - pad.r}" y1="${H - pad.b}" y2="${H - pad.b}" class="grid"/>${bars}</svg>` }));
}

function runningAverage(grades) {
  const sorted = [...grades].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const out = [];
  let sum = 0;
  sorted.forEach((g, i) => { sum += g.points; out.push(sum / (i + 1)); });
  return out;
}

export function statsView() {
  const state = getState();
  const subjects = activeSubjects();
  const hj = state.settings.halbjahr;
  if (!state.grades.length) return h('div', { class: 'view' }, empty('Noch keine Statistik', 'Sobald du Noten einträgst, siehst du hier Verlauf, Verteilung und deine Stärken.'));

  // Gesamtschnitt pro Halbjahr
  const trend = state.settings.halbjahre.map((label) => ({
    label,
    value: overallAverage(subjects.map((s) => ({ ...averageFor(s, label), kind: kindOf(s) })), { lkDouble: state.settings.lkDouble }),
  }));
  const trendWithData = trend.filter((t) => t.value != null);
  const current = subjects.map((s) => ({ subject: s, ...averageFor(s, hj) })).filter((x) => x.average != null);
  const ranked = [...current].sort((a, b) => b.average - a.average);
  const scopeGrades = scope === 'halbjahr' ? state.grades.filter((g) => g.halbjahr === hj) : state.grades;
  const written = scopeGrades.filter((g) => GRADE_TYPES[g.type]?.group === 'schriftlich');
  const oral = scopeGrades.filter((g) => GRADE_TYPES[g.type]?.group !== 'schriftlich');
  const avg = (list) => (list.length ? list.reduce((a, g) => a + g.points, 0) / list.length : null);
  const under = current.filter((x) => Math.round(x.average) < 5);

  return h('div', { class: 'view' },
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Gesamtschnitt pro Halbjahr'),
      trendWithData.length ? lineChart(trend) : h('p', { class: 'muted small' }, 'Noch keine Halbjahre mit Noten.')),
    h('div', { class: 'stats stats-4' },
      h('div', {}, h('span', { class: 'muted' }, 'Schriftlich Ø'), h('strong', {}, formatPoints(avg(written)))),
      h('div', {}, h('span', { class: 'muted' }, 'Mündlich Ø'), h('strong', {}, formatPoints(avg(oral)))),
      h('div', {}, h('span', { class: 'muted' }, 'Noten'), h('strong', {}, String(scopeGrades.length))),
      h('div', {}, h('span', { class: 'muted' }, 'Unterkurse'), h('strong', { class: under.length ? 'danger' : '' }, String(under.length)))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h3', { class: 'card-title' }, 'Notenverteilung'),
        h('div', { class: 'segmented small' },
          h('button', { class: scope === 'halbjahr' ? 'active' : '', onclick: (e) => { scope = 'halbjahr'; e.target.closest('.view').replaceWith(statsView()); } }, hj),
          h('button', { class: scope === 'alle' ? 'active' : '', onclick: (e) => { scope = 'alle'; e.target.closest('.view').replaceWith(statsView()); } }, 'Alle'))),
      scopeGrades.length ? distribution(scopeGrades) : h('p', { class: 'muted small' }, 'Keine Noten in diesem Halbjahr.')),
    ranked.length >= 2 ? h('div', { class: 'grid-2' },
      h('section', { class: 'card' }, h('h3', { class: 'card-title' }, '💪 Stärken'),
        h('ol', { class: 'rank' }, ranked.slice(0, 3).map((x) => h('li', {}, x.subject.name, ' ', pointsPill(x.average))))),
      h('section', { class: 'card' }, h('h3', { class: 'card-title' }, '🎯 Ausbaufähig'),
        h('ol', { class: 'rank' }, ranked.slice(-3).reverse().map((x) => h('li', {}, x.subject.name, ' ', pointsPill(x.average)))))) : null,
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, `Verlauf pro Fach (${hj})`),
      h('div', { class: 'list compact' }, subjects.map((s) => {
        const grades = gradesFor(s.id, hj);
        const run = runningAverage(grades);
        return h('a', { class: 'list-item', href: `#/fach/${s.id}` },
          colorDot(s),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, s.name, ' ', kindBadge(s)), h('div', { class: 'sub' }, `${grades.length} Noten`)),
          sparkline(run, s.color),
          h('strong', { class: 'spark-value' }, formatPoints(run.at(-1))));
      }))),
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Alle Halbjahre'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Fach'), state.settings.halbjahre.map((x) => h('th', {}, x)))),
        h('tbody', {}, subjects.map((s) => h('tr', {},
          h('td', {}, s.short || s.name),
          state.settings.halbjahre.map((x) => {
            const a = averageFor(s, x).average;
            return h('td', { class: 'mono' }, a == null ? '–' : formatPoints(a));
          })))),
        h('tfoot', {}, h('tr', {}, h('th', {}, 'Ø'), trend.map((t) => h('th', { class: 'mono' }, t.value == null ? '–' : formatPoints(t.value)))))))),
    h('p', { class: 'muted small center' }, `Stand ${formatDate(new Date().toISOString().slice(0, 10), { day: '2-digit', month: '2-digit', year: 'numeric' })}`));
}
