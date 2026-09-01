# Beitragen zu RundfunkArr

Vielen Dank für dein Interesse an RundfunkArr! Wir freuen uns über jede Art von Beitrag.

## Sprache

- **Dokumentation**: Deutsch
- **Code & Kommentare**: Englisch
- **Commit Messages**: Englisch (Conventional Commits)
- **Issues & Pull Requests**: Deutsch oder Englisch

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

Wir verwenden [Conventional Commits](https://www.conventionalcommits.org/) für einheitliche Commit Messages:

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
feat(indexer): add support for Arte mediathek
fix(download): handle timeout errors gracefully
docs: update installation instructions
chore(deps): update eslint to v9
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
