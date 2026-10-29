# Lokaler Filmlisten-Index

Unter Einstellungen → Allgemein → **Mediathek-Suchquelle** lässt sich zwischen
**MediathekViewWeb (online)** und dem **lokalen Filmlisten-Index** umschalten. Lokal lädt
RundfunkArr die MediathekView-Filmliste selbst herunter und durchsucht sie, statt jede Suche an
mediathekviewweb.de zu schicken.

<img class="screenshot" src="./screenshots/mediathek-suchquelle.png" alt="Mediathek-Suchquelle in den Einstellungen" width="600">

Die Suche verhält sich wie bei MediathekViewWeb (Wortanfänge, Umlaute als ae/oe/ue, dieselben
Filter) und liefert dieselben Treffer.

## Speicher und Aktualisierung

- Der Index liegt als `filmliste.db` neben der Datenbank (im Docker-Volume `./data`) und benötigt
  etwa 800 MB. Pro Aktualisierung werden rund 80 MB geladen; der Import dauert etwa eine Minute.
- Die Liste wird im eingestellten Intervall (Standard: 2 Stunden) geprüft und nur bei einer neuen
  Version geladen.
- Solange der Index nicht bereit ist, die Liste älter als 24 Stunden ist oder eine Suche
  fehlschlägt, nutzt RundfunkArr weiterhin MediathekViewWeb.

## Voraussetzungen und Umgebungsvariable

- Native Installationen benötigen das Programm `xz` zum Entpacken; das Docker-Image enthält es.
- Ohne Oberfläche lässt sich die Quelle mit `MEDIATHEK_SOURCE=local` (oder `mediathekviewweb`)
  festlegen, etwa in der `docker-compose.yml`. Wie bei den API-Keys gilt sie nur, solange in den
  Einstellungen noch nichts gespeichert wurde.
