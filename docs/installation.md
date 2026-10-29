# Installation

Am einfachsten läuft RundfunkArr als Docker-Container. Images gibt es für `linux/amd64` und
`linux/arm64`.

## Docker Compose

```yaml
services:
  rundfunkarr:
    image: ghcr.io/rundfunkarr/rundfunkarr:latest
    container_name: rundfunkarr
    environment:
      - TZ=Europe/Berlin
      - PUID=1000 # User ID (id -u)
      - PGID=1000 # Group ID (id -g)
      - DOWNLOAD_FOLDER_PATH=/downloads
    volumes:
      - ./data:/app/prisma/data
      - ./downloads:/downloads
    ports:
      - 6767:6767
    restart: unless-stopped
```

```bash
docker compose up -d
```

Nach dem Start ist die Weboberfläche unter `http://localhost:6767` erreichbar. Beim ersten Start
führt der **Setup-Wizard** durch die Konfiguration (API-Keys, Pfade usw.). Danach geht es mit der
[Einrichtung in Sonarr, Radarr und Prowlarr](./einrichtung) weiter.

## Image-Tags

| Tag                       | Inhalt                                               |
| ------------------------- | ---------------------------------------------------- |
| `latest`                  | Neuestes Release                                     |
| `1.4.0`, `v1.4.0`         | Feste Version für reproduzierbare Deployments        |
| `nightly`                 | Neuester täglicher Build des aktuellen `main`-Stands |
| `nightly-20260517` (usw.) | Konkreter Nightly-Build, bleibt erhalten             |

```yaml
image: ghcr.io/rundfunkarr/rundfunkarr:1.4.0
```

Unten in der Seitenleiste und unter Einstellungen → System steht bei Release-Images die Version
(z. B. `v1.4.0`), bei `main`- und Nightly-Images der Kanal mit Commit (z. B. `main · 5e0d419`).

## Manuelle Installation

### Voraussetzungen

- Node.js 24 oder neuer
- npm
- FFmpeg (für die MKV-Konvertierung)
- xz (nur für den optionalen [lokalen Filmlisten-Index](./filmliste))

### Setup

```bash
# Abhängigkeiten installieren
npm install

# Datenbank initialisieren
npx prisma migrate dev

# Entwicklungsserver starten
npm run dev

# Oder Production-Build
npm run build
npm start
```

Docker legt fehlende Datenbanktabellen beim Start selbst an. Bei nativer Installation vor dem
Start `npx prisma migrate deploy` oder den bereits verwendeten `npx prisma db push`-Ablauf
ausführen.
