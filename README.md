<p align="center">
  <img src="public/logo.png" alt="RundfunkArr Logo" width="128">
</p>

# RundfunkArr

[![GitHub Release](https://img.shields.io/github/v/release/rundfunkarr/rundfunkarr?logo=github&label=Release)](https://github.com/rundfunkarr/rundfunkarr/releases)
[![License](https://img.shields.io/github/license/rundfunkarr/rundfunkarr?label=License)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/rundfunkarr/rundfunkarr?style=flat&logo=github&label=Stars)](https://github.com/rundfunkarr/rundfunkarr)
[![GitHub Issues](https://img.shields.io/github/issues/rundfunkarr/rundfunkarr?logo=github&label=Issues)](https://github.com/rundfunkarr/rundfunkarr/issues)

Rundfunk-Indexer für Sonarr/Radarr - Automatischer Download von ARD, ZDF und anderen deutschen Mediatheken.

## Screenshots

<p align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard">
</p>

## Features

- **Newznab-kompatibler Indexer** - Funktioniert mit Prowlarr, NZB Hydra, Sonarr und Radarr
- **SABnzbd-kompatibler Downloader** - Direkter HTTP-Download von den Mediatheken
- **Optionale MKV-Konvertierung** - FFmpeg-Integration mit deutschen Sprachmetadaten
- **Flexible Metadaten-Quellen** - Lokale Datenbank, TVDB oder TMDB
- **Community-Rulesets** - Lokale Rulesets via Pull Request erweiterbar
- **SQLite-Datenbank** - Persistente Speicherung von Cache und Download-Historie

## SRF und ORF über HLS

Aktiviere **HLS-Streams aktivieren** unter Settings → Streaming. Mit
**ORF-Suche aktivieren** werden ORF-Treffer aus MediathekView einbezogen.
Für die SRF-API trägst du Consumer Key und Consumer Secret aus dem
[SRG-SSR-Entwicklerportal](https://developer.srgssr.ch/en/apis/srgssr-video) ein.
Diese Quellen stehen der Websuche und Newznab einschließlich RSS-Sync zur Verfügung.
Die vorhandenen Episodenregeln bestimmen weiterhin, welche Releases Sonarr erhält.

SRF-Videoreferenzen werden erst beim Download durch yt-dlp aufgelöst, einschließlich
der benötigten Stream-Tokens. Ein optionaler Proxy gilt für yt-dlp und Downloads,
jedoch nicht für die SRG-SSR-Metadaten-API. Regionale Beschränkungen hängen weiterhin
vom Proxy-Standort und der Verfügbarkeit beim Sender ab.
Die MKV-Einstellung gilt auch für HLS: aktiviert ergibt MKV, deaktiviert MP4.
Docker enthält eine feste yt-dlp-Version mit Prüfsummenprüfung. Native Installationen
können einen eigenen Programmpfad oder den ebenfalls geprüften automatischen Download nutzen.

## Installation mit Docker

### docker-compose.yml

```yaml
services:
  rundfunkarr:
    image: ghcr.io/rundfunkarr/rundfunkarr:latest
    container_name: rundfunkarr
    environment:
      - TZ=Europe/Berlin
      - PUID=1000                           # User ID (id -u)
      - PGID=1000                           # Group ID (id -g)
      - DOWNLOAD_FOLDER_PATH=/downloads
    volumes:
      - ./data:/app/prisma/data
      - ./downloads:/downloads
    ports:
      - 6767:6767
    restart: unless-stopped
```

Nach dem Start ist die Web-Oberfläche unter `http://localhost:6767` erreichbar. Beim ersten Start führt der **Setup-Wizard** durch die Konfiguration (API Keys, Pfade, etc.).

Für Tests mit dem aktuellen `main`-Stand werden täglich Nightly-Images für `linux/amd64` und `linux/arm64` gebaut. `nightly` zeigt immer auf den neuesten Daily-Build; datierte Tags wie
`nightly-20260517` bleiben als konkreter Build erhalten:

```yaml
image: ghcr.io/rundfunkarr/rundfunkarr:nightly
```

Für reproduzierbare Deployments kann statt `latest` auch eine feste Version verwendet werden:

```yaml
image: ghcr.io/rundfunkarr/rundfunkarr:1.3.2
```

Der Git-Tag-Alias mit `v`-Präfix ist ebenfalls verfügbar:

```bash
docker pull ghcr.io/rundfunkarr/rundfunkarr:v1.3.2
```

### Starten

```bash
docker-compose up -d
```

## Manuelle Installation

### Voraussetzungen

- Node.js >= 24
- npm
- FFmpeg (für MKV-Konvertierung)

### Setup

```bash
# Dependencies installieren
npm install

# Datenbank initialisieren
npx prisma migrate dev

# Development Server starten
npm run dev

# Oder Production Build
npm run build
npm start
```

## Konfiguration

### Umgebungsvariablen

| Variable | Beschreibung | Standard |
|----------|--------------|----------|
| `PUID` | User ID für Dateiberechtigungen | `1001` |
| `PGID` | Group ID für Dateiberechtigungen | `1001` |
| `DOWNLOAD_FOLDER_PATH` | Pfad für fertige Downloads im Container | `/downloads` |
| `DOWNLOAD_TEMP_PATH` | Pfad für laufende Downloads (incomplete) | `$DOWNLOAD_FOLDER_PATH/incomplete` |
| `DATABASE_URL` | SQLite Datenbank-Pfad | `file:./prisma/data/rundfunkarr.db` |
| `TVDB_API_KEY` | TVDB-API-Key zum Initialisieren der Einstellungen | leer |
| `TVDB_PIN` | Optionaler TVDB-PIN für Subscriber-Keys | leer |
| `TMDB_API_KEY` | TMDB-API-Key zum Initialisieren der Einstellungen | leer |
| `DIAGNOSTICS_ADMIN_KEY` | Admin-Schlüssel für Diagnose, Verbindungstest und Protokoll einschließlich Export; mindestens 32 Zeichen | leer (Zugriff gesperrt) |

Beim Serverstart werden nichtleere Werte aus `TVDB_API_KEY`, `TVDB_PIN`,
`TMDB_API_KEY` und `DOWNLOAD_FOLDER_PATH` in fehlende oder leere
Datenbank-Einstellungen übernommen. Bereits gespeicherte Werte haben Vorrang.
Bei lokalen Installationen können die Variablen in `.env` stehen; Docker benötigt
sie unter `environment` oder über `env_file`. Nach Änderungen ist ein Neustart
nötig. Im Build werden keine Werte übernommen. Gespeicherte API-Zugangsdaten
werden in der Settings-API maskiert; die Verbindungstests prüfen sie serverseitig.

### Diagnose und Protokoll schützen

Einen zufälligen Admin-Schlüssel mit `openssl rand -hex 32` erzeugen, als
`DIAGNOSTICS_ADMIN_KEY` in der Serverumgebung setzen und den Server neu starten.
Die mitgelieferte Compose-Datei übernimmt den Wert aus `.env`. Ohne gültige
Konfiguration bleiben `/api/logs` und `/api/diagnostics` gesperrt.

Auf **Diagnose & Protokoll** den Schlüssel eingeben. Die Seite behält ihn nur im
Arbeitsspeicher, bis sie gesperrt, verlassen oder neu geladen wird. Auch der
Textexport verlangt den Schlüssel. Direkte API-Aufrufe verwenden den Header
`X-RundfunkArr-Admin-Key`; der Schlüssel gehört nicht in die URL. Außerhalb eines
vertrauenswürdigen Netzes HTTPS verwenden.

Freigeschaltete Administratoren können interne Sonarr-/Radarr-Adressen testen,
auch Docker-Hostnamen und Loopback-Adressen. Weiterleitungen werden abgelehnt;
der Admin-Schlüssel wird nicht an die Zielanwendung gesendet. Dieser Schutz gilt
nur für Diagnose und Protokoll, nicht für die übrige Anwendung.

Bei aktivierter Anmeldung ist zusätzlich eine gültige Browser-Sitzung erforderlich.
Direkte schreibende API-Aufrufe benötigen außerdem einen passenden `Origin`-Header.
Der Integrationsschlüssel für Sonarr/Radarr ersetzt weder die Sitzung noch den
Diagnose-Schlüssel.

### Optionale Anmeldung

Unter **Settings → General → Sicherheit** lässt sich ein Anmeldeformular mit
Benutzername und Passwort aktivieren. Standardmäßig ist die Anmeldung aus, damit
bestehende Installationen unverändert starten. Neue Passwörter benötigen mindestens
12 Zeichen und werden ausschließlich als gesalzener scrypt-Hash gespeichert.

Bei aktivierter Anmeldung gelten folgende Zugriffswege:

- Browser: Loginformular; die Sitzung läuft nach 12 Stunden ab, mit „30 Tage
  angemeldet bleiben“ nach 30 Tagen. Abmelden widerruft die Sitzung auf dem Server.
- Sonarr/Radarr/Prowlarr: den **Integrationsschlüssel** aus den Sicherheitseinstellungen
  als API-Key sowohl im RundfunkArr-Newznab-Indexer als auch im SABnzbd-Download-Client
  eintragen. Vorher beliebige Werte funktionieren dann nicht mehr. `apikey` als
  URL-Parameter und `X-Api-Key` als Header werden unterstützt.
- Der Integrationsschlüssel gilt nur für die SABnzbd-/Newznab-Schnittstellen, nicht
  für die Verwaltungs-API. NZB-Links aus authentifizierten Suchantworten erhalten
  eine Signatur für genau diese Datei, damit der Download ohne Browsercookie gelingt.
- Interne Adressen und Docker-Netze bleiben nutzbar. Es gibt keine automatische
  Anmeldeausnahme für lokale Adressen oder `X-Forwarded-For`.
- `/api/health` bleibt für Container-Healthchecks ohne Anmeldung erreichbar und
  liefert ausschließlich einen allgemeinen Status.

Bei jedem Wechsel von deaktivierter zu aktivierter Anmeldung wird der
Integrationsschlüssel automatisch ersetzt, auch beim erneuten Aktivieren eines
vorhandenen Kontos. Den neuen Wert **nach dem Speichern** in den verbundenen
Anwendungen eintragen; alte Schlüssel und NZB-Links werden ungültig.
Änderungen bei bereits aktivierter Anmeldung erfordern das aktuelle Passwort und
melden andere Sitzungen ab. Dabei bleibt der Integrationsschlüssel erhalten,
sofern nicht ausdrücklich ein neuer erzeugt wird. Das Abschalten öffnet Oberfläche
und APIs wieder, daher vorher die Erreichbarkeit auf ein vertrauenswürdiges Netz
begrenzen.

Für Zugriff außerhalb eines vertrauenswürdigen Netzes HTTPS verwenden. Hinter
einem Reverse Proxy `AUTH_PUBLIC_URL` auf den öffentlichen Ursprung setzen, etwa
`https://rundfunk.example.com` (ohne Pfad). Das erlaubt die Prüfung von Browseranfragen
und setzt bei HTTPS sichere Sitzungscookies. `AUTH_COOKIE_SECURE=true` erzwingt
sichere Cookies zusätzlich. Der Proxy muss den Hostnamen weitergeben. Cookies sind
HttpOnly und SameSite=Strict; Passwörter und Sitzungstoken werden nicht im
Browserspeicher abgelegt.

Für öffentlich erreichbare Installationen zusätzlich die Anmeldeversuche am
Reverse Proxy pro tatsächlicher Client-Adresse begrenzen. RundfunkArr reserviert
für Passwortprüfungen ein festes Zwei-Sekunden-Fenster; falsche Passwörter und
abgewiesene Versuche verlängern es nicht. Diese gemeinsame Begrenzung schützt
die Rechenkapazität, verhindert aber keine gezielt getaktete Blockierung neuer
Anmeldungen. Bestehende Sitzungen bleiben dabei nutzbar.

Beispiel für [NGINX-Anfragelimits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html):
Die ersten beiden Direktiven gehören in den `http`-Kontext; den `location`-Block
in den vorhandenen HTTPS-Server integrieren und das Proxy-Ziel anpassen.

```nginx
map $uri $rundfunkarr_login_client {
    default "";
    ~^/api/auth/login/?$ $binary_remote_addr;
}
limit_req_zone $rundfunkarr_login_client zone=rundfunkarr_login:10m rate=5r/m;

location / {
    limit_req zone=rundfunkarr_login burst=5 nodelay;
    limit_req_status 429;
    proxy_set_header Host $http_host;
    proxy_pass http://rundfunkarr:6767;
}
```

Nur Login-Anfragen verbrauchen dieses Limit. Den RundfunkArr-Port von außen
ausschließlich über diesen Proxy erreichbar machen. Ist ein weiterer Proxy oder
ein CDN vorgeschaltet, dessen feste Adressen über
[`set_real_ip_from`](https://nginx.org/en/docs/http/ngx_http_realip_module.html#set_real_ip_from)
als vertrauenswürdig konfigurieren; vom Client gesetzte `X-Forwarded-For`-Werte
dürfen keine neuen Limit-Gruppen erzeugen.

Docker legt die Authentifizierungstabellen beim Start auch für vorhandene
Datenbanken an. Bei nativer Installation vor dem Start `npx prisma migrate deploy`
oder den bereits verwendeten `npx prisma db push`-Ablauf ausführen.

**Passwort vergessen:** Auf dem Server mit Zugriff auf dieselbe Datenbank
`node scripts/reset-auth.mjs --confirm` ausführen; im Container entsprechend
`docker exec rundfunkarr node /app/scripts/reset-auth.mjs --confirm`.
Das deaktiviert die Anmeldung, löscht das Passwort, widerruft alle Sitzungen und
ersetzt den Integrationsschlüssel. Danach im vertrauenswürdigen Netz ein neues
Konto konfigurieren. Ein Neustart allein löscht keine Anmeldung.

### Web-Oberfläche

RundfunkArr bietet eine vollständige Web-Oberfläche mit:

- **Dashboard** - Übersicht über aktive Downloads und letzte Aktivitäten
- **Suche** - Direkte Suche in den Mediatheken
- **Downloads** - Queue und Historie verwalten
- **Settings** - Alle Einstellungen konfigurieren:
  - Download-Pfad, Qualitäts-Präferenzen und optionale MKV-Konvertierung
  - API Keys für TVDB/TMDB
  - Matching-Strategie und Schwellwerte
  - Cache-TTL Einstellungen
- **Setup-Wizard** - Geführte Erstkonfiguration

### Metadaten-Quellen

RundfunkArr sucht Show-Informationen in folgender Reihenfolge:

1. **Lokale Datenbank** (`data/shows.json`) - Kein API Key nötig
2. **TVDB** - Wenn in den Einstellungen konfiguriert (Project API Key ohne PIN oder Subscriber-Key mit optionalem PIN)
3. **TMDB** - Wenn in den Einstellungen konfiguriert (kostenlos)

Für Shows die nicht in TVDB/TMDB sind, können Einträge in `data/shows.json` hinzugefügt werden.

## API Endpoints

### Indexer (Newznab)

| Endpoint | Beschreibung |
|----------|--------------|
| `GET /api/newznab?t=caps` | Capabilities XML |
| `GET /api/newznab?t=tvsearch&tvdbid=123` | TV-Suche nach TVDB ID |
| `GET /api/newznab?t=tvsearch&q=Tatort` | TV-Suche nach Name |
| `GET /api/newznab?t=search` | RSS Feed |

### Downloader (SABnzbd-kompatibel)

| Endpoint | Beschreibung |
|----------|--------------|
| `GET /api?mode=version` | Version |
| `GET /api?mode=get_config` | Konfiguration |
| `GET /api?mode=queue` | Download-Queue |
| `GET /api?mode=history` | Download-Historie |
| `POST /api?mode=addfile&cat=sonarr` | Download hinzufügen |

## Sonarr/Radarr Einrichtung

### Als Indexer (in Prowlarr oder direkt)

1. Indexer hinzufügen → Generic Newznab
2. URL: `http://rundfunkarr:6767/api/newznab`
3. API Key: bei aktivierter Anmeldung der Integrationsschlüssel aus den Sicherheitseinstellungen, sonst beliebig

### Als Download Client

1. Download Client hinzufügen → SABnzbd
2. Host: `rundfunkarr`
3. Port: `6767`
4. API Key: bei aktivierter Anmeldung der Integrationsschlüssel aus den Sicherheitseinstellungen, sonst beliebig

Prowlarr synchronisiert nur den Indexer zu Sonarr und Radarr. Richte RundfunkArr
als Download Client zusätzlich direkt in jeder *arr App ein. Ein in Prowlarr
konfigurierter Download Client wird nur für manuelle Downloads aus Prowlarr
verwendet.

## Rulesets & Shows hinzufügen

### Neue Show hinzufügen

1. Show in `data/shows.json` hinzufügen:
```json
{
  "tvdbId": 123456,
  "name": "Show Name",
  "germanName": "Deutscher Name",
  "aliases": [],
  "episodes": [
    { "name": "Episode 1", "seasonNumber": 1, "episodeNumber": 1, "aired": "2024-01-01" }
  ]
}
```

2. Ruleset in `data/rulesets.json` hinzufügen:
```json
{
  "id": 1001,
  "mediaId": 1001,
  "topic": "Mediathek Topic Name",
  "priority": 0,
  "filters": "[{\"attribute\":\"duration\",\"type\":\"GreaterThan\",\"value\":\"30\"}]",
  "titleRegexRules": "[]",
  "episodeRegex": "(?<=E)(\\d{2})(?=\\))",
  "seasonRegex": "(?<=S)(\\d{2})(?=/E)",
  "matchingStrategy": "SeasonAndEpisodeNumber",
  "media": {
    "media_id": 1001,
    "media_name": "Show Name",
    "media_type": "show",
    "media_tvdbId": 123456,
    "media_tmdbId": null,
    "media_imdbId": null
  }
}
```

3. Pull Request erstellen

## Entwicklung

```bash
# Development mit Hot Reload
npm run dev

# TypeScript Check
npx tsc --noEmit

# Lint
npm run lint

# Datenbank-Migration erstellen
npm run db:migrate
```

## Projektstruktur

```
src/
├── app/               # Next.js App Router
│   ├── api/           # API Routes
│   │   ├── newznab/   # Indexer API (Newznab)
│   │   ├── settings/  # Settings API
│   │   └── route.ts   # Downloader API (SABnzbd)
│   ├── settings/      # Settings Page
│   ├── setup/         # Setup Wizard
│   ├── search/        # Search Page
│   └── downloads/     # Downloads Page
├── components/        # React Components
│   └── layout/        # Sidebar, Navigation
├── contexts/          # React Context
│   └── settings-context.tsx
├── services/          # Business Logic
│   ├── mediathek.ts   # MediathekView API
│   ├── shows.ts       # Unified Show Lookup
│   ├── tvdb.ts        # TVDB API
│   ├── tmdb.ts        # TMDB API
│   ├── newznab.ts     # RSS/XML Generation
│   └── rulesets.ts    # Matching Rules
├── server/            # Server-Side Only
│   ├── download-manager.ts
│   └── ffmpeg.ts
└── lib/               # Utilities
    ├── db.ts          # Prisma Client
    ├── cache.ts       # Dynamic TTL Caches
    └── settings.ts    # Settings Helper
data/
├── shows.json         # Lokale Show-Datenbank
└── rulesets.json      # Matching Rulesets
```

## Credits

- [PCJones/MediathekArr](https://github.com/PCJones/MediathekArr) - Original .NET Implementation
- [MediathekViewWeb](https://github.com/mediathekview/mediathekviewweb) - Mediathek API
- [TheTVDB](https://thetvdb.com) - Metadaten API
- [TMDB](https://www.themoviedb.org) - Metadaten API

## Lizenz

MIT
