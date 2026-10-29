# Post-Processing-Skripte

Wie bei SABnzbd kann nach jedem Download ein eigenes Skript laufen. Es startet, wenn die Datei
samt Untertiteln fertig im Zielordner liegt (also nach einer MKV-Konvertierung) und bevor Sonarr
oder Radarr den Download als abgeschlossen sehen. Solange es läuft, steht der Download in der
Warteschlange auf **Skript läuft** (SABnzbd-Status `Running`).

## Einrichten

1. Skript in den Skriptordner legen und ausführbar machen. Standard ist der Ordner `scripts`
   neben der Datenbank, bei Docker also `./data/scripts` auf dem Host:

   ```bash
   mkdir -p data/scripts
   cp mein-skript.sh data/scripts/
   chmod +x data/scripts/mein-skript.sh
   ```

2. Unter Einstellungen → Allgemein → **Post-Processing-Skript** das Skript auswählen und
   speichern.

## Parameter

Das Skript erhält dieselben Parameter wie bei SABnzbd, sodass vorhandene Skripte weiter
funktionieren:

| Parameter | Inhalt                       |
| --------- | ---------------------------- |
| `$1`      | Zielordner des Downloads     |
| `$2`      | Name mit `.nzb`-Endung       |
| `$3`      | Name des Downloads           |
| `$4`      | leer (Indexer-ID)            |
| `$5`      | Kategorie, z. B. `sonarr`    |
| `$6`      | leer (Newsgroup)             |
| `$7`      | Status, immer `0` (OK)       |
| `$8`      | leer                         |

Zusätzlich gibt es die Umgebungsvariablen `SAB_COMPLETE_DIR`, `SAB_FINAL_NAME`, `SAB_FILENAME`,
`SAB_NZO_ID`, `SAB_CAT`, `SAB_PP_STATUS`, `SAB_STATUS`, `SAB_BYTES` und `SAB_URL` (Quell-URL der
Mediathek). `RUNDFUNKARR_FILE` enthält den vollständigen Pfad der Videodatei,
`RUNDFUNKARR_STORAGE_PATH` denselben Pfad aus Sicht von Sonarr/Radarr (siehe
[`DOWNLOAD_FOLDER_PATH_MAPPING`](./einrichtung#pfade)). Das Arbeitsverzeichnis ist der Zielordner.

```sh
#!/bin/sh
# Beispiel: Benachrichtigung per ntfy
curl -s -d "Fertig: $3 ($5)" https://ntfy.sh/mein-thema
```

## Verhalten

- Die Ausgabe des Skripts erscheint unter **Diagnose & Protokoll**.
- Ein Exit-Code ungleich 0 macht den Download nicht fehlerhaft. Wie in SABnzbd erscheint
  `Exit(<Code>)` mit der letzten Ausgabezeile als Hinweis in der Historie. Zugangsdaten darin
  werden wie im Protokoll geschwärzt.
- Läuft ein Skript länger als 30 Minuten, wird es beendet; der Download gilt dann mit Hinweis als
  abgeschlossen.
- Wird der Download pausiert oder abgebrochen, während das Skript läuft, endet das Skript
  ebenfalls. Der Download wird dann nicht abgeschlossen, und die fertige Datei wird wieder
  entfernt. Nach dem Fortsetzen wird sie neu geladen.
- Verschiebt oder löscht das Skript die Videodatei, kann Sonarr/Radarr sie nicht mehr
  importieren.
- Auswählbar sind nur Dateien aus dem Skriptordner. Den Ordner legt ausschließlich
  `POST_PROCESS_SCRIPTS_DIR` fest; über die Weboberfläche lässt er sich nicht ändern.

::: tip Docker-Image
Das Docker-Image basiert auf Alpine und enthält `sh` und `curl`, aber weder `bash` noch Python.
Skripte mit `#!/bin/bash` laufen dort nicht.
:::
