# 📒 Notenapp

Notenapp für die Oberstufe im **Punktesystem (0–15)** als Web-App auf **GitHub Pages**:

- **Stundenplan automatisch aus WebUntis**: Eine GitHub Action holt deinen Plan mehrmals täglich, inklusive Ausfällen und Vertretungen.
- **LK/GK-Erkennung über die Wochenstunden**: Kurse mit 5 Wochenstunden werden zu Leistungskursen, Kurse mit 3 zu Grundkursen. Standardmäßig gilt alles ab 4 Stunden als LK, das kannst du ändern. Ferien- und Feiertagswochen werden nicht mitgezählt.
- **Klausurplan-Import aus einer PDF (optional)**: Der aktuelle Klausurplan wird **immer neu von der Schul-Homepage geladen**. Die App erkennt darin deine Kurse (z. B. `M-L1`, `Deutsch GK 2`) und zeigt dir die Termine erst als Vorschau. Übernommen wird nur, was du bestätigst. Wenn du willst, passiert das auch automatisch.
- **Notenschlüssel**: Tabelle 15 → 0 Punkte mit Prozentgrenzen und den nötigen Bewertungseinheiten (BE), dazu ein Klausur-Rechner, eine Umrechnung Punkte ↔ Note und ein eigener Schlüssel.
- **Noten wie in einer Notenapp**: Fächer, Halbjahre (EF.1 … Q2.2), Klausuren und sonstige Mitarbeit mit eigener Gewichtung, dazu Fach- und Gesamtschnitt. LKs können auf Wunsch doppelt zählen.
- **Läuft als installierbare PWA**, auch offline, mit hellem und dunklem Design. Die Noten bleiben **nur auf deinem Gerät**. Über eine Export/Import-Sicherung bringst du sie auf ein anderes Gerät.

> Zum Ausprobieren ohne Einrichtung tippst du auf der Startseite auf **„Demo ansehen“**.

---

## 🚀 Einrichtung (ca. 5 Minuten)

### 1. GitHub Pages aktivieren
**Settings → Pages → Build and deployment → Source: „GitHub Actions“**

Danach baut der Workflow `.github/workflows/pages.yml` die Seite bei jedem Push auf den Standard-Branch und regelmäßig nach Zeitplan. Die Seite liegt dann unter `https://<benutzername>.github.io/<repo>/`.

### 2. WebUntis-Zugang hinterlegen
**Settings → Secrets and variables → Actions**

| Art | Name | Beispiel |
|---|---|---|
| Variable | `UNTIS_SERVER` | `nessa.webuntis.com` (steht in der Adresszeile, wenn du WebUntis im Browser öffnest) |
| Variable | `UNTIS_SCHOOL` | `gym-musterstadt` (Schulname, wie bei der WebUntis-Anmeldung) |
| **Secret** | `UNTIS_USER` | dein Untis-Benutzername |
| **Secret** | `UNTIS_PASSWORD` | dein Untis-Passwort |

Die Zugangsdaten liegen nur als verschlüsselte GitHub-Secrets vor. Sie landen weder im Code noch auf der Website.

### 3. Klausurplan-Quelle angeben (optional)

| Variable | Bedeutung |
|---|---|
| `KLAUSUR_PAGE_URL` | Seite der Schul-Homepage, auf der der Klausurplan verlinkt ist. Die Action nimmt bei jedem Lauf den **aktuellen** PDF-Link. |
| `KLAUSUR_LINK_PATTERN` | Text, der im Link oder Dateinamen vorkommt (Standard: `klausur`, z. B. `klausurplan_q1`) |
| `KLAUSUR_PDF_URL` | Alternativ eine feste PDF-Adresse |
| `KLAUSUR_STUFE` | Optionaler Filter, z. B. `Q1`. Es werden nur PDF-Seiten berücksichtigt, die diesen Text enthalten. |
| `LK_THRESHOLD` | Ab wie vielen Wochenstunden ein Kurs als LK zählt (Standard `4`) |

Statt Variablen kannst du die nicht geheimen Werte auch in `notenapp.config.json` eintragen.

