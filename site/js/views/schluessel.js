import { h, field } from '../ui.js';
import { getState, update, activeScale } from '../store.js';
import { SCALE_PRESETS, scaleTable, percentToPoints, pointsTone, noteWord, formatNoteValue, POINT_LABELS } from '../grades.js';

// Eingaben überleben Re-Renders, ohne im Speicher zu landen.
const local = { max: 60, step: 0.5, achieved: '' };

function fmt(n) {
  return n == null ? '–' : String(n).replace('.', ',');
}

function calculator(scale, rerender) {
  const out = h('div', { class: 'calc-result' });
  const calc = () => {
    const a = Number(String(local.achieved).replace(',', '.'));
    if (local.achieved === '' || Number.isNaN(a) || !local.max) {
      out.replaceChildren(h('span', { class: 'muted' }, 'Erreichte Punktzahl eingeben …'));
      return;
    }
    const pct = Math.max(0, Math.min(100, (a / local.max) * 100));
    const points = percentToPoints(pct, scale);
    out.replaceChildren(
      h('div', { class: `avg-points ${pointsTone(points)}` }, String(points)),
      h('div', { class: 'avg-meta' },
        h('span', {}, `${fmt(Math.round(pct * 10) / 10)} % · ${POINT_LABELS[points]}`),
        h('strong', {}, `Note ${POINT_LABELS[points]} – ${noteWord(points)}`)));
  };
  calc();
  return h('section', { class: 'card' },
    h('h3', { class: 'card-title' }, 'Klausur-Rechner'),
    h('div', { class: 'grid-2' },
      field('Erreicht (BE)', h('input', { type: 'text', inputmode: 'decimal', value: local.achieved, placeholder: 'z. B. 47,5', oninput: (e) => { local.achieved = e.target.value; calc(); } })),
      field('Maximal (BE)', h('input', { type: 'number', min: '1', step: '0.5', value: local.max, onchange: (e) => { local.max = Math.max(1, Number(e.target.value) || 1); rerender(); } }))),
    out);
}

function customEditor(scale) {
  return h('details', { class: 'card' },
    h('summary', {}, 'Eigenen Schlüssel bearbeiten'),
    h('p', { class: 'muted small' }, 'Mindestprozentsatz je Punktzahl. Änderungen aktivieren automatisch den eigenen Schlüssel.'),
    h('div', { class: 'scale-edit' }, Array.from({ length: 15 }, (_, i) => 15 - i).map((p) => h('label', { class: 'scale-input' },
      h('span', { class: `grade-chip ${pointsTone(p)}` }, String(p)),
      h('input', {
        type: 'number', min: '0', max: '100', value: scale[p],
        onchange: (e) => update((s) => {
          const next = { ...activeScale(s.settings), [p]: Number(e.target.value) || 0 };
          s.settings.customScale = next;
          s.settings.scalePreset = 'custom';
        }),
      }), h('span', { class: 'muted' }, '%')))));
}

export function schluesselView() {
  const { settings } = getState();
  const scale = activeScale(settings);
  const rows = scaleTable(scale, local.max, local.step);
  const rerender = () => update(() => {});

  return h('div', { class: 'view' },
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Notenschlüssel (0–15 Punkte)'),
      h('div', { class: 'grid-3' },
        field('Schlüssel', h('select', { onchange: (e) => update((s) => { s.settings.scalePreset = e.target.value; if (e.target.value === 'custom' && !s.settings.customScale) s.settings.customScale = { ...scale }; }) },
          Object.entries(SCALE_PRESETS).map(([k, p]) => h('option', { value: k, selected: settings.scalePreset === k }, p.name)),
          h('option', { value: 'custom', selected: settings.scalePreset === 'custom' }, 'Eigener Schlüssel'))),
        field('Max. Punkte (BE)', h('input', { type: 'number', min: '1', step: '0.5', value: local.max, onchange: (e) => { local.max = Math.max(1, Number(e.target.value) || 1); rerender(); } })),
        field('Schritte', h('select', { onchange: (e) => { local.step = Number(e.target.value); rerender(); } },
          h('option', { value: '1', selected: local.step === 1 }, 'Ganze BE'),
          h('option', { value: '0.5', selected: local.step === 0.5 }, 'Halbe BE')))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'table scale' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Punkte'), h('th', {}, 'Note'), h('th', {}, 'Prozent'), h('th', {}, `BE (von ${fmt(local.max)})`))),
        h('tbody', {}, rows.map((r) => h('tr', { class: r.points === 4 ? 'pass-line' : '' },
          h('td', {}, h('span', { class: `grade-chip ${pointsTone(r.points)}` }, String(r.points))),
          h('td', {}, r.label, h('span', { class: 'muted small' }, ` ${noteWord(r.points)}`)),
          h('td', {}, r.points === 15 ? `ab ${r.minPct} %` : r.points === 0 ? `unter ${scale[1]} %` : `${r.minPct}–${r.maxPct} %`),
          h('td', { class: 'mono' }, r.minRaw === r.maxRaw ? fmt(r.minRaw) : `${fmt(r.minRaw)} – ${fmt(r.maxRaw)}`)))))),
      h('p', { class: 'muted small' }, 'Ab 5 Punkten (4) gilt eine Leistung als ausreichend; unter 5 Punkten zählt ein Kurs im Abitur als Unterkurs.')),
    calculator(scale, rerender),
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Punkte ↔ Note'),
      h('p', { class: 'muted small' }, 'Umrechnung nach der Formel Note = (17 − Punkte) ÷ 3, z. B. für Schnitte.'),
      h('div', { class: 'conv-grid' }, Array.from({ length: 16 }, (_, i) => 15 - i).map((p) => h('div', { class: `conv ${pointsTone(p)}` },
        h('strong', {}, String(p)), h('span', {}, POINT_LABELS[p]), h('small', {}, formatNoteValue(p)))))),
    customEditor(scale));
}
