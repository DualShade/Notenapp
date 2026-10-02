// App-Zustand im localStorage. Noten bleiben nur auf diesem Gerät.

import { SCALE_PRESETS } from './grades.js';
import { DEFAULT_LK_THRESHOLD } from './timetable.js';

const KEY = 'notenapp:v1';

export const SUBJECT_COLORS = [
  '#4f6df5', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#0d9488',
  '#d6409f', '#ca8a04', '#0090ff', '#7c6f64', '#46a758', '#e54666',
];

function defaultHalbjahr(now = new Date()) {
  return now.getMonth() + 1 >= 2 && now.getMonth() + 1 <= 7 ? 'Q1.2' : 'Q1.1';
}

export function defaultState() {
  return {
    version: 1,
    settings: {
      halbjahre: ['EF.1', 'EF.2', 'Q1.1', 'Q1.2', 'Q2.1', 'Q2.2'],
      halbjahr: defaultHalbjahr(),
      lkThreshold: DEFAULT_LK_THRESHOLD,
      lkDouble: false,
      weights: {
        LK: { schriftlich: 50, muendlich: 50 },
        GK: { schriftlich: 50, muendlich: 50 },
      },
      scalePreset: 'abitur',
      customScale: null,
      theme: 'auto',
      proxyUrl: '',
      untis: { server: '', school: '', schoolName: '', username: '', password: '' },
      klausurSource: { pageUrl: '', pdfUrl: '', linkPattern: 'klausur', stufe: '' },
      autoImportKlausuren: false,
      autoSubjects: true,
    },
    subjects: [],
    grades: [],
    klausuren: [],
    ignoredKlausurKeys: [],
    klausurSourceSeenAt: null,
    localTimetable: null,
  };
}

function merge(base, saved) {
  if (Array.isArray(base) || base === null || typeof base !== 'object') return saved ?? base;
  const out = { ...base };
  for (const [k, v] of Object.entries(saved ?? {})) {
    out[k] = k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(defaultState(), JSON.parse(raw));
  } catch {
    // Speicher nicht verfügbar oder kaputt → frisch starten
  }
  return defaultState();
}

let state = load();
const listeners = new Set();

export function getState() {
  return state;
}

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // z. B. privater Modus – App funktioniert trotzdem für diese Sitzung
  }
}

/** Zustand ändern: fn bekommt den Entwurf und mutiert ihn. */
export function update(fn, { silent = false } = {}) {
  fn(state);
  persist();
  if (!silent) listeners.forEach((l) => l(state));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function replaceState(next) {
  state = merge(defaultState(), next);
  persist();
  listeners.forEach((l) => l(state));
}

export function resetState() {
  replaceState(defaultState());
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function kindOf(subject) {
  return subject?.kindOverride ?? subject?.kindAuto ?? 'GK';
}

export function activeScale(settings = state.settings) {
  if (settings.scalePreset === 'custom' && settings.customScale) return settings.customScale;
  return (SCALE_PRESETS[settings.scalePreset] ?? SCALE_PRESETS.abitur).scale;
}

export function subjectWeights(subject, settings = state.settings) {
  return subject?.weights ?? settings.weights[kindOf(subject)] ?? { schriftlich: 50, muendlich: 50 };
}

export function nextColor(subjects) {
  const used = new Set(subjects.map((s) => s.color));
  return SUBJECT_COLORS.find((c) => !used.has(c)) ?? SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length];
}
