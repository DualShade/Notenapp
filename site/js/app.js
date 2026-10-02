import { h, icon, toast } from './ui.js';
import { getState, subscribe, update } from './store.js';
import { loadServerData, syncSubjectsWithTimetable, autoImportFromServer, untisAccount, hasProxy, refreshUntis } from './data.js';
import { startSync, onSyncStatus, syncStatus, getAccount } from './sync.js';
import { overviewView } from './views/overview.js';
import { subjectsView, subjectDetailView } from './views/subjects.js';
import { timetableView } from './views/timetable-view.js';
import { tasksView } from './views/tasks.js';
import { moreView } from './views/more.js';
import { schluesselView } from './views/schluessel.js';
import { settingsView } from './views/settings.js';
import { accountView, resetView } from './views/account.js';
import { absencesView } from './views/absences.js';
import { statsView } from './views/stats.js';
import { abiView } from './views/abi.js';
import { printView } from './views/print.js';

const TABS = [
  { path: '', label: 'Übersicht', icon: 'home' },
  { path: 'faecher', label: 'Fächer', icon: 'book' },
  { path: 'plan', label: 'Plan', icon: 'calendar' },
  { path: 'aufgaben', label: 'Aufgaben', icon: 'clipboard' },
  { path: 'mehr', label: 'Mehr', icon: 'grid' },
];

// Route → [Titel, Ansicht, aktiver Tab]
const ROUTES = {
  '': ['Notenapp', () => overviewView(), ''],
  faecher: ['Fächer', () => subjectsView(), 'faecher'],
  fach: ['Fach', (p) => subjectDetailView(p), 'faecher'],
  plan: ['Stundenplan', () => timetableView(), 'plan'],
  aufgaben: ['Aufgaben', (p) => tasksView(p), 'aufgaben'],
  klausuren: ['Aufgaben', () => tasksView('klausuren'), 'aufgaben'],
  mehr: ['Mehr', () => moreView(), 'mehr'],
  statistik: ['Statistik', () => statsView(), 'mehr'],
  abi: ['Abi-Rechner', () => abiView(), 'mehr'],
  schluessel: ['Notenschlüssel', () => schluesselView(), 'mehr'],
  fehlzeiten: ['Fehlzeiten', () => absencesView(), 'mehr'],
  druck: ['Notenübersicht', () => printView(), 'mehr'],
  einstellungen: ['Einstellungen', () => settingsView(), 'mehr'],
  konto: ['Konto', () => accountView(), 'mehr'],
  passwort: ['Neues Passwort', (p) => resetView(p), 'mehr'],
};

const main = document.getElementById('main');
const header = document.getElementById('header');
const nav = document.getElementById('nav');

function route() {
  const [, path = '', param] = location.hash.replace(/^#/, '').split('/');
  return ROUTES[path] ? { path, param } : { path: '', param: null };
}

function applyTheme() {
  const { theme } = getState().settings;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function syncIcon() {
  const account = getAccount();
  const st = syncStatus();
  const name = !account ? 'cloudOff' : st.state === 'syncing' ? 'refresh' : st.state === 'error' || st.state === 'offline' ? 'alert' : 'cloud';
  const label = !account ? 'Nicht angemeldet – Daten nur auf diesem Gerät' : { syncing: 'Synchronisiere …', error: `Sync-Fehler: ${st.error}`, offline: 'Offline' }[st.state] ?? 'Synchronisiert';
  return h('a', { class: `icon-btn sync-icon ${account ? st.state : 'signed-out'}`, href: '#/konto', 'aria-label': label, title: label }, icon(name));
}

function renderHeader({ path }) {
  const { settings } = getState();
  header.replaceChildren(
    h('h1', {}, ROUTES[path][0]),
    h('div', { class: 'row gap center' },
      h('select', {
        class: 'halbjahr-select', 'aria-label': 'Halbjahr',
        onchange: (e) => update((s) => { s.settings.halbjahr = e.target.value; }),
      }, settings.halbjahre.map((hj) => h('option', { value: hj, selected: hj === settings.halbjahr }, hj))),
      syncIcon()));
}

function renderNav({ path }) {
  const active = ROUTES[path][2];
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
  const view = ROUTES[r.path][1](r.param);
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
// Sync-Status: nur das Symbol aktualisieren (kein Neuaufbau mitten im Tippen),
// auf der Konto-Seite die ganze Ansicht.
onSyncStatus(() => {
  const r = route();
  if (r.path === 'konto' || r.path === 'mehr') render();
  else header.querySelector('.sync-icon')?.replaceWith(syncIcon());
});
window.addEventListener('hashchange', render);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
// Beim Zurückkehren in die App frische Daten holen (immer aktuell)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - lastLoad > 5 * 60 * 1000) refresh();
});

render();
refresh();
startSync();

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
