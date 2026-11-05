# Changelog

Alle nennenswerten Änderungen an der Notenapp. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/); was vor dieser Datei
geändert wurde, steht in der Git-Historie.

## [Unreleased]

### Hinzugefügt
- `ARCHITECTURE.md`: wofür jeder Teil da ist, wohin neuer Code gehört, was wovon abhängen darf, und dass die PHP-Dateien hier gepflegt und nach dualshade.xyz kopiert werden.

### Geändert
- Passwort-Reset-Mails gehen mit `support@dualshade.xyz` als Envelope-Absender (`-f`, Return-Path) und mit `Auto-Submitted: auto-generated` raus, damit SPF für DMARC zur Domain passt und Unzustellbares in einem echten Postfach landet. Andere Adresse über `NOTENAPP_MAIL_RETURN`. Das stand bisher nur in der Kopie auf dualshade.xyz und wäre beim nächsten Kopieren verloren gegangen.
- Der Proxy meldet `"version":3` (PHP und Worker).
- Die Proxy-Tests prüfen, dass Hausaufgaben wirklich per GET bei Untis ankommen (die Attrappe lehnt POST auf `/WebUntis/api/` ab), lassen PHP Warnungen anzeigen wie ein Webspace mit `display_errors` und schicken abgelehnte Anfragen des Workers nie nach draußen.
- Die Proxy-Tests prüfen Weiterleitungen bei `route=fetch` in Worker und PHP-Proxy (Ziel außerhalb der Liste, innerhalb, relativ und protokollrelativ, mehr als 5, fremdes Schema) und dass die rpc-Route keiner Weiterleitung folgt. `php -S` startet dabei auf einem freien Port vom Betriebssystem statt auf einem zufälligen.

### Behoben
- PHP-Proxy unter PHP 8.5: `curl_close()` ist dort veraltet, und die Warnung landete vor der JSON-Antwort, sobald der Webspace Fehler anzeigt. Der Aufruf bleibt nur noch für PHP 7.
- PHP-Proxy: Eingaben mit falschem Typ (`url`, `method`, `cookie` oder `body` als Liste) bekommen eine saubere 400 statt einer PHP-Warnung oder eines Fehlers mit Serverpfad.
- PHP-Proxy: `url` als Liste bei `route=fetch` bekommt ebenso eine 400 statt eines PHP-Fehlers mit Serverpfad.

### Sicherheit
- Proxy (PHP und Worker): GET über die rpc-Route nur auf Pfade unter `/WebUntis/api/` aus Buchstaben, Ziffern, `_`, `-` und `/`. Punkt-Segmente wie `/../`, `%2e%2e` oder `..;/` führten sonst aus `/WebUntis/api/` heraus, weil curl bzw. der Untis-Server sie erst nach der Prüfung auflösen; `..;/` kam auch am Worker vorbei.
- Proxy (PHP und Worker): `route=fetch` folgt Weiterleitungen selbst, höchstens 5, und prüft jedes Ziel wie die erste Adresse: nur http und https, Host in `ALLOWED_HOSTS`, keine Zugangsdaten (`user:pass@`) in der Adresse. Relative Ziele (`/pfad`, `plan.pdf`, `../x`, `?x=1`, `//host/…`) werden gegen die aktuelle Adresse aufgelöst. Bisher folgten curl bzw. `fetch` jeder Weiterleitung; eine freigegebene Homepage, die weiterleitet oder einen offenen Redirect hat, konnte den Proxy so an jede Adresse schicken, auch an interne des Servers. Im Repo von dualshade.xyz setzt nichts `NOTENAPP_ALLOWED_HOSTS`, dort lehnt die Route also jede Adresse ab.
- PHP-Proxy: curl spricht nur noch http und https und folgt keiner Weiterleitung mehr selbst. Die Adresse für curl wird aus den geprüften Teilen neu gebaut, damit curl keinen anderen Host herausliest als `parse_url()`. Alle Abrufe einer Anfrage haben zusammen wie bisher höchstens 30 Sekunden.
- Worker: JSON-RPC per POST folgt keinen Weiterleitungen mehr, wie schon im PHP-Proxy. Bei 307/308 wäre die Anfrage samt Passwort und Cookie sonst an das Ziel gegangen.
- Proxy (PHP und Worker): Untis nur über den Standard-Port 443. Im PHP-Proxy gibt curl außerdem nach 10 Sekunden auf, wenn keine Verbindung zustande kommt; ein Port, der nicht antwortet, hielt PHP bisher 30 Sekunden fest.
