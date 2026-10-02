// Gemeinsame Bausteine der Ansichten.

import { h, icon, openModal, field, toast, confirmDialog, formatDate } from '../ui.js';
import { getState, update, uid, kindOf, subjectWeights, nextColor, SUBJECT_COLORS } from '../store.js';
import { subjectAverage, pointsTone, formatPoints, formatNoteValue, pointsLabel, POINT_LABELS, GRADE_TYPES, weightPercent, formatRatio } from '../grades.js';
import { todayIso } from '../timetable.js';

export function subjectById(id) {
  return getState().subjects.find((s) => s.id === id) ?? null;
}

export function gradesFor(subjectId, halbjahr = getState().settings.halbjahr) {
  return getState().grades.filter((g) => g.subjectId === subjectId && g.halbjahr === halbjahr);
}

export function averageFor(subject, halbjahr) {
  return subjectAverage(gradesFor(subject.id, halbjahr), subjectWeights(subject));
}

export function activeSubjects() {
  const order = { LK: 0, GK: 1 };
  return getState().subjects
    .filter((s) => !s.archived)
    .sort((a, b) => order[kindOf(a)] - order[kindOf(b)] || a.name.localeCompare(b.name, 'de'));
}

export function kindBadge(subject) {
  const kind = kindOf(subject);
  const title = subject.kindOverride
    ? 'manuell festgelegt'
    : subject.hours != null ? `automatisch: ${String(subject.hours).replace('.', ',')} Wochenstunden` : 'Standard';
  return h('span', { class: `badge ${kind === 'LK' ? 'lk' : 'gk'}`, title }, kind);
}

export function colorDot(subject) {
  return h('span', { class: 'dot', style: { background: subject?.color ?? 'var(--muted)' } });
}

export function pointsPill(points, { big = false, digits = 1 } = {}) {
  return h('span', { class: `pill ${pointsTone(points)}${big ? ' big' : ''}` }, formatPoints(points, digits));
}

/** Großer Schnitt-Block: Punkte + Notenäquivalent. */
export function averageBlock(points, label) {
  return h('div', { class: 'avg-block' },
    h('div', { class: `avg-points ${pointsTone(points)}` }, formatPoints(points)),
    h('div', { class: 'avg-meta' },
      h('span', {}, label),
      h('strong', {}, points == null ? 'noch keine Noten' : `≈ Note ${formatNoteValue(points)} (${pointsLabel(points)})`)));
}

/** Auswahl 15 … 0 Punkte als Kachelraster. */
export function pointsPicker(value, onChange) {
  const wrap = h('div', { class: 'points-grid', role: 'radiogroup', 'aria-label': 'Punkte' });
  const render = () => {
    wrap.replaceChildren(...Array.from({ length: 16 }, (_, i) => 15 - i).map((p) => h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(p === value),
      class: `points-btn ${pointsTone(p)}${p === value ? ' selected' : ''}`,
      onclick: () => { value = p; onChange(p); render(); },
    }, h('strong', {}, String(p)), h('small', {}, POINT_LABELS[p]))));
  };
  render();
  return wrap;
}

