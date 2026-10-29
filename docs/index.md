---
layout: home

hero:
  name: RundfunkArr
  text: Mediatheken für Sonarr und Radarr
  tagline: Rundfunk-Indexer, der Sendungen aus ARD, ZDF und weiteren Mediatheken automatisch findet und lädt.
  image:
    src: /logo.svg
    alt: RundfunkArr-Logo
  actions:
    - theme: brand
      text: Installation
      link: /installation
    - theme: alt
      text: Sonarr & Radarr einrichten
      link: /einrichtung
    - theme: alt
      text: GitHub
      link: https://github.com/rundfunkarr/rundfunkarr

features:
  - title: Newznab-Indexer
    details: Funktioniert mit Prowlarr, NZB Hydra, Sonarr und Radarr. Suche nach TVDB-ID oder Name, RSS-Sync inklusive.
  - title: SABnzbd-kompatibler Downloader
    details: Lädt direkt per HTTP aus den Mediatheken, optional mit MKV-Konvertierung samt deutschen Sprachmetadaten und Untertiteln.
  - title: SRF und ORF über HLS
    details: HLS-Streams per yt-dlp, optional mit Proxy. Die MKV-Einstellung gilt auch hier.
    link: /hls
  - title: Benachrichtigungen
    details: Webhook, ntfy, Gotify und Discord bei fertigen oder fehlgeschlagenen Downloads.
    link: /benachrichtigungen
  - title: Metadaten aus mehreren Quellen
    details: Lokale Datenbank, TVDB oder TMDB, ergänzt um Community-Rulesets per Pull Request.
    link: /rulesets
  - title: Lokaler Filmlisten-Index
    details: Optional die MediathekView-Filmliste selbst laden und lokal durchsuchen.
    link: /filmliste
---

<div class="vp-doc" style="max-width: 1152px; margin: 48px auto 0; padding: 0 24px">

<img class="screenshot" src="./screenshots/dashboard.png" alt="Dashboard mit Suche, Statuskacheln, aktiven Downloads und letzten Aktivitäten">

<div class="screenshot-row">
  <img class="screenshot" src="./screenshots/search.png" alt="Mediathek-Suche mit Filtern und Trefferliste">
  <img class="screenshot" src="./screenshots/downloads.png" alt="Download-Warteschlange mit Fortschritt und Steuerung">
</div>

</div>
