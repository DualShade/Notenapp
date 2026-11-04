# Changelog

Alle nennenswerten Änderungen an der Notenapp. Format nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/); was vor dieser Datei
geändert wurde, steht in der Git-Historie.

## [Unreleased]

### Sicherheit
- Passwort-Reset-Mails gehen mit `support@dualshade.xyz` als Envelope-Absender (`-f`, Return-Path) und mit `Auto-Submitted: auto-generated` raus, damit SPF für DMARC zur Domain passt und Unzustellbares in einem echten Postfach landet. Andere Adresse über `NOTENAPP_MAIL_RETURN`. Das stand bisher nur in der Kopie auf dualshade.xyz und wäre beim nächsten Kopieren verloren gegangen.
