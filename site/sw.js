// Service Worker: App-Dateien offline verfügbar machen.
// Daten (data/*.json) immer zuerst frisch aus dem Netz, Cache nur als Fallback.

const CACHE = 'notenapp-__BUILD__';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'icons/icon.svg',
  'js/app.js', 'js/config.js', 'js/ui.js', 'js/store.js', 'js/data.js', 'js/demo.js', 'js/grades.js', 'js/timetable.js',
  'js/klausur-parser.js', 'js/pdf-text.js', 'js/link-finder.js', 'js/untis-client.js',
  'js/views/common.js', 'js/views/overview.js', 'js/views/subjects.js', 'js/views/timetable-view.js',
  'js/views/klausuren.js', 'js/views/schluessel.js', 'js/views/settings.js', 'js/views/untis-connect.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.includes('/data/')) {
    // Network first: Stundenplan & Klausurplan sollen immer aktuell sein.
    event.respondWith(fetch(event.request).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put(url.pathname, copy));
      return res;
    }).catch(() => caches.match(url.pathname)));
    return;
  }

  // App-Dateien: Cache first, im Hintergrund aktualisieren.
  event.respondWith(caches.match(event.request).then((cached) => {
    const network = fetch(event.request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
      }
      return res;
    }).catch(() => cached);
    return cached ?? network;
  }));
});
