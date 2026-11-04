# Changelog

Alle nennenswerten Änderungen an der Notenapp. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/); was vor dieser Datei
geändert wurde, steht in der Git-Historie.

## [Unreleased]

### Behoben
- PHP-Proxy unter PHP 8.5: `curl_close()` ist dort veraltet, und die Warnung landete vor der JSON-Antwort, sobald der Webspace Fehler anzeigt. Der Aufruf bleibt nur noch für PHP 7.

### Sicherheit
- PHP-Proxy: GET-Anfragen kommen über Punkt-Segmente (`/WebUntis/api/../…`, auch `%2e`) nicht mehr aus `/WebUntis/api/` heraus. curl löste sie auf, nachdem die Prüfung den Pfad schon durchgelassen hatte; der Worker prüfte bereits den aufgelösten Pfad.
- Passwort-Reset-Mails gehen mit `support@dualshade.xyz` als Envelope-Absender (`-f`, Return-Path) und mit `Auto-Submitted: auto-generated` raus, damit SPF für DMARC zur Domain passt und Unzustellbares in einem echten Postfach landet. Andere Adresse über `NOTENAPP_MAIL_RETURN`. Das stand bisher nur in der Kopie auf dualshade.xyz und wäre beim nächsten Kopieren verloren gegangen.
