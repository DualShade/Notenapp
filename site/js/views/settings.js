import { h, icon, field, toast, confirmDialog, formatDateTime } from '../ui.js';
import { getState, update, replaceState, resetState } from '../store.js';
import { server, hasProxy, syncSubjectsWithTimetable, untisAccount, refreshUntis, disconnectUntis, currentTimetable } from '../data.js';
import { openUntisConnect } from './untis-connect.js';
import { APP_CONFIG } from '../config.js';
import { ratioInput } from './common.js';
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

function untisCard() {
  const account = untisAccount();
  const timetable = currentTimetable();
  if (!account) {
    return h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'Untis-Konto'),
      h('p', { class: 'muted small' }, 'Verbinde dein WebUntis-Konto: Schule suchen, Benutzername und Passwort eingeben – der Stundenplan wird dann bei jedem Öffnen automatisch aktualisiert.'),
      h('button', { class: 'btn primary', onclick: openUntisConnect }, icon('link', 18), 'Mit Untis verbinden'),
      proxySettings());
  }
  return h('section', { class: 'card' },
    h('h3', { class: 'card-title' }, 'Untis-Konto'),
    h('div', { class: 'choice' },
      icon('home', 22),
      h('div', { class: 'grow' },
        h('strong', {}, account.schoolName || account.school),
        h('div', { class: 'sub' }, `${account.username} · Stand ${timetable?.origin === 'live' ? formatDateTime(timetable.fetchedAt) : '–'}`))),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn', onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const { timetable: tt, created } = await refreshUntis();
          toast(`${tt.lessons.length} Stunden geladen${created ? `, ${created} Fächer angelegt` : ''}.`, 'success');
        } catch (err) {
          toast(err.message, 'error');
        } finally { btn.disabled = false; }
      } }, icon('refresh', 18), 'Jetzt aktualisieren'),
      h('button', { class: 'btn ghost', onclick: openUntisConnect }, 'Konto ändern'),
      h('button', { class: 'btn danger ghost', onclick: async () => {
        if (await confirmDialog('Untis-Konto von diesem Gerät entfernen? Deine Noten bleiben erhalten.', { ok: 'Abmelden' })) disconnectUntis();
      } }, 'Abmelden')),
    proxySettings());
}

function proxySettings() {
  const custom = getState().settings.proxyUrl?.trim();
  return h('details', { class: 'more' },
    h('summary', { class: 'small' }, 'Erweitert: Proxy'),
    h('p', { class: 'muted small' }, APP_CONFIG.proxyUrl
      ? `Standardmäßig wird ${APP_CONFIG.proxyUrl} benutzt – hier musst du nichts eintragen.`
      : 'Für den Untis-Login braucht die App einen kleinen Proxy (siehe README).'),
    text(['proxyUrl'], 'Anderen Proxy verwenden (optional)', { placeholder: APP_CONFIG.proxyUrl || 'https://example.com/notenapp-proxy.php', type: 'url', rerender: true }),
    custom && APP_CONFIG.proxyUrl ? h('button', { class: 'btn ghost small', onclick: () => update((s) => { s.settings.proxyUrl = ''; }) }, 'Standard-Proxy verwenden') : null);
}

export function settingsView() {
  const { settings } = getState();
  const status = server.status;

  return h('div', { class: 'view' },
    untisCard(),

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
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Leistungskurse: schriftlich : mündlich'),
        ratioInput(settings.weights.LK, (w) => update((s) => { s.settings.weights.LK = w; }, { silent: true }))),
      h('div', { class: 'field' },
        h('span', { class: 'field-label' }, 'Grundkurse: schriftlich : mündlich'),
        ratioInput(settings.weights.GK, (w) => update((s) => { s.settings.weights.GK = w; }, { silent: true })),
        h('small', { class: 'hint' }, 'Abweichende Fächer stellst du im Fach unter „Bearbeiten“ ein.')),
      toggle('lkDouble', 'LKs im Gesamtschnitt doppelt gewichten', 'Wie bei der Abiturberechnung.')),

    h('section', { class: 'card' },
      h('h3', { class: 'card-title' }, 'LK/GK-Erkennung'),
      field('LK ab … Wochenstunden', h('input', {
        type: 'number', min: '1', max: '10', step: '0.5', value: settings.lkThreshold,
        onchange: (e) => { update((s) => { s.settings.lkThreshold = Number(e.target.value) || 4; }, { silent: true }); syncSubjectsWithTimetable(); update(() => {}); },
      }), 'LKs haben 5, GKs 3 Wochenstunden. Standard: ab 4 Stunden = LK.'),
      toggle('autoSubjects', 'Fächer automatisch aus Untis anlegen'),
      status?.untis && !status.untis.skipped ? h('ul', { class: 'status-list small' },
        statusLine(status.untis, 'GitHub-Action-Synchronisation'),
        server.timetable ? h('li', {}, `Stand: ${formatDateTime(server.timetable.fetchedAt)}`) : null) : null),

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
