# Entwicklung

Wie man beiträgt, steht ausführlich in der
[CONTRIBUTING.md](https://github.com/rundfunkarr/rundfunkarr/blob/main/CONTRIBUTING.md). Kurz:

```bash
npm install
npx prisma migrate dev

npm run dev          # Entwicklungsserver mit Hot Reload
npm run lint         # ESLint
npm run typecheck    # TypeScript
npm run test         # Vitest
npm run db:migrate   # Datenbank-Migration erstellen
```

## Projektstruktur

```
src/
├── app/               # Next.js App Router
│   ├── api/           # API Routes
│   │   ├── newznab/   # Indexer-API (Newznab)
│   │   ├── settings/  # Settings-API
│   │   └── route.ts   # Downloader-API (SABnzbd)
│   ├── settings/      # Einstellungen
│   ├── setup/         # Setup-Wizard
│   ├── search/        # Suche
│   └── downloads/     # Downloads
├── components/        # React-Komponenten
├── contexts/          # React Context
├── services/          # Geschäftslogik (MediathekView, TVDB, TMDB, Newznab, Rulesets)
├── server/            # Nur serverseitig (Download-Manager, FFmpeg, Filmlisten-Index)
└── lib/               # Hilfsfunktionen (Prisma, Caches, Settings)
data/
├── shows.json         # Lokale Show-Datenbank
└── rulesets.json      # Matching-Rulesets
docs/                  # Diese Dokumentation (VitePress)
```

## Diese Dokumentation

Die Seite liegt unter `docs/` und wird mit [VitePress](https://vitepress.dev) gebaut. Änderungen
auf `main` veröffentlicht ein GitHub-Actions-Workflow automatisch auf GitHub Pages.

```bash
cd docs
npm install
npm run dev
```

## Credits

- [PCJones/MediathekArr](https://github.com/PCJones/MediathekArr): ursprüngliche .NET-Implementierung
- [MediathekViewWeb](https://github.com/mediathekview/mediathekviewweb): Mediathek-API
- [TheTVDB](https://thetvdb.com) und [TMDB](https://www.themoviedb.org): Metadaten-APIs
