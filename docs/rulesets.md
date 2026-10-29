# Rulesets & Shows

Rulesets ordnen Treffer aus den Mediatheken den Episoden einer Serie zu. Mitgelieferte
Community-Rulesets liegen in `data/rulesets.json`, lokale Überschreibungen lassen sich in der
Weboberfläche unter **Rulesets** anlegen und prüfen.

## Neue Show hinzufügen

1. Show in `data/shows.json` eintragen (nur nötig, wenn sie nicht in TVDB/TMDB steht):

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

2. Ruleset in `data/rulesets.json` eintragen:

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

3. Lokal prüfen, etwa über `http://localhost:3000/api/newznab?t=tvsearch&tvdbid=123456`, und einen
   Pull Request erstellen. Details stehen in der
   [CONTRIBUTING.md](https://github.com/rundfunkarr/rundfunkarr/blob/main/CONTRIBUTING.md).

## Felder

- **`topic`**: der exakte Name des Themas in der Mediathek (z. B. „Tatort“, „heute-show“)
- **`filters`**: Filter, etwa für die Dauer. Typen: `ExactMatch`, `Contains`, `Regex`,
  `GreaterThan`, `LessThan`
- **`titleRegexRules`**: Regeln, aus denen der Episodentitel für den Abgleich zusammengesetzt wird
- **`episodeRegex`** / **`seasonRegex`**: Regex zum Auslesen von Episoden- und Staffelnummer
- **`matchingStrategy`**:
  - `SeasonAndEpisodeNumber`: Staffel und Episode aus dem Titel (S01E01)
  - `ItemTitleIncludes`: zusammengesetzter Titel ähnelt dem Episodentitel (Schwellwert aus den
    Einstellungen)
  - `ItemTitleExact`: wie oben, aber strenger
  - `ItemTitleEqualsAirdate`: zusammengesetzter Titel enthält ein Datum, das mit dem
    Ausstrahlungsdatum der Episode abgeglichen wird

## Grenzen für reguläre Ausdrücke

Eigene und Community-Ausdrücke laufen in einem separaten Worker mit einem Zeitlimit von 100 ms, in
der Vorschau wie bei der regulären Suche. JavaScript-Regex-Syntax einschließlich Lookarounds und
Rückverweisen bleibt unterstützt. Ein Ausdruck, der das Limit überschreitet, bricht die aktuelle
Auswertung ab und wird für eine Minute abgelehnt; vor einem neuen Versuch den Ausdruck
vereinfachen. Die Vorschau zeigt dann einen Fehler statt einer unvollständigen Trefferliste.

Der gemeinsame Worker nimmt höchstens 64 wartende Auswertungen an, mit maximal zwei Sekunden
Wartezeit. Ausdrücke sind auf 4.096 Zeichen begrenzt, Eingabefelder auf 65.536 Zeichen
(UTF-16-Code-Units); zu lange Werte werden abgelehnt, nie gekürzt. Der Regeleditor behält sein
strengeres Limit von 300 Zeichen pro Ausdruck.
