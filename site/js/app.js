import { h, icon, toast } from './ui.js';
import { getState, subscribe, update } from './store.js';
import { loadServerData, syncSubjectsWithTimetable, autoImportFromServer, untisAccount, hasProxy, refreshUntis } from './data.js';
import { overviewView } from './views/overview.js';
import { subjectsView, subjectDetailView } from './views/subjects.js';
import { timetableView } from './views/timetable-view.js';
import { klausurenView } from './views/klausuren.js';
import { schluesselView } from './views/schluessel.js';
import { settingsView } from './views/settings.js';

const TABS = [
  { path: '', label: 'Übersicht', icon: 'home', view: overviewView },
  { path: 'faecher', label: 'Fächer', icon: 'book', view: subjectsView },
  { path: 'plan', label: 'Plan', icon: 'calendar', view: timetableView },
  { path: 'klausuren', label: 'Klausuren', icon: 'clipboard', view: klausurenView },
  { path: 'schluessel', label: 'Schlüssel', icon: 'key', view: schluesselView },
];
const TITLES = { '': 'Notenapp', faecher: 'Fächer', fach: 'Fach', plan: 'Stundenplan', klausuren: 'Klausuren', schluessel: 'Notenschlüssel', einstellungen: 'Einstellungen' };

const main = document.getElementById('main');
const header = document.getElementById('header');
const nav = document.getElementById('nav');

function route() {
  const [, path = '', param] = location.hash.replace(/^#/, '').split('/');
  return { path, param };
}

function applyTheme() {
  const { theme } = getState().settings;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function renderHeader({ path }) {
  const { settings } = getState();
  header.replaceChildren(
    h('h1', {}, TITLES[path] ?? 'Notenapp'),
    h('div', { class: 'row gap center' },
      h('select', {
        class: 'halbjahr-select', 'aria-label': 'Halbjahr',
        onchange: (e) => update((s) => { s.settings.halbjahr = e.target.value; }),
      }, settings.halbjahre.map((hj) => h('option', { value: hj, selected: hj === settings.halbjahr }, hj))),
      h('a', { class: `icon-btn${path === 'einstellungen' ? ' active' : ''}`, href: '#/einstellungen', 'aria-label': 'Einstellungen' }, icon('settings'))));
}

function renderNav({ path }) {
  const active = path === 'fach' ? 'faecher' : path;
  nav.replaceChildren(...TABS.map((t) => h('a', {
    href: `#/${t.path}`,
    class: `tab${active === t.path ? ' active' : ''}`,
    'aria-current': active === t.path ? 'page' : null,
  }, icon(t.icon, 22), h('span', {}, t.label))));
}

let lastPath = null;
function render() {
  const r = route();
  applyTheme();
  renderHeader(r);
  renderNav(r);
  let view;
  if (r.path === 'fach') view = subjectDetailView(r.param);
  else if (r.path === 'einstellungen') view = settingsView();
  else view = (TABS.find((t) => t.path === r.path) ?? TABS[0]).view();
  const scroll = window.scrollY;
  main.replaceChildren(view);
  // Beim Seitenwechsel nach oben, bei Re-Render Position halten
  window.scrollTo(0, lastPath === location.hash ? scroll : 0);
  lastPath = location.hash;
}

const UNTIS_MAX_AGE = 15 * 60 * 1000;

/** Verbundenes Untis-Konto: Stundenplan beim Öffnen frisch laden. */
async function refreshUntisIfStale() {
  const local = getState().localTimetable;
  if (!untisAccount() || !hasProxy()) return 0;
  if (local && Date.now() - new Date(local.fetchedAt).getTime() < UNTIS_MAX_AGE) return 0;
  try {
    const { created } = await refreshUntis({ silent: true });
    return created;
  } catch (err) {
    toast(`Untis: ${err.message}`, 'error');
    return 0;
  }
}

let lastLoad = 0;
async function refresh({ quiet = true } = {}) {
  lastLoad = Date.now();
  const [, untisCreated] = await Promise.all([loadServerData(), refreshUntisIfStale()]);
  const created = syncSubjectsWithTimetable() + untisCreated;
  const imported = autoImportFromServer();
  render();
  if (created) toast(`${created} Fächer aus Untis übernommen.`, 'success');
  if (imported) toast(`${imported} neue Klausurtermine übernommen.`, 'success');
  else if (!quiet) toast('Daten aktualisiert.');
}

subscribe(render);
window.addEventListener('hashchange', render);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
// Beim Zurückkehren in die App frische Daten holen (immer aktuell)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastLoad > 5 * 60 * 1000) refresh();
});

render();
refresh();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  // Neue Version aktiv → einmal neu laden, damit sie sofort benutzt wird.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) {
      reloaded = true;
      location.reload();
    }
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
}
