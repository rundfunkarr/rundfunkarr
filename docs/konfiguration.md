# Konfiguration

Die meisten Einstellungen nimmt man in der Weboberfläche unter **Einstellungen** vor. Einige
Werte lassen sich zusätzlich über Umgebungsvariablen setzen.

## Umgebungsvariablen

| Variable | Beschreibung |
| --- | --- |
| `PUID` | User-ID für Dateiberechtigungen<br>Standard: `1001` |
| `PGID` | Group-ID für Dateiberechtigungen<br>Standard: `1001` |
| `DOWNLOAD_FOLDER_PATH` | Pfad für fertige Downloads im Container<br>Standard: `/downloads` |
| `DOWNLOAD_TEMP_PATH` | Pfad für laufende Downloads (incomplete)<br>Standard: `$DOWNLOAD_FOLDER_PATH/incomplete` |
| `DOWNLOAD_FOLDER_PATH_MAPPING` | Download-Ordner aus Sicht von Sonarr/Radarr, falls abweichend ([Pfade](./einrichtung#pfade))<br>Standard: leer |
| `DATABASE_URL` | SQLite-Datenbankpfad<br>Standard: `file:./prisma/data/rundfunkarr.db` |
| `TVDB_API_KEY` | TVDB-API-Key zum Initialisieren der Einstellungen<br>Standard: leer |
| `TVDB_PIN` | Optionaler TVDB-PIN für Subscriber-Keys<br>Standard: leer |
| `TMDB_API_KEY` | TMDB-API-Key zum Initialisieren der Einstellungen<br>Standard: leer |
| `MEDIATHEK_SOURCE` | Suchquelle zum Initialisieren der Einstellungen: `mediathekviewweb` oder `local`<br>Standard: `mediathekviewweb` |
| `NOTIFY_WEBHOOK_URL` | Webhook-Adresse für [Benachrichtigungen](./benachrichtigungen)<br>Standard: leer |
| `NOTIFY_NTFY_URL`, `NOTIFY_NTFY_TOPIC`, `NOTIFY_NTFY_TOKEN` | ntfy-Server, Topic und optionales Token<br>Standard: leer (Server: `https://ntfy.sh`) |
| `NOTIFY_GOTIFY_URL`, `NOTIFY_GOTIFY_TOKEN` | Gotify-Server und App-Token<br>Standard: leer |
| `NOTIFY_DISCORD_WEBHOOK_URL` | Discord-Webhook-Adresse<br>Standard: leer |
| `POST_PROCESS_SCRIPTS_DIR` | Ordner für [Post-Processing-Skripte](./post-processing)<br>Standard: `scripts` neben der Datenbank (Docker: `/app/prisma/data/scripts`) |
| `DIAGNOSTICS_ADMIN_KEY` | Admin-Schlüssel für Diagnose, Verbindungstest und Protokoll einschließlich Export; mind. 32 Zeichen<br>Standard: leer (Zugriff gesperrt) |
| `AUTH_PUBLIC_URL` | Öffentlicher Ursprung hinter einem Reverse Proxy ([Sicherheit](./sicherheit#reverse-proxy))<br>Standard: leer |
| `AUTH_COOKIE_SECURE` | Sichere Sitzungscookies erzwingen<br>Standard: `false` |
| `LOG_LEVEL` | Mindeststufe für Server-Logs und das Protokoll: `debug`, `info`, `warn` oder `error`<br>Standard: `info` |

Beim Serverstart werden nichtleere Werte aus `TVDB_API_KEY`, `TVDB_PIN`, `TMDB_API_KEY`,
`DOWNLOAD_FOLDER_PATH`, `MEDIATHEK_SOURCE` und den `NOTIFY_*`-Variablen in fehlende oder leere
Datenbank-Einstellungen übernommen. **Bereits gespeicherte Werte haben Vorrang.**

- Bei lokalen Installationen können die Variablen in `.env` stehen; Docker benötigt sie unter
  `environment` oder über `env_file`.
- Nach Änderungen ist ein Neustart nötig. Im Build werden keine Werte übernommen.
- Gespeicherte API-Zugangsdaten werden in der Settings-API maskiert; die Verbindungstests prüfen
  sie serverseitig.

### Log-Level

`LOG_LEVEL` steuert, wie ausführlich der Server in die Container-Logs und in das Protokoll unter
**Diagnose & Protokoll** schreibt. Mit `info` erscheinen eingehende Suchanfragen, Ergebnisse,
Downloads, Skripte und Imports; `debug` ergänzt Details zu Suchschritten, Regelwerken,
Metadaten-Abfragen und Downloadschritten. Ungültige Werte werden mit einer Warnung ignoriert.

## Metadaten-Quellen

RundfunkArr sucht Show-Informationen in dieser Reihenfolge:

1. **Lokale Datenbank** (`data/shows.json`): kein API-Key nötig
2. **TVDB**: wenn konfiguriert (Project-API-Key ohne PIN oder Subscriber-Key mit optionalem PIN)
3. **TMDB**: wenn konfiguriert (kostenlos)

Für Shows, die nicht in TVDB/TMDB stehen, lassen sich Einträge in `data/shows.json` ergänzen,
siehe [Rulesets & Shows](./rulesets).

## Weboberfläche

- **Dashboard**: Schnellsuche, Statuskacheln, aktive Downloads und letzte Aktivitäten
- **Suche**: direkte Suche in den Mediatheken mit Filtern, Mehrfachauswahl und Direktlinks
- **Downloads**: Warteschlange steuern und Historie verwalten
- **Suchabos**: Suchbegriffe regelmäßig prüfen und neue Sendungen melden oder laden
- **Serien** und **Filme**: zwischengespeicherte Serien aus TVDB und Filmsuche in den Mediatheken
- **Rulesets**: Zuordnungsregeln ansehen, prüfen und lokal überschreiben
- **Einstellungen**: Download-Pfad, Qualität, Untertitel, MKV-Konvertierung, API-Keys
  (TVDB/TMDB/SRG SSR), Matching-Strategie und Schwellwerte,
  [Benachrichtigungen](./benachrichtigungen), Cache-TTL, Darstellung
- **Diagnose & Protokoll**: Systemdiagnose, Verbindungstest und Serverprotokoll
- **Setup-Wizard**: geführte Erstkonfiguration

Die Oberfläche folgt der Systemeinstellung für helle oder dunkle Darstellung und lässt sich unten
in der Seitenleiste oder unter Einstellungen → Darstellung umschalten.

### Vorschaubilder

Suche, Filme und Suchabos zeigen zu jedem Treffer ein Standbild. MediathekView liefert keine
Bilder, deshalb ruft RundfunkArr beim ersten Anzeigen die Sendungsseite des Senders einmal ab,
liest dort die Adresse des Vorschaubilds (`og:image`) aus und merkt sie sich in der Datenbank
(30 Tage, bei Fehlschlag einen Tag). Das Bild selbst lädt der Browser direkt vom Sender.

Abgerufen werden nur Seiten der öffentlich-rechtlichen Sender; SRF-Bilder kommen aus der
SRG-SSR-API, Serienposter aus TVDB. Unter Einstellungen → **Darstellung** lassen sich
Vorschaubilder und Serienposter getrennt abschalten; ohne Vorschaubilder ruft RundfunkArr keine
Sendungsseiten ab.
