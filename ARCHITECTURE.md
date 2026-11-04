# Architektur

Wofür jeder Teil der Notenapp da ist, wohin neuer Code gehört und was wovon abhängen darf.
Was die App kann und wie man sie einrichtet, steht im `README.md`; was sich wann geändert
hat, im `CHANGELOG.md` und in Git.

## Teile

| Pfad | Wofür |
| --- | --- |
| `site/` | Die App: statische PWA ohne Framework und ohne Build-Schritt für den Code. `index.html`, `css/app.css`, `manifest.webmanifest`, `sw.js` (Service Worker; die Cache-Version setzt der Build), `icons/`. |
| `site/js/app.js` | Einstieg: Hash-Router, Kopf- und Tab-Leiste, startet Datenabruf und Sync, rendert die Ansichten. |
| `site/js/store.js` | Der App-Zustand im `localStorage` (`notenapp:v1`), mit Migrationen und Änderungsverfolgung für den Sync. |
| `site/js/data.js` | Datenquellen: die von der Action erzeugten JSON-Dateien, der Untis-Login über den Proxy (`tunnelFetch`), der Klausurplan-Import aus PDFs, das Übernehmen von Untis-Hausaufgaben. |
| `site/js/sync.js`, `sync-model.js` | Konto und Cloud-Sync mit `notenapp-api.php`; `sync-model.js` führt lokalen und Cloud-Stand pro Eintrag zusammen. |
| `site/js/config.js` | Die Server-Adressen (Proxy, Konto-API). Der Build überschreibt sie mit den GitHub-Variablen `PROXY_URL` / `API_URL`. |
| Rechen- und Parser-Module in `site/js/` | `grades.js` (Punkte, Schnitte, Notenschlüssel), `abi-calc.js`, `timetable.js` (Untis-Rohdaten, LK/GK-Erkennung, Hausaufgaben), `klausur-parser.js`, `klausur-calendar.js`, `pdf-text.js`, `link-finder.js`, `plan-discovery.js`, `dedupe.js`, `ics.js`, `untis-client.js` (WebUntis-Client für Browser, Node und Worker). |
| `site/js/views/` | Eine Datei pro Ansicht; `common.js` hält geteilte Bausteine, `untis-connect.js` den Untis-Login-Dialog. `ui.js` (eine Ebene höher) sind die DOM-Helfer. |
| `site/js/demo.js` | Demo-Daten zum Ausprobieren ohne Untis-Zugang. |
| `scripts/build.mjs` | Baut `dist/`: kopiert `site/`, legt pdf.js lokal ab, setzt die Service-Worker-Version und die Server-Adressen. |
| `scripts/sync.mjs` | Läuft in der Action: holt Stundenplan (WebUntis) und Klausurplan (PDF) nach `dist/data/`. Einstellungen aus `notenapp.config.json` und Umgebungsvariablen. |
| `scripts/serve.mjs` | Lokaler Server für `dist/`. |
| `proxy/notenapp-proxy.php` | Der Untis-/Homepage-Proxy für PHP-Webspace. Browser dürfen WebUntis nicht direkt ansprechen; der Proxy reicht nur durch und speichert nichts. |
| `proxy/worker.js`, `wrangler.toml` | Derselbe Proxy als Cloudflare Worker, mit demselben Protokoll. |
| `proxy/notenapp-api.php` | Die Konto-API: Konten, Cloud-Sync, Passwort-Reset per Mail, Kalender-Abo. Daten als Dateien in `notenapp-data/`, jede mit einer PHP-`exit`-Zeile davor. |
| `tests/` | `node --test`. `helpers/mock-untis.mjs` spielt WebUntis. Die PHP-Tests starten echtes `php -S` und werden übersprungen, wenn PHP fehlt. |
| `.github/workflows/pages.yml` | Tests, Build, Datenabruf und Veröffentlichung auf GitHub Pages: bei jedem Push auf den Standard-Branch und nach Zeitplan (Schultage stündlich). |

## Die PHP-Dateien auf dualshade.xyz

`proxy/notenapp-proxy.php` und `proxy/notenapp-api.php` laufen auf dem IONOS-Webspace von
dualshade.xyz. Dort liegen sie als Kopie im Repo `DualShade/dualshade.xyz` unter `static/`,
mit einer ersten Zeile `// Quelle: github.com/DualShade/Notenapp (…) – dort pflegen und hierher
kopieren.` Geändert wird hier, dann wird kopiert (mit dieser Zeile) und die Website neu
hochgeladen; eine Änderung, die nur in der Kopie steht, geht beim nächsten Kopieren verloren.

## Wo neuer Code hingehört

- Rechnen, Parsen, Untis-Daten aufbereiten: ein Modul in `site/js/` ohne DOM-Zugriff und ohne
  Import von `ui.js`, `store.js` oder `views/`, damit es in Node (Tests, `scripts/sync.mjs`)
  genauso läuft wie im Browser. Dazu ein Test in `tests/`.
- Eine neue Ansicht: `site/js/views/<name>.js`, in `app.js` eingehängt.
- Alles, was der Browser von fremden Hosts braucht, geht über den Proxy (`tunnelFetch` in
  `data.js`). Eine neue Proxy-Route oder -Regel kommt in `notenapp-proxy.php` und `worker.js`
  zugleich, mit einem Test für beide in `tests/proxy.test.mjs`.
- Was der Server speichern muss: nur in `notenapp-api.php`, als Datei unter `notenapp-data/`
  mit der `GUARD`-Zeile. Neue Einstellungen dort oben unter „Einstellungen“, überschreibbar
  mit einer Umgebungsvariable `NOTENAPP_…`.
- Neue Daten aus der Action: in `scripts/sync.mjs`, die Variablen dazu in `pages.yml`.

## Was wovon abhängen darf

- Die Rechen- und Parser-Module importieren nur einander (`klausur-calendar.js` →
  `klausur-parser.js`), nie `ui.js`, `store.js`, `data.js`, `sync.js` oder eine Ansicht.
- `store.js` nutzt nur `grades.js`, `timetable.js` und `sync-model.js`.
- `data.js` und `sync.js` nutzen `store.js`, `config.js` und die Rechenmodule, nie eine Ansicht.
- Ansichten importieren `ui.js`, `store.js`, `data.js`, `sync.js` und `views/common.js`; eine
  Ansicht darf Bausteine einer anderen nutzen (z. B. `overview.js` die Hausaufgabenliste). Außer
  `app.js` importiert nichts außerhalb von `views/` eine Ansicht.
- `scripts/sync.mjs` nutzt nur die Rechen- und Parser-Module und `pdfjs-dist`.
- Die PHP-Dateien und `worker.js` hängen von nichts im Repo ab und teilen keinen Code; Proxy
  in PHP und Worker halten dasselbe Protokoll, abgesichert durch dieselben Tests.
- Einzige npm-Abhängigkeit ist `pdfjs-dist`, die der Build nach `dist/vendor/` kopiert.

## Dateien über 800 Zeilen

Keine. Die größte ist `site/css/app.css` mit gut 500 Zeilen.