export function openGradeEditor(subjectId, grade = null, preset = {}) {
  const state = getState();
  const draft = grade ? { ...grade } : {
    id: uid(), subjectId: subjectId ?? activeSubjects()[0]?.id ?? null, halbjahr: state.settings.halbjahr, type: 'klausur', points: null,
    date: todayIso(), title: '', weight: 1, ...preset,
  };
  openModal(grade ? 'Note bearbeiten' : 'Note eintragen', (close) => {
    const subjectSelect = h('select', { onchange: (e) => { draft.subjectId = e.target.value; } },
      activeSubjects().map((s) => h('option', { value: s.id, selected: s.id === draft.subjectId }, `${s.name} (${kindOf(s)})`)));
    const typeSelect = h('select', { onchange: (e) => { draft.type = e.target.value; } },
      Object.entries(GRADE_TYPES).map(([k, t]) => h('option', { value: k, selected: k === draft.type }, t.label)));
    const halbjahrSelect = h('select', { onchange: (e) => { draft.halbjahr = e.target.value; } },
      state.settings.halbjahre.map((hj) => h('option', { value: hj, selected: hj === draft.halbjahr }, hj)));
    const save = () => {
      if (draft.points == null) { toast('Bitte eine Punktzahl wählen.', 'error'); return; }
      if (!draft.subjectId) { toast('Bitte ein Fach wählen.', 'error'); return; }
      update((s) => {
        const i = s.grades.findIndex((g) => g.id === draft.id);
        if (i >= 0) s.grades[i] = draft; else s.grades.push(draft);
      });
      toast('Note gespeichert.', 'success');
      close();
    };
    return h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
      subjectId ? null : field('Fach', subjectSelect),
      pointsPicker(draft.points, (p) => { draft.points = p; }),
      h('div', { class: 'grid-2' },
        field('Art', typeSelect),
        field('Halbjahr', halbjahrSelect)),
      h('div', { class: 'grid-2' },
        field('Datum', h('input', { type: 'date', value: draft.date ?? '', onchange: (e) => { draft.date = e.target.value; } })),
        field('Gewichtung', h('input', { type: 'number', min: '0.25', step: '0.25', value: draft.weight ?? 1, onchange: (e) => { draft.weight = Number(e.target.value) || 1; } }))),
      field('Beschreibung (optional)', h('input', { type: 'text', value: draft.title ?? '', placeholder: 'z. B. Klausur Analysis', oninput: (e) => { draft.title = e.target.value; } })),
      h('div', { class: 'row gap end' },
        grade ? h('button', { type: 'button', class: 'btn danger ghost', onclick: async () => {
          if (!(await confirmDialog('Diese Note löschen?'))) return;
          update((s) => { s.grades = s.grades.filter((g) => g.id !== draft.id); });
          close();
        } }, icon('trash', 18), 'Löschen') : null,
        h('button', { type: 'submit', class: 'btn primary' }, icon('check', 18), 'Speichern')));
  });
}

const RATIO_PRESETS = [[1, 1], [2, 1], [3, 1], [1, 2]];

/**
 * Eingabe "Schriftlich : Mündlich" als Verhältnis (z. B. 2 : 1) mit Schnellwahl.
 * Gibt ein Element zurück; el.setValue(w) und el.setDisabled(bool) steuern es von außen.
 */
export function ratioInput(weights, onChange, { disabled = false } = {}) {
  let value = { schriftlich: Number(weights.schriftlich), muendlich: Number(weights.muendlich) };
  const num = (key) => h('input', {
    type: 'number', min: '0', step: '0.5', inputmode: 'decimal', class: 'ratio-num', 'aria-label': key === 'schriftlich' ? 'Schriftlich' : 'Mündlich',
    oninput: (e) => {
      const v = Math.max(0, Number(String(e.target.value).replace(',', '.')) || 0);
      value = { ...value, [key]: v };
      if (value.schriftlich + value.muendlich > 0) { onChange({ ...value }); sync(false); }
    },
  });
  const sInput = num('schriftlich');
  const mInput = num('muendlich');
  const hint = h('small', { class: 'hint' });
  const presets = RATIO_PRESETS.map(([a, b]) => h('button', {
    type: 'button', class: 'chip-btn',
    onclick: () => { value = { schriftlich: a, muendlich: b }; onChange({ ...value }); sync(true); },
  }, `${a}:${b}`));
  const sync = (inputs) => {
    if (inputs) { sInput.value = value.schriftlich; mInput.value = value.muendlich; }
    hint.textContent = `${weightPercent(value, 'schriftlich')} % schriftlich · ${weightPercent(value, 'muendlich')} % mündlich`;
    presets.forEach((p, i) => p.classList.toggle('active', RATIO_PRESETS[i][0] / RATIO_PRESETS[i][1] === value.schriftlich / value.muendlich));
  };
  const el = h('div', { class: 'ratio' },
    h('div', { class: 'row gap center wrap' },
      h('span', { class: 'ratio-label' }, 'S'), sInput, h('strong', {}, ':'), mInput, h('span', { class: 'ratio-label' }, 'M'),
      h('div', { class: 'row gap wrap' }, presets)),
    hint);
  el.setValue = (w) => { value = { schriftlich: Number(w.schriftlich), muendlich: Number(w.muendlich) }; sync(true); };
  el.setDisabled = (d) => { [sInput, mInput, ...presets].forEach((x) => { x.disabled = d; }); el.classList.toggle('disabled', d); };
  sync(true);
  el.setDisabled(disabled);
  return el;
}

