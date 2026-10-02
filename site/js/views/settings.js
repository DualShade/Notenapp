import { h, icon, field, toast, confirmDialog, formatDateTime } from '../ui.js';
import { getState, update, replaceState, resetState } from '../store.js';
import { server, hasProxy, liveUntisImport, syncSubjectsWithTimetable } from '../data.js';
import { openKlausurImport } from './klausuren.js';
import { loadDemo } from '../demo.js';

function text(path, label, opts = {}) {
  const [group, key, sub] = path;
  const settings = getState().settings;
  const value = sub ? settings[group][key]?.[sub] : key ? settings[group][key] : settings[group];
  return field(label, h('input', {
    type: opts.type ?? 'text',
    value: value ?? '',
    placeholder: opts.placeholder ?? '',
    autocomplete: opts.autocomplete ?? 'off',
    onchange: (e) => update((s) => {
      const v = opts.type === 'number' ? Number(e.target.value) : e.target.value.trim();
      if (sub) s.settings[group][key][sub] = v;
      else if (key) s.settings[group][key] = v;
      else s.settings[group] = v;
    }, { silent: !opts.rerender }),
  }), opts.hint);
}

function toggle(key, label, hint, after) {
  return h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked: !!getState().settings[key], onchange: (e) => { update((s) => { s.settings[key] = e.target.checked; }); after?.(); } }),
    h('span', {}, label, hint ? h('small', { class: 'hint block' }, hint) : null));
}

function statusLine(entry, label) {
  if (!entry) return h('li', {}, h('strong', {}, label), ': noch nie gelaufen');
  const cls = entry.ok ? 'ok' : entry.skipped ? 'muted' : 'danger';
  return h('li', {}, h('strong', {}, label), ': ', h('span', { class: cls }, entry.message ?? (entry.ok ? 'OK' : 'Fehler')));
}

