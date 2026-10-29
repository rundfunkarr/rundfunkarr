# Sonarr, Radarr & Prowlarr

RundfunkArr arbeitet gleichzeitig als **Indexer** (Newznab) und als **Download-Client**
(SABnzbd). Beides muss eingerichtet werden.

## Als Indexer

In Prowlarr oder direkt in Sonarr/Radarr:

1. Indexer hinzufügen → **Generic Newznab**
2. URL: `http://rundfunkarr:6767/api/newznab`
3. API-Key: bei aktivierter [Anmeldung](./sicherheit#optionale-anmeldung) der
   Integrationsschlüssel aus den Sicherheitseinstellungen, sonst beliebig

## Als Download-Client

In jeder *arr-App:

1. Download-Client hinzufügen → **SABnzbd**
2. Host: `rundfunkarr`
3. Port: `6767`
4. API-Key: bei aktivierter Anmeldung der Integrationsschlüssel, sonst beliebig

::: warning Prowlarr synchronisiert nur den Indexer
Prowlarr überträgt den Indexer an Sonarr und Radarr, nicht aber den Download-Client. Richte
RundfunkArr deshalb in jeder *arr-App zusätzlich direkt als Download-Client ein. Ein in Prowlarr
konfigurierter Download-Client wird nur für manuelle Downloads aus Prowlarr verwendet.
:::

## Pfade

Sonarr und Radarr importieren die fertige Datei über den Pfad, den RundfunkArr meldet. Sieht die
*arr-App den Download-Ordner unter einem anderen Pfad als RundfunkArr (etwa in einem anderen
Container), trägt `DOWNLOAD_FOLDER_PATH_MAPPING` diesen Pfad ein. RundfunkArr meldet dann
`<Mapping>/<Kategorie>/<Download-ID>/<Datei>` statt des eigenen Pfads. Alle Umgebungsvariablen
stehen unter [Konfiguration](./konfiguration#umgebungsvariablen).
