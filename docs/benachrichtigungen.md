# Benachrichtigungen

RundfunkArr meldet sich auf Wunsch, wenn etwas passiert. Eingerichtet wird das unter
Einstellungen → **Benachrichtigungen**. Jedes Ziel hat einen Knopf **Testnachricht senden**,
der die gerade eingegebenen Werte prüft, ohne sie zu speichern.

<img class="screenshot" src="./screenshots/benachrichtigungen.png" alt="ntfy-Ziel in den Benachrichtigungs-Einstellungen nach erfolgreicher Testnachricht" width="600">

## Ereignisse

Einzeln abschaltbar, gelten für alle Ziele:

| Ereignis | Inhalt |
|----------|--------|
| Download abgeschlossen | Titel, Sender (falls bekannt) und Dateiname |
| Download fehlgeschlagen | Titel, Sender (falls bekannt) und Fehlermeldung, z. B. die ORF-Geosperre |
| Suchabo hat Downloads gestartet | Eine Nachricht pro Prüfung mit allen neu eingereihten Downloads |

Automatische Wiederholungen, Pausen und Abbrüche lösen keine Nachricht aus, erst der
endgültige Fehlschlag. Den Sender kennt RundfunkArr nur bei Downloads aus Suchabos;
Sonarr und Radarr übergeben ihn nicht.

## Ziele

Mehrere gleichzeitig möglich:

| Ziel | Einstellungen |
|------|---------------|
| Webhook | Adresse; erhält jedes Ereignis als JSON per `POST` (Format unten) |
| ntfy | Serveradresse (Standard `https://ntfy.sh`), Topic, optional Zugriffstoken |
| Gotify | Serveradresse und App-Token |
| Discord | Webhook-Adresse eines Kanals |

Ein Ziel sendet, sobald seine Pflichtfelder ausgefüllt sind und es nicht abgeschaltet ist.
Webhook-Adressen und Tokens gelten als Zugangsdaten: Die Oberfläche zeigt sie maskiert, und
das Protokoll schwärzt sie, auch im Export. Nachrichten gehen direkt raus, nicht über
den Download-Proxy. Jede Nachricht wird einmal gesendet, mit 10 Sekunden Zeitlimit und
ohne Wiederholung. Ein nicht erreichbares Ziel verzögert keinen Download; der Fehler steht
im Protokoll.

## Webhook-Format

Version 1. Neue Felder können hinzukommen, bei inkompatiblen Änderungen steigt `version`.

```json
{
  "version": 1,
  "event": "download.completed",
  "type": "success",
  "title": "Download abgeschlossen",
  "body": "Tatort - Murot und das Murmeltier (ARD)\nDatei: Tatort - Murot und das Murmeltier.mkv",
  "timestamp": "2026-10-29T12:00:00.000Z",
  "download": {
    "id": "6f1c…",
    "title": "Tatort - Murot und das Murmeltier",
    "channel": "ARD",
    "category": "tv",
    "fileName": "Tatort - Murot und das Murmeltier.mkv",
    "filePath": "/downloads/tv/6f1c…/Tatort - Murot und das Murmeltier.mkv",
    "size": 1288490188,
    "warning": null,
    "error": null
  },
  "subscription": null
}
```

- `event`: `download.completed`, `download.failed`, `subscription.queued` oder `test`
- `type`: `success`, `failure` oder `info` (Feldnamen wie bei Apprise: `title`, `body`, `type`)
- `download`: bei beiden Download-Ereignissen gesetzt, sonst `null`. Bei Fehlschlägen steht
  die Meldung in `error`; `fileName`, `filePath` und `size` sind dann `null`. `filePath` ist
  der Pfad aus Sicht von Sonarr/Radarr (siehe [`DOWNLOAD_FOLDER_PATH_MAPPING`](./einrichtung#pfade)).
- `subscription`: nur bei `subscription.queued`, mit `id`, `name`, `query` und
  `downloads` (Liste aus `id`, `title`, `channel`)

Die Ziele lassen sich auch über die `NOTIFY_*`-[Umgebungsvariablen](./konfiguration#umgebungsvariablen)
vorbelegen.
