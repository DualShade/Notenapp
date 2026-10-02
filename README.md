# 📒 Notenapp

Notenapp für die Oberstufe im **Punktesystem (0–15)** als Web-App auf **GitHub Pages**:

- **Untis-Login wie in der Untis-App**: Schule suchen, Benutzername und Passwort eingeben, fertig. Der Stundenplan wird bei jedem Öffnen frisch geladen, inklusive Ausfällen und Vertretungen.
- **LK/GK-Erkennung über die Wochenstunden**: Kurse mit 5 Wochenstunden werden zu Leistungskursen, Kurse mit 3 zu Grundkursen. Standardmäßig gilt alles ab 4 Stunden als LK, das kannst du ändern. Ferien- und Feiertagswochen werden nicht mitgezählt.
- **Klausurplan-Import aus einer PDF (optional)**: Der aktuelle Klausurplan wird **immer neu von der Schul-Homepage geladen**. Die App erkennt darin deine Kurse (z. B. `M-L1`, `Deutsch GK 2`) und zeigt dir die Termine erst als Vorschau. Übernommen wird nur, was du bestätigst. Wenn du willst, passiert das auch automatisch.
- **Notenschlüssel**: Tabelle 15 → 0 Punkte mit Prozentgrenzen und den nötigen Bewertungseinheiten (BE), dazu ein Klausur-Rechner, eine Umrechnung Punkte ↔ Note und ein eigener Schlüssel.
- **Noten wie in einer Notenapp**: Fächer, Halbjahre (EF.1 … Q2.2), Klausuren und sonstige Mitarbeit mit eigener Gewichtung, dazu Fach- und Gesamtschnitt. LKs können auf Wunsch doppelt zählen.
- **Läuft als installierbare PWA**, auch offline, mit hellem und dunklem Design. Die Noten bleiben **nur auf deinem Gerät**. Über eine Export/Import-Sicherung bringst du sie auf ein anderes Gerät.

> Zum Ausprobieren ohne Einrichtung tippst du auf der Startseite auf **„Demo ansehen“**.

---

## 🚀 Einrichtung

### 1. GitHub Pages aktivieren
**Settings → Pages → Build and deployment → Source: „GitHub Actions“**

Danach baut der Workflow `.github/workflows/pages.yml` die Seite bei jedem Push auf den Standard-Branch und regelmäßig nach Zeitplan. Die Seite liegt dann unter `https://<benutzername>.github.io/<repo>/`.

### 2. Untis-Login in der App: Proxy einmalig einrichten
Browser dürfen WebUntis nicht direkt ansprechen. WebUntis erlaubt keine Cross-Origin-Anfragen, und das Session-Cookie lässt sich aus dem Browser nicht setzen. Deshalb leitet ein kleiner **Proxy** die Anfragen weiter. Er reicht nur Anfragen an `*.webuntis.com` (und auf Wunsch die Schul-Homepage) durch und speichert nichts. Die eigentliche Logik läuft in der App. **Eine** der beiden Varianten genügt:

**a) PHP-Webspace, z. B. IONOS (empfohlen, wenn vorhanden)**
1. `proxy/notenapp-proxy.php` hochladen, z. B. nach `https://deine-domain.de/notenapp-proxy.php`.
2. Oben in der Datei `$ALLOWED_ORIGIN` auf deine Pages-Adresse setzen (Standard: `https://dualshade.github.io`). Für den Klausurplan-Abruf trägst du in `$ALLOWED_HOSTS` die Schul-Homepage ein.
3. Testen: Ruf die URL im Browser auf. Dort sollte `{"ok":true,"service":"notenapp-proxy",…}` erscheinen.

**b) Cloudflare Worker (kostenlos)**
```bash
cd proxy
npx wrangler deploy   # vorher ALLOWED_ORIGIN / ALLOWED_HOSTS in wrangler.toml setzen
```

Zum Schluss legst du unter **Settings → Secrets and variables → Actions → Variables** die Variable **`PROXY_URL`** mit der Proxy-Adresse an und startest den Workflow neu. In der App erscheint dann **„Mit Untis verbinden“**:

1. Schule suchen
2. Benutzername + Passwort eingeben
3. Fertig

Die Zugangsdaten bleiben nur auf dem jeweiligen Gerät. Jeder, der die Seite nutzt, meldet sich mit seinem eigenen Konto an. Schulen, die nur per Microsoft/IServ-Login (SSO) anmelden, unterstützen keinen Passwort-Login über die API.

### 3. Klausurplan-Quelle angeben (optional)
**Settings → Secrets and variables → Actions → Variables**