export function openSubjectEditor(subject = null) {
  const state = getState();
  const draft = subject ? structuredClone(subject) : {
    id: uid(), name: '', short: '', color: nextColor(state.subjects), aliases: [], kindOverride: null, createdAt: Date.now(),
  };
  openModal(subject ? 'Fach bearbeiten' : 'Neues Fach', (close) => {
    const weightsCustom = !!draft.weights;
    const weightInput = ratioInput(subjectWeights(draft), (w) => { draft.weights = w; }, { disabled: !weightsCustom });
    const colors = h('div', { class: 'colors' }, SUBJECT_COLORS.map((c) => h('button', {
      type: 'button', class: `color-swatch${c === draft.color ? ' selected' : ''}`, style: { background: c }, 'aria-label': `Farbe ${c}`,
      onclick: (e) => { draft.color = c; e.currentTarget.parentElement.querySelectorAll('.color-swatch').forEach((b) => b.classList.toggle('selected', b === e.currentTarget)); },
    })));
    const save = () => {
      if (!draft.name.trim()) { toast('Bitte einen Namen eingeben.', 'error'); return; }
      update((s) => {
        const i = s.subjects.findIndex((x) => x.id === draft.id);
        if (i >= 0) s.subjects[i] = draft; else s.subjects.push(draft);
      });
      close();
    };
    return h('form', { class: 'stack', onsubmit: (e) => { e.preventDefault(); save(); } },
      h('div', { class: 'grid-2' },
        field('Name', h('input', { type: 'text', required: true, value: draft.name, placeholder: 'Mathematik', oninput: (e) => { draft.name = e.target.value; } })),
        field('Kürzel', h('input', { type: 'text', value: draft.short ?? '', placeholder: 'M', oninput: (e) => { draft.short = e.target.value; } }))),
      field('Kursart', h('select', { onchange: (e) => { draft.kindOverride = e.target.value || null; } },
        h('option', { value: '', selected: !draft.kindOverride }, draft.kindAuto ? `Automatisch (${draft.kindAuto}, ${String(draft.hours).replace('.', ',')} Std.)` : 'Automatisch (GK)'),
        h('option', { value: 'LK', selected: draft.kindOverride === 'LK' }, 'Leistungskurs (LK)'),
        h('option', { value: 'GK', selected: draft.kindOverride === 'GK' }, 'Grundkurs (GK)')),
      draft.untisKey ? `Aus Untis: Kurs ${draft.untisKey}` : 'Manuell angelegt – LK/GK wird erkannt, sobald das Fach im Untis-Stundenplan vorkommt.'),
      field('Farbe', colors),
      h('div', { class: 'field' },
        h('label', { class: 'switch' },
          h('input', { type: 'checkbox', checked: weightsCustom, onchange: (e) => {
            weightInput.setDisabled(!e.target.checked);
            draft.weights = e.target.checked ? { ...subjectWeights(draft) } : null;
            if (!e.target.checked) weightInput.setValue(subjectWeights(draft));
          } }),
          h('span', {}, 'Eigene Gewichtung für dieses Fach', h('small', { class: 'hint block' }, `Standard für ${kindOf(draft)}: ${formatRatio(getState().settings.weights[kindOf(draft)])} (schriftlich : mündlich)`))),
        weightInput),
      field('Weitere Namen im Klausurplan', h('input', {
        type: 'text', value: (draft.aliases ?? []).join(', '), placeholder: 'z. B. Mathe, MA-L1',
        oninput: (e) => { draft.aliases = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); },
      }), 'Kommagetrennt. Hilft beim Zuordnen der Klausurtermine aus der PDF.'),
      h('div', { class: 'row gap end wrap' },
        subject ? h('button', { type: 'button', class: 'btn ghost', onclick: () => {
          update((s) => { const x = s.subjects.find((y) => y.id === draft.id); if (x) x.archived = !x.archived; });
          close();
        } }, subject.archived ? 'Wiederherstellen' : 'Ausblenden') : null,
        subject ? h('button', { type: 'button', class: 'btn danger ghost', onclick: async () => {
          if (!(await confirmDialog(`„${draft.name}“ mit allen Noten und Klausuren löschen?`))) return;
          update((s) => {
            s.subjects = s.subjects.filter((x) => x.id !== draft.id);
            s.grades = s.grades.filter((g) => g.subjectId !== draft.id);
            s.klausuren = s.klausuren.filter((k) => k.subjectId !== draft.id);
          });
          close();
          location.hash = '#/faecher';
        } }, icon('trash', 18), 'Löschen') : null,
        h('button', { type: 'submit', class: 'btn primary' }, icon('check', 18), 'Speichern')));
  });
}

