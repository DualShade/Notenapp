import { h, icon, empty, openModal, toast, formatDate, formatDateTime, field, setChildren } from '../ui.js';
import { getState, update, kindOf } from '../store.js';
import { todayIso } from '../timetable.js';
import {
  server, klausurProposals, importKlausuren, ignoreProposals, proposalToItem, liveKlausurPages,
  pdfToPages, fetchExternal, planCalendar, serverPlans,
} from '../data.js';
import { resolvePlanCode } from '../klausur-calendar.js';
import { activeSubjects, subjectById, klausurRow, openKlausurEditor, openGradeEditor, colorDot } from './common.js';
import { klausurKey } from '../klausur-parser.js';
import { downloadIcs } from '../ics.js';

/**
 * Kalender-Pläne: Pro Fach das eigene Kürzel wählen (z. B. Mathe → "M4").
 * Vorschlag aus Untis-Kurs und Groß-/Kleinschreibung; die Wahl wird im Fach
 * gespeichert (und synchronisiert), künftige Importe laufen automatisch.
 */
function courseMapping(calendar, rerender, ui) {
  const subjects = activeSubjects().map((s) => ({ ...s, kind: kindOf(s) }));
  const setCode = (id, code) => {
    update((st) => { const x = st.subjects.find((y) => y.id === id); if (x) x.planCode = code; }, { silent: true });
    rerender();
  };
  const open = subjects.filter((s) => !resolvePlanCode(s, calendar).code && s.planCode !== '-').length;
  // Einmal geöffnet bleibt der Bereich offen, bis man ihn selbst schließt
  ui.open ??= open > 0;
  return h('details', { class: 'card mapping', open: ui.open, ontoggle: (e) => { ui.open = e.target.open; } },
    h('summary', {}, `Deine Kurse im Plan${open ? ` · ${open} offen` : ' ✓'}`),
    h('p', { class: 'muted small' }, calendar.caseSensitive
      ? 'Dieser Plan unterscheidet Groß- und Kleinschreibung: groß (z. B. M2) = Leistungsfach, klein (m2) = Basisfach. Wähle einmal dein Kürzel pro Fach – das merkt sich die App.'
      : 'Wähle einmal dein Kürzel pro Fach – das merkt sich die App für künftige Importe.'),
    h('div', { class: 'list compact' }, subjects.map((s) => {
      const res = resolvePlanCode(s, calendar);
      const current = s.planCode === '-' ? '-' : res.code ?? '';
      const others = calendar.codes.filter((c) => !res.options.includes(c));
      return h('div', { class: 'list-item mapping-row' },
        colorDot(s),
        h('div', { class: 'grow' }, h('div', { class: 'title' }, s.name, ' ', h('span', { class: `badge ${s.kind === 'LK' ? 'lk' : 'gk'}` }, s.kind)),
          h('div', { class: 'sub' }, mappingHint(s, res, current))),
        h('select', { class: `small-select${current ? '' : ' needs-choice'}`, 'aria-label': `Kürzel für ${s.name}`, onchange: (e) => setCode(s.id, e.target.value || null) },
          h('option', { value: '', selected: current === '' }, '– wählen –'),
          res.options.length ? h('optgroup', { label: 'Passend' }, res.options.map((c) => h('option', { value: c, selected: c === current }, c))) : null,
          h('optgroup', { label: 'Alle Kürzel' }, others.map((c) => h('option', { value: c, selected: c === current }, c))),
          h('option', { value: '-', selected: current === '-' }, 'nicht im Plan')));
    })));
}

function mappingHint(subject, res, current) {
  if (current === '-') return 'nicht im Plan';
  if (current) {
    return {
      manual: 'von dir gewählt',
      untis: 'aus Untis erkannt',
      termine: 'über Klausurtermine in Untis erkannt',
      eindeutig: 'eindeutig im Plan',
    }[res.source] ?? 'automatisch erkannt';
  }
  const untis = [...new Set([subject.group, ...(subject.untisLabels ?? [])].filter(Boolean))].slice(0, 4).join(', ');
  const choose = res.options.length ? `bitte wählen: ${res.options.join(', ')}` : 'kein passendes Kürzel gefunden';
  return untis ? `${choose} · Untis: ${untis}` : choose;
}