| Variable | Bedeutung |
|---|---|
| `KLAUSUR_PAGE_URL` | Seite der Schul-Homepage, auf der der Klausurplan verlinkt ist. Die Action nimmt bei jedem Lauf den **aktuellen** PDF-Link. |
| `KLAUSUR_LINK_PATTERN` | Text, der im Link oder Dateinamen vorkommt (Standard: `klausur`, z. B. `klausurplan_q1`) |
| `KLAUSUR_PDF_URL` | Alternativ eine feste PDF-Adresse |
| `KLAUSUR_STUFE` | Optionaler Filter, z. B. `Q1`. Es werden nur PDF-Seiten berücksichtigt, die diesen Text enthalten. |
| `LK_THRESHOLD` | Ab wie vielen Wochenstunden ein Kurs als LK zählt (Standard `4`) |

Der Workflow aktualisiert den Klausurplan an Schultagen stündlich von 6 bis 20 Uhr (deutsche Zeit) und am Wochenende alle 6 Stunden. Die App lädt ihn bei jedem Öffnen frisch. Den Status siehst du unter **Einstellungen**.

> GitHub pausiert zeitgesteuerte Workflows, wenn im Repo 60 Tage lang nichts passiert. Ein Klick auf „Enable workflow“ unter Actions schaltet sie wieder ein.

### Alternative ohne Proxy: Stundenplan über die GitHub Action
Statt des Logins in der App kann auch die Action den Stundenplan holen. Dafür legst du die Variablen `UNTIS_SERVER` und `UNTIS_SCHOOL` sowie die Secrets `UNTIS_USER` und `UNTIS_PASSWORD` an. ⚠️ Der Stundenplan ist dann auf der öffentlichen Pages-Seite für jeden lesbar, und es funktioniert nur für ein Konto.

---

## 🧠 Wie funktioniert die Erkennung?

**LK/GK:** Die App lädt die letzte Woche und die nächsten 5 Wochen aus Untis. Pro Kurs (Untis-Schülergruppe wie `M-L1`, sonst das Fachkürzel) zählt sie die **geplanten** Stunden in 45-Minuten-Einheiten: Ausfälle zählen mit, Vertretungs- und Sonderstunden nicht. Pro Kurs nimmt sie den Median über alle vollen Schulwochen. Dabei werden Doppelstunden und 90-Minuten-Blöcke richtig umgerechnet, und A/B-Wochen werden gemittelt. Liegt ein Kurs bei mindestens 4 Stunden, ist er ein LK. Im Fach kannst du die Einstufung jederzeit von Hand ändern.

**Klausurplan:** Das PDF wird mit pdf.js in Tabellenzeilen zerlegt, auch bei verbundenen Datumszellen. Erkannt werden Datumsangaben wie `Mo 12.10.`, `12.10.2026` oder `5. November` und Stundenangaben wie `3.–4. Std.`. Die Zuordnung zu deinen Fächern läuft so:

1. Kursname aus Untis (`M-L1`, passt auch auf `M L1` oder `ML1`): sicherer Treffer
2. Fachname (`Mathematik`) oder eigene Aliasse (im Fach unter „Weitere Namen im Klausurplan“)
3. Fachkürzel (`M`), dabei werden LK/GK-Angaben und Kursnummern geprüft. `Deutsch GK 1` passt also nicht zu deinem `D-G2`.

Zeilen ohne Treffer kannst du in der Vorschau selbst einem Fach zuordnen.

---

## 🛠 Lokale Entwicklung

```bash
npm install
npm test              # Tests (Parser, LK/GK, Noten, Untis-Client, Schulsuche, beide Proxys)
npm run build         # baut dist/
UNTIS_SERVER=… UNTIS_SCHOOL=… UNTIS_USER=… UNTIS_PASSWORD=… \
KLAUSUR_PAGE_URL=… npm run sync   # Daten nach dist/data holen
node scripts/serve.mjs            # http://localhost:8080
```

Aufbau:

```
site/                 statische App (Vanilla JS, ohne Build-Framework)
  js/untis-client.js  WebUntis JSON-RPC-Client (Node, Worker)
  js/timetable.js     Stundenplan aufbereiten + LK/GK-Erkennung
  js/klausur-parser.js  Datums-/Kurserkennung im Klausurplan
  js/pdf-text.js      PDF → Tabellenzeilen (pdf.js)
  js/link-finder.js   aktuellen PDF-Link auf der Homepage finden
  js/grades.js        Schnitte, Notenschlüssel, Punkte ↔ Note
scripts/sync.mjs      Abruf in der GitHub Action
scripts/build.mjs     Build nach dist/ (inkl. pdf.js)
proxy/notenapp-proxy.php  Proxy für PHP-Webspace (z. B. IONOS)
proxy/worker.js       gleicher Proxy als Cloudflare Worker
```
