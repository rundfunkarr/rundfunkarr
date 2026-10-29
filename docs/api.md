# API-Endpunkte

Bei aktivierter [Anmeldung](./sicherheit#optionale-anmeldung) verlangen beide Schnittstellen den
Integrationsschlüssel als `apikey`-Parameter oder `X-Api-Key`-Header.

## Indexer (Newznab)

| Endpunkt                                 | Beschreibung          |
| ---------------------------------------- | --------------------- |
| `GET /api/newznab?t=caps`                | Capabilities-XML      |
| `GET /api/newznab?t=tvsearch&tvdbid=123` | TV-Suche nach TVDB-ID |
| `GET /api/newznab?t=tvsearch&q=Tatort`   | TV-Suche nach Name    |
| `GET /api/newznab?t=search`              | RSS-Feed              |

## Downloader (SABnzbd-kompatibel)

| Endpunkt                            | Beschreibung        |
| ----------------------------------- | ------------------- |
| `GET /api?mode=version`             | Version             |
| `GET /api?mode=get_config`          | Konfiguration       |
| `GET /api?mode=queue`               | Download-Warteschlange |
| `GET /api?mode=history`             | Download-Historie   |
| `POST /api?mode=addfile&cat=sonarr` | Download hinzufügen |

## Sonstige

| Endpunkt                     | Beschreibung                                                            |
| ---------------------------- | ----------------------------------------------------------------------- |
| `GET /api/health`            | Allgemeiner Status für Container-Healthchecks, ohne Anmeldung erreichbar |
| `/api/logs`, `/api/diagnostics` | Nur mit `X-RundfunkArr-Admin-Key`, siehe [Sicherheit](./sicherheit#diagnose-und-protokoll-schutzen) |
