// Service Worker: App offline verfügbar machen. Alles kommt zuerst frisch aus
// dem Netz; der Cache springt nur ein, wenn keine Verbindung besteht.

const CACHE = 'notenapp-__BUILD__';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/config.js', 'js/ui.js', 'js/store.js', 'js/data.js', 'js/demo.js', 'js/grades.js', 'js/timetable.js',
  'js/klausur-parser.js', 'js/pdf-text.js', 'js/link-finder.js', 'js/untis-client.js',
  'js/views/common.js', 'js/views/overview.js', 'js/views/subjects.js', 'js/views/timetable-view.js',
  'js/views/klausuren.js', 'js/views/schluessel.js', 'js/views/settings.js', 'js/views/untis-connect.js',
  'js/sync.js', 'js/sync-model.js', 'js/abi-calc.js', 'js/ics.js', 'js/klausur-calendar.js',
  'js/views/account.js', 'js/views/homework.js', 'js/views/absences.js', 'js/views/tasks.js', 'js/views/more.js',
  'js/views/stats.js', 'js/views/abi.js', 'js/views/print.js', 'js/views/weights.js', 'js/dedupe.js',
];

self.addEventListener('install', (event) => {
  // cache: 'reload' umgeht den HTTP-Cache, sonst landen evtl. alte Dateien im neuen Cache
  event.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Immer zuerst frisch aus dem Netz (Updates kommen sofort an), der Cache ist
// nur der Offline-Fallback. 'no-cache' fragt beim Server nach, ob sich die
// Datei geändert hat – unveränderte Dateien kosten kaum Datenvolumen.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  const key = url.pathname.includes('/data/') ? url.pathname : event.request;
  event.respondWith(fetch(event.request, { cache: 'no-cache' }).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(key, copy));
    }
    return res;
  }).catch(() => caches.match(key, { ignoreSearch: true })));
});