export function openKlausurEditor(klausur = null, preset = {}) {
  const draft = klausur ? { ...klausur } : { id: uid(), subjectId: activeSubjects()[0]?.id ?? null, date: todayIso(), title: 'Klausur', info: '', source: 'manual', halbjahr: getState().settings.halbjahr, ...preset };
  openModal(klausur ? 'Termin bearbeiten' : 'Neuer Termin', (close) => h('form', { class: 'stack', onsubmit: (e) => {
    e.preventDefault();
    if (!draft.subjectId) { toast('Bitte zuerst ein Fach anlegen.', 'error'); return; }
    update((s) => {
      const i = s.klausuren.findIndex((k) => k.id === draft.id);
      if (i >= 0) s.klausuren[i] = draft; else s.klausuren.push(draft);
    });
    close();
  } },
  field('Fach', h('select', { onchange: (e) => { draft.subjectId = e.target.value; } },
    activeSubjects().map((s) => h('option', { value: s.id, selected: s.id === draft.subjectId }, `${s.name} (${kindOf(s)})`)))),
  h('div', { class: 'grid-2' },
    field('Datum', h('input', { type: 'date', required: true, value: draft.date, onchange: (e) => { draft.date = e.target.value; } })),
    field('Art', h('input', { type: 'text', value: draft.title, list: 'klausur-types', oninput: (e) => { draft.title = e.target.value; } }))),
  h('datalist', { id: 'klausur-types' }, ['Klausur', 'Nachschreibklausur', 'Test', 'Referat', 'Facharbeit'].map((t) => h('option', { value: t }))),
  field('Notiz', h('textarea', { rows: 2, oninput: (e) => { draft.info = e.target.value; } }, draft.info ?? '')),
  draft.raw ? h('p', { class: 'muted small' }, 'Zeile im Klausurplan: ', h('span', { class: 'mono' }, draft.raw)) : null,
  h('div', { class: 'row gap end' },
    klausur ? h('button', { type: 'button', class: 'btn danger ghost', onclick: async () => {
      if (!(await confirmDialog('Diesen Termin löschen?'))) return;
      update((s) => {
        s.klausuren = s.klausuren.filter((k) => k.id !== draft.id);
        // Gelöschte PDF-Termine nicht erneut vorschlagen
        if (draft.source === 'pdf') s.ignoredKlausurKeys.push(`${draft.date}|${draft.subjectId}`);
      });
      close();
    } }, icon('trash', 18), 'Löschen') : null,
    h('button', { type: 'submit', class: 'btn primary' }, icon('check', 18), 'Speichern'))));
}

export function klausurRow(k, today) {
  const subject = subjectById(k.subjectId);
  const days = Math.round((new Date(`${k.date}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000);
  let when = formatDate(k.date);
  if (days === 0) when = 'Heute';
  else if (days === 1) when = 'Morgen';
  return h('button', { class: 'list-item', title: k.raw ?? '', onclick: () => openKlausurEditor(k) },
    colorDot(subject),
    h('div', { class: 'grow' },
      h('div', { class: 'title' }, subject?.name ?? 'Unbekanntes Fach', ' ', subject ? kindBadge(subject) : null),
      h('div', { class: 'sub' }, [k.title, k.info].filter(Boolean).join(' · '))),
    h('div', { class: 'right' },
      h('div', { class: 'when' }, when),
      days > 1 ? h('div', { class: 'sub' }, `in ${days} Tagen`) : null,
      k.source === 'pdf' ? h('div', { class: 'tag' }, 'PDF') : null));
}