/** Vorschau-Liste: Benutzer wählt aus, welche Termine übernommen werden. */
function previewList(source, close) {
  const stufe = { value: source.stufe ?? getState().settings.klausurSource.stufe ?? '' };
  const wrap = h('div', { class: 'stack' });
  const calendar = planCalendar(source.pages);
  const mappingUi = {};
  const render = () => {
    const proposals = klausurProposals(source.pages, { stufe: stufe.value });
    const matched = proposals.filter((p) => p.subjectId);
    const unmatched = proposals.filter((p) => !p.subjectId);
    const selected = new Map(matched.filter((p) => p.sure).map((p) => [p.key, p]));
    const assigned = new Map();
    const subjects = activeSubjects();

    const row = (p) => {
      const subject = subjectById(p.subjectId);
      return h('label', { class: 'check-row' },
        h('input', { type: 'checkbox', checked: selected.has(p.key), onchange: (e) => { if (e.target.checked) selected.set(p.key, p); else selected.delete(p.key); } }),
        colorDot(subject),
        h('div', { class: 'grow' },
          h('div', { class: 'title' }, formatDate(p.candidate.date), ' · ', subject?.name,
            p.candidate.title ? h('span', { class: 'tag' }, p.candidate.title) : null,
            p.sure || p.candidate.title ? null : h('span', { class: 'tag warn' }, 'unsicher')),
          h('div', { class: 'sub mono' }, [p.candidate.code, p.candidate.periods].filter(Boolean).join(' · ') || p.candidate.text)));
    };
    const unmatchedRow = (p, i) => h('div', { class: 'check-row' },
      h('div', { class: 'grow' },
        h('div', { class: 'title' }, formatDate(p.candidate.date), p.candidate.periods ? ` · ${p.candidate.periods}` : ''),
        h('div', { class: 'sub mono' }, p.candidate.text)),
      h('select', { class: 'small-select', onchange: (e) => { if (e.target.value) assigned.set(i, { ...p, subjectId: e.target.value }); else assigned.delete(i); } },
        h('option', { value: '' }, '– zuordnen –'),
        subjects.map((s) => h('option', { value: s.id }, `${s.short || s.name} (${kindOf(s)})`))));

    setChildren(wrap,
      h('p', { class: 'muted small' }, source.label),
      calendar ? courseMapping(calendar, render, mappingUi) : field('Stufe/Filter (optional)', h('input', { type: 'text', value: stufe.value, placeholder: 'z. B. Q1', onchange: (e) => { stufe.value = e.target.value.trim(); render(); } }),
        'Nur Seiten berücksichtigen, auf denen dieser Text vorkommt.'),
      matched.length
        ? h('div', { class: 'stack' }, h('h3', { class: 'card-title' }, `Gefundene Termine (${matched.length})`), h('div', { class: 'list' }, matched.map(row)))
        : h('p', { class: 'muted' }, calendar
          ? 'Noch keine Termine – wähle oben für deine Fächer das passende Kürzel aus dem Plan.'
          : 'Keine neuen Termine für deine Fächer gefunden. Unter „Weitere Termine“ kannst du Zeilen selbst zuordnen, oder in einem Fach weitere Namen hinterlegen.'),
      unmatched.length ? h('details', { class: 'more' },
        h('summary', {}, `Weitere Termine ohne Zuordnung (${unmatched.length})`),
        h('div', { class: 'list' }, unmatched.map(unmatchedRow))) : null,
      h('label', { class: 'switch' }, h('input', { type: 'checkbox', id: 'ignore-rest', checked: true }), h('span', {}, 'Nicht ausgewählte Vorschläge künftig ausblenden')),
      h('div', { class: 'row gap end' },
        h('button', { class: 'btn ghost', onclick: close }, 'Abbrechen'),
        h('button', { class: 'btn primary', onclick: () => {
          const items = [...selected.values(), ...assigned.values()];
          importKlausuren(items.map(proposalToItem), { sourceUrl: source.pdfUrl });
          if (wrap.querySelector('#ignore-rest')?.checked) {
            ignoreProposals(matched.filter((p) => !selected.has(p.key)).map((p) => p.key));
          }
          toast(`${items.length} Termin${items.length === 1 ? '' : 'e'} übernommen.`, 'success');
          close();
        } }, icon('check', 18), 'Übernehmen')));
  };
  render();
  return wrap;
}

