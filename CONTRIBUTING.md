# Beitragen zu RundfunkArr

Vielen Dank für dein Interesse an RundfunkArr! Wir freuen uns über jede Art von Beitrag.

## Sprache

- **Dokumentation & Oberfläche**: Deutsch
- **Code & Kommentare**: Englisch
- **Commit Messages**: Deutsch (Conventional Commits; Type und Scope bleiben englisch)
- **Issues & Pull Requests**: Deutsch

## Entwicklungsumgebung einrichten

### Voraussetzungen

- Node.js >= 24
- npm
- FFmpeg (optional, für MKV-Konvertierung)
- Git

### Setup

```bash
# Repository klonen
git clone https://github.com/your-username/rundfunkarr.git
cd rundfunkarr

# Dependencies installieren
npm install

# Datenbank initialisieren
npx prisma migrate dev

# Development Server starten
npm run dev
```

### Verfügbare Scripts

| Script | Beschreibung |
|--------|--------------|
| `npm run dev` | Startet den Development Server mit Hot Reload |
| `npm run build` | Erstellt einen Production Build |
| `npm run lint` | Führt ESLint aus |
| `npm run lint:fix` | Führt ESLint mit Auto-Fix aus |
| `npm run format` | Formatiert Code mit Prettier |
| `npm run format:check` | Prüft Formatierung mit Prettier |
| `npm run typecheck` | Führt TypeScript Type-Checking aus |

## Pull Requests

### Workflow

1. Fork das Repository
2. Erstelle einen Feature Branch: `git checkout -b feature/mein-feature`
3. Mache deine Änderungen
4. Stelle sicher, dass alle Checks bestehen:
   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm run build
   ```
5. Committe deine Änderungen mit Conventional Commits
6. Push zu deinem Fork
7. Erstelle einen Pull Request

### Conventional Commits

Wir verwenden [Conventional Commits](https://www.conventionalcommits.org/) für einheitliche Commit Messages. Type und Scope sind englische Schlüsselwörter, Beschreibung und Body schreiben wir auf Deutsch:

```
<type>(<scope>): <description>

[optional body]
```

**Types:**

| Type | Beschreibung |
|------|--------------|
| `feat` | Neues Feature |
| `fix` | Bugfix |
| `docs` | Dokumentation |
| `style` | Formatierung (kein Code-Change) |
| `refactor` | Code-Refactoring |
| `perf` | Performance-Verbesserung |
| `test` | Tests hinzufügen/ändern |
| `chore` | Build-Prozess, Dependencies |

**Beispiele:**

```
feat(indexer): Unterstützung für die Arte-Mediathek hinzufügen
fix(download): Zeitüberschreitungen sauber behandeln
docs: Installationsanleitung aktualisieren
chore(deps): ESLint auf v9 aktualisieren
```

## Shows & Rulesets hinzufügen

Eine der einfachsten Möglichkeiten beizutragen ist das Hinzufügen neuer Shows und Rulesets.

### Neue Show hinzufügen

1. **Show in `data/shows.json` hinzufügen:**

```json
{
  "tvdbId": 123456,
  "name": "Show Name (English)",
  "germanName": "Show Name (Deutsch)",
  "aliases": ["Alternativer Name"],
  "episodes": [
    {
      "name": "Episode Title",
      "seasonNumber": 1,
      "episodeNumber": 1,
      "aired": "2024-01-01"
    }
  ]
}
```

2. **Ruleset in `data/rulesets.json` hinzufügen:**

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

### Tipps für Rulesets

- **`topic`**: Der exakte Name des Themas in der Mediathek (z.B. "Tatort", "heute-show")
- **`episodeRegex`**: Regex zum Extrahieren der Episodennummer aus dem Titel
- **`seasonRegex`**: Regex zum Extrahieren der Staffelnummer
- **`filters`**: Filter für Dauer, Qualität etc.
- **`matchingStrategy`**:
  - `SeasonAndEpisodeNumber` - Klassische S01E01-Nummerierung
  - `DateBased` - Datum-basiertes Matching
  - `TitleMatch` - Titel-basiertes Matching

### Testen

Teste dein Ruleset lokal:

1. Starte den Development Server: `npm run dev`
2. Rufe den Newznab-Endpoint auf: `http://localhost:3000/api/newznab?t=tvsearch&tvdbid=123456`
3. Prüfe ob die Episoden korrekt gematcht werden

## Code Style

- Wir verwenden ESLint und Prettier für konsistenten Code Style
- Pre-commit Hooks prüfen automatisch Lint und Formatierung
- TypeScript Strict Mode ist aktiviert

### Regeln

- Keine unbenutzten Variablen (außer mit `_` Prefix)
- `console.log` ist für Server-Logging erlaubt
- Explizite `any` Types sind als Warning markiert

## Oberfläche

Die Web-Oberfläche folgt einem kleinen Baukasten, damit neue Seiten gleich aussehen:

- **Farben** kommen ausschließlich aus den Tokens in `src/app/globals.css`. Die Akzentfarbe
  (`primary`) ist das Orange des Logos und bleibt der Hauptaktion, aktiven Navigationspunkten
  und dem Fortschrittsbalken vorbehalten. Zustände verwenden nur `ok`, `info`, `warn` und
  `danger` - immer zusammen mit Text oder Symbol, nie als Farbe allein.
- **Seitenaufbau**: `Page` und `PageHeader` aus `src/components/shared/page.tsx` für Rahmen,
  Titel, Beschreibung und Aktionen; Inhalte in `Card`.
- **Formulare**: `Field` (Label, Steuerelement, Hinweis), `ToggleRow` mit `Switch`, `Input`,
  `Select` und `Textarea` aus `src/components/ui`. Keine handgeschriebenen `select`-Klassen.
- **Zustände**: `Notice` für Fehler und Hinweise, `EmptyState` für leere Listen,
  `getStatusBadge` für Download-Status, `ChannelBadge` für Sender.
- **Bilder**: `Thumbnail` zeigt Standbilder (16:9) und Poster (2:3). Es nutzt eine vom
  Server gelieferte Bildadresse oder fragt `/api/thumbnail` nach dem Vorschaubild der
  Sendungsseite, sobald das Element sichtbar wird; ohne Bild bleibt ein ruhiger Platzhalter.
- **Schrift**: Dateinamen, Schlüssel, Adressen, Protokolle und Zahlenkolonnen in `font-mono`
  bzw. `tabular`; Beschriftungen in Tabellen und Kacheln über die Klasse `eyebrow`.
- **Bewegung**: nur der Signalpunkt (`LiveDot`) für laufende Downloads; alles andere bleibt
  ruhig und respektiert `prefers-reduced-motion`.
- Helle und dunkle Darstellung müssen beide funktionieren; die Umschaltung sitzt in der
  Seitenleiste.

## Issues

### Bug Reports

Bitte verwende das Bug Report Template und füge folgende Informationen hinzu:

- Beschreibung des Problems
- Schritte zur Reproduktion
- Erwartetes vs. tatsächliches Verhalten
- Umgebung (OS, Node Version, Docker etc.)
- Relevante Logs

### Feature Requests

Beschreibe:

- Was soll das Feature tun?
- Warum ist es nützlich?
- Gibt es bestehende Alternativen?

## Fragen?

Bei Fragen erstelle gerne ein Issue mit dem Label "question" oder starte eine Discussion.