### 4. Starten
Unter **Actions → „Notenapp bauen & veröffentlichen“ → Run workflow** startest du den ersten Lauf von Hand. Danach aktualisiert sich alles automatisch:

- an Schultagen stündlich von 6 bis 20 Uhr (deutsche Zeit),
- am Wochenende alle 6 Stunden.

Die App lädt die Daten bei jedem Öffnen frisch. Schlägt ein Abruf fehl, zeigt sie weiter den letzten erfolgreichen Stand. Den Status siehst du unter **Einstellungen**.

> ⚠️ **Datenschutz:** Die GitHub-Pages-Seite ist öffentlich. Dein Stundenplan (Kurse, Lehrkürzel, Räume) und der Klausurplan sind damit für jeden lesbar, der die Adresse kennt. Deine **Noten** werden dagegen nie hochgeladen. Wenn du den Stundenplan nicht veröffentlichen willst, lass die Untis-Secrets leer und nutze den Live-Import über einen Proxy (siehe unten).
>
> GitHub pausiert zeitgesteuerte Workflows, wenn im Repo 60 Tage lang nichts passiert. Ein Klick auf „Enable workflow“ unter Actions schaltet sie wieder ein.

---

## 🔄 Optional: Live-Abruf direkt aus der App (Proxy)

Browser dürfen WebUntis und die meisten Schul-Homepages nicht direkt abfragen (CORS). Für einen **sofortigen** Abruf per Knopfdruck gibt es deshalb einen kleinen, kostenlosen Cloudflare Worker in `proxy/`:

```bash
cd proxy
# in wrangler.toml ALLOWED_HOSTS (Schul-Homepage) und ALLOWED_ORIGIN (deine Pages-URL) eintragen
npx wrangler deploy
```

Die Worker-URL trägst du dann in der App unter **Einstellungen → Live-Import** ein, zusammen mit den Untis-Daten. Die bleiben nur lokal im Browser. Der Proxy erlaubt nur `*.webuntis.com` und die freigegebenen Hosts. Das Hochladen einer PDF-Datei klappt auch ganz ohne Proxy.

---

## 🧠 Wie funktioniert die Erkennung?

**LK/GK:** Die Action lädt die letzte Woche und die nächsten 5 Wochen aus Untis. Pro Kurs (Untis-Schülergruppe wie `M-L1`, sonst das Fachkürzel) zählt sie die **geplanten** Stunden in 45-Minuten-Einheiten: Ausfälle zählen mit, Vertretungs- und Sonderstunden nicht. Pro Kurs nimmt sie den Median über alle vollen Schulwochen. Dabei werden Doppelstunden und 90-Minuten-Blöcke richtig umgerechnet, und A/B-Wochen werden gemittelt. Liegt ein Kurs bei mindestens 4 Stunden, ist er ein LK. Im Fach kannst du die Einstufung jederzeit von Hand ändern.

**Klausurplan:** Das PDF wird mit pdf.js in Tabellenzeilen zerlegt, auch bei verbundenen Datumszellen. Erkannt werden Datumsangaben wie `Mo 12.10.`, `12.10.2026` oder `5. November` und Stundenangaben wie `3.–4. Std.`. Die Zuordnung zu deinen Fächern läuft so:

1. Kursname aus Untis (`M-L1`, passt auch auf `M L1` oder `ML1`): sicherer Treffer
2. Fachname (`Mathematik`) oder eigene Aliasse (im Fach unter „Weitere Namen im Klausurplan“)
3. Fachkürzel (`M`), dabei werden LK/GK-Angaben und Kursnummern geprüft. `Deutsch GK 1` passt also nicht zu deinem `D-G2`.

Zeilen ohne Treffer kannst du in der Vorschau selbst einem Fach zuordnen.

---

## 🛠 Lokale Entwicklung

```bash
npm install
npm test              # Unit-Tests (Parser, LK/GK-Erkennung, Notenberechnung, Untis-Client)
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
proxy/worker.js       optionaler CORS-Proxy (Cloudflare Worker)
```