/** Import-Dialog. mode: 'server' öffnet direkt die Vorschau der Action-Daten. */
export function openKlausurImport(mode = null) {
  openModal('Klausurplan importieren', (close) => {
    const body = h('div', { class: 'stack' });
    const showPreview = (source) => body.replaceChildren(previewList(source, close));
    const busy = (text) => body.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text));
    const fail = (err) => { toast(err.message, 'error'); renderChoices(); };

    const fromServer = () => showPreview({
      pages: server.klausuren.pages,
      pdfUrl: server.klausuren.pdfUrl,
      stufe: server.klausuren.stufe,
      label: `Klausurplan von der Homepage, automatisch abgerufen am ${formatDateTime(server.klausuren.fetchedAt)}.`,
    });
    const fromLive = async () => {
      busy('Lade aktuellen Klausurplan von der Homepage …');
      try {
        const res = await liveKlausurPages();
        showPreview({ ...res, label: `Live abgerufen: ${res.pdfUrl}` });
      } catch (err) { fail(err); }
    };
    const fromFile = async (file) => {
      if (!file) return;
      busy(`Lese ${file.name} …`);
      try {
        showPreview({ pages: await pdfToPages(await file.arrayBuffer()), label: `Datei: ${file.name}` });
      } catch (err) { fail(new Error(`PDF konnte nicht gelesen werden: ${err.message}`)); }
    };
    const fromUrl = async (url) => {
      if (!url) return;
      busy('Lade PDF …');
      try {
        showPreview({ pages: await pdfToPages(await fetchExternal(url, 'buffer')), pdfUrl: url, label: url });
      } catch (err) { fail(err); }
    };

    const renderChoices = () => {
      const src = getState().settings.klausurSource;
      const urlInput = h('input', { type: 'url', placeholder: 'https://schule.de/klausurplan.pdf' });
      setChildren(body,
        h('p', { class: 'muted small' }, 'Die Termine werden deinen Fächern anhand von Kursnamen (z. B. „M-L1“), Fachnamen und Kürzeln zugeordnet. Du siehst vor dem Übernehmen eine Vorschau.'),
        server.klausuren ? h('button', { class: 'choice', onclick: fromServer },
          icon('refresh', 22),
          h('div', { class: 'grow' }, h('strong', {}, 'Aktueller Plan von der Homepage'), h('div', { class: 'sub' }, `Automatisch abgerufen ${formatDateTime(server.klausuren.fetchedAt)}`))) : null,
        src.pageUrl || src.pdfUrl ? h('button', { class: 'choice', onclick: fromLive },
          icon('link', 22),
          h('div', { class: 'grow' }, h('strong', {}, 'Jetzt live abrufen'), h('div', { class: 'sub' }, src.pdfUrl || src.pageUrl))) : null,
        h('label', { class: 'choice' },
          icon('upload', 22),
          h('div', { class: 'grow' }, h('strong', {}, 'PDF-Datei auswählen'), h('div', { class: 'sub' }, 'Klausurplan vom Gerät')),
          h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true, onchange: (e) => fromFile(e.target.files[0]) })),
        h('form', { class: 'row gap', onsubmit: (e) => { e.preventDefault(); fromUrl(urlInput.value.trim()); } },
          urlInput, h('button', { class: 'btn', type: 'submit' }, 'Laden')),
        !server.klausuren && !src.pageUrl ? h('p', { class: 'hint' }, 'Tipp: Hinterlege in den Einstellungen bzw. in der GitHub Action die Homepage-URL, dann wird der Klausurplan automatisch immer aktuell abgerufen.') : null);
    };

    if (mode === 'server' && server.klausuren) fromServer();
    else renderChoices();
    return body;
  }, { wide: true });
}

export function klausurenView() {
  const state = getState();
  const today = todayIso();
  const list = [...state.klausuren].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = list.filter((k) => k.date >= today);
  const past = list.filter((k) => k.date < today).reverse();
  const hasGrade = (k) => state.grades.some((g) => g.subjectId === k.subjectId && g.date === k.date && g.type === 'klausur');

  return h('div', { class: 'view' },
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn primary', onclick: () => openKlausurImport() }, icon('file', 18), 'Klausurplan importieren'),
      h('button', { class: 'btn ghost', onclick: () => openKlausurEditor() }, icon('plus', 18), 'Termin'),
      h('button', { class: 'btn ghost', title: 'Klausuren & Hausaufgaben als Kalender-Datei', onclick: () => downloadIcs(getState()) }, icon('calendar', 18), 'In Kalender')),
    server.klausuren ? h('p', { class: 'muted small' },
      'Von der Homepage: ',
      serverPlans().flatMap((p, i) => [i ? ', ' : null, h('a', { href: p.url, target: '_blank', rel: 'noopener' }, p.label)]),
      ` · Stand ${formatDateTime(server.klausuren.fetchedAt)}`) : null,
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, `Anstehend (${upcoming.length})`),
      upcoming.length ? h('div', { class: 'list' }, upcoming.map((k) => klausurRow(k, today)))
        : empty('Keine Termine', 'Importiere den Klausurplan oder lege Termine manuell an.')),
    past.length ? h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Vergangen'),
      h('div', { class: 'list' }, past.map((k) => h('div', { class: 'row gap center' },
        h('div', { class: 'grow' }, klausurRow(k, today)),
        hasGrade(k) ? h('span', { class: 'tag ok' }, icon('check', 14), 'Note') : h('button', {
          class: 'btn small',
          onclick: () => openGradeEditor(k.subjectId, null, { type: 'klausur', date: k.date, title: k.title, halbjahr: k.halbjahr ?? state.settings.halbjahr }),
        }, 'Note eintragen'))))) : null);
}

export { klausurKey };