function exportData() {
  const blob = new Blob([JSON.stringify(getState(), null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `notenapp-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.settings || !Array.isArray(data.subjects)) throw new Error('Keine gültige Notenapp-Sicherung.');
    if (!(await confirmDialog('Alle aktuellen Daten durch die Sicherung ersetzen?', { ok: 'Ersetzen' }))) return;
    replaceState(data);
    toast('Sicherung wiederhergestellt.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  }
}

export function settingsView() {
  const { settings } = getState();
  const status = server.status;

  return h('div', { class: 'view' },
    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Halbjahr & Bewertung'),
      h('div', { class: 'grid-2' },
        field('Aktuelles Halbjahr', h('select', { onchange: (e) => update((s) => { s.settings.halbjahr = e.target.value; }) },
          settings.halbjahre.map((hj) => h('option', { value: hj, selected: hj === settings.halbjahr }, hj)))),
        field('Halbjahre', h('input', {
          type: 'text', value: settings.halbjahre.join(', '),
          onchange: (e) => update((s) => {
            const list = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
            if (list.length) {
              s.settings.halbjahre = list;
              if (!list.includes(s.settings.halbjahr)) s.settings.halbjahr = list[0];
            }
          }),
        }), 'Kommagetrennt')),
      h('div', { class: 'grid-2' },
        field('LK: % schriftlich', h('input', { type: 'number', min: '0', max: '100', step: '5', value: settings.weights.LK.schriftlich,
          onchange: (e) => update((s) => { const v = Math.min(100, Math.max(0, Number(e.target.value) || 0)); s.settings.weights.LK = { schriftlich: v, muendlich: 100 - v }; }) }), 'Rest: Sonstige Mitarbeit'),
        field('GK: % schriftlich', h('input', { type: 'number', min: '0', max: '100', step: '5', value: settings.weights.GK.schriftlich,
          onchange: (e) => update((s) => { const v = Math.min(100, Math.max(0, Number(e.target.value) || 0)); s.settings.weights.GK = { schriftlich: v, muendlich: 100 - v }; }) }), 'Rest: Sonstige Mitarbeit')),
      toggle('lkDouble', 'LKs im Gesamtschnitt doppelt gewichten', 'Wie bei der Abiturberechnung.')),

    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Stundenplan aus WebUntis'),
      h('ul', { class: 'status-list small' },
        statusLine(status?.untis, 'Automatische Synchronisation'),
        server.timetable ? h('li', {}, `Letzter Stand: ${formatDateTime(server.timetable.fetchedAt)} · ${server.timetable.school ?? ''}`) : null),
      field('LK ab … Wochenstunden', h('input', {
        type: 'number', min: '1', max: '10', step: '0.5', value: settings.lkThreshold,
        onchange: (e) => { update((s) => { s.settings.lkThreshold = Number(e.target.value) || 4; }, { silent: true }); syncSubjectsWithTimetable(); update(() => {}); },
      }), 'LKs haben 5, GKs 3 Wochenstunden. Standard: ab 4 Stunden = LK.'),
      toggle('autoSubjects', 'Fächer automatisch aus Untis anlegen'),
      h('details', { class: 'more' },
        h('summary', {}, 'Live-Import direkt in der App (optional, mit Proxy)'),
        h('p', { class: 'muted small' }, 'Normalerweise lädt die GitHub Action den Stundenplan mehrmals täglich. Für einen sofortigen Abruf aus dem Browser wird wegen CORS ein kleiner Proxy benötigt (siehe proxy/worker.js). Die Zugangsdaten werden nur lokal auf diesem Gerät gespeichert.'),
        text(['proxyUrl'], 'Proxy-URL', { placeholder: 'https://notenapp-proxy.<name>.workers.dev', type: 'url', rerender: true }),
        h('div', { class: 'grid-2' },
          text(['untis', 'server'], 'Untis-Server', { placeholder: 'xyz.webuntis.com' }),
          text(['untis', 'school'], 'Schulname (Untis)', { placeholder: 'gym-musterstadt' })),
        h('div', { class: 'grid-2' },
          text(['untis', 'username'], 'Benutzername', { autocomplete: 'username' }),
          text(['untis', 'password'], 'Passwort', { type: 'password', autocomplete: 'current-password' })),
        h('button', { class: 'btn primary', disabled: !hasProxy(), onclick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try {
            const { timetable, created } = await liveUntisImport();
            toast(`${timetable.lessons.length} Stunden geladen${created ? `, ${created} Fächer angelegt` : ''}.`, 'success');
          } catch (err) {
            toast(err.message, 'error');
          } finally { btn.disabled = false; }
        } }, icon('refresh', 18), 'Jetzt live laden'))),

    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Klausurplan (PDF)'),
      h('ul', { class: 'status-list small' },
        statusLine(status?.klausuren, 'Automatischer Abruf'),
        server.klausuren ? h('li', {}, 'Quelle: ', h('a', { href: server.klausuren.pdfUrl, target: '_blank', rel: 'noopener' }, server.klausuren.pdfUrl)) : null),
      toggle('autoImportKlausuren', 'Neue Termine automatisch übernehmen', 'Nur eindeutig zugeordnete Termine. Sonst erscheint auf der Übersicht ein Hinweis zum Prüfen.'),
      h('details', { class: 'more' },
        h('summary', {}, 'Quelle für Live-Abruf in der App'),
        text(['klausurSource', 'pageUrl'], 'Homepage-Seite mit dem Klausurplan', { type: 'url', placeholder: 'https://www.schule.de/oberstufe/klausurplaene' }),
        h('div', { class: 'grid-2' },
          text(['klausurSource', 'linkPattern'], 'Linktext/Dateiname enthält', { placeholder: 'klausur' }),
          text(['klausurSource', 'stufe'], 'Stufe (Filter)', { placeholder: 'Q1' })),
        text(['klausurSource', 'pdfUrl'], 'Oder feste PDF-URL', { type: 'url', placeholder: 'https://www.schule.de/files/klausurplan.pdf' })),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn', onclick: () => openKlausurImport() }, icon('file', 18), 'Klausurplan importieren'),
        getState().ignoredKlausurKeys.length ? h('button', { class: 'btn ghost', onclick: () => { update((s) => { s.ignoredKlausurKeys = []; }); toast('Ausgeblendete Vorschläge werden wieder angezeigt.'); } }, 'Ausgeblendete zurücksetzen') : null)),

    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Darstellung'),
      field('Design', h('select', { onchange: (e) => update((s) => { s.settings.theme = e.target.value; }) },
        [['auto', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([v, l]) => h('option', { value: v, selected: settings.theme === v }, l))))),

    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Daten'),
      h('p', { class: 'muted small' }, 'Deine Noten werden nur auf diesem Gerät gespeichert. Erstelle regelmäßig eine Sicherung, um sie auf ein anderes Gerät zu übertragen.'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn', onclick: exportData }, icon('download', 18), 'Sicherung exportieren'),
        h('label', { class: 'btn' }, icon('upload', 18), 'Sicherung laden', h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: (e) => importData(e.target.files[0]) })),
        h('button', { class: 'btn ghost', onclick: loadDemo }, 'Demo-Daten'),
        h('button', { class: 'btn danger ghost', onclick: async () => {
          if (await confirmDialog('Alle Noten, Fächer und Einstellungen auf diesem Gerät löschen?')) { resetState(); toast('Alles zurückgesetzt.'); }
        } }, icon('trash', 18), 'Alles löschen'))));
}
