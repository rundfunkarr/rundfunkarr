-- Initialize RundfunkArr database schema

CREATE TABLE IF NOT EXISTS TvdbSeries (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    germanName TEXT,
    slug TEXT,
    overview TEXT,
    aliases TEXT,
    firstAired DATETIME,
    cachedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS TvdbEpisode (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seriesId INTEGER NOT NULL,
    seasonNumber INTEGER NOT NULL,
    episodeNumber INTEGER NOT NULL,
    name TEXT,
    aired DATETIME,
    runtime INTEGER,
    FOREIGN KEY (seriesId) REFERENCES TvdbSeries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS TvdbEpisode_seriesId_seasonNumber_episodeNumber_idx
ON TvdbEpisode(seriesId, seasonNumber, episodeNumber);

CREATE TABLE IF NOT EXISTS Download (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    progress INTEGER DEFAULT 0,
    size BIGINT DEFAULT 0,
    totalSize BIGINT DEFAULT 0,
    downloadedBytes BIGINT DEFAULT 0,
    speed BIGINT DEFAULT 0,
    filePath TEXT,
    error TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    completedAt DATETIME
);

CREATE INDEX IF NOT EXISTS Download_status_idx ON Download(status);

CREATE TABLE IF NOT EXISTS Config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS GeneratedRuleset (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL UNIQUE,
    tvdbId INTEGER NOT NULL,
    showName TEXT NOT NULL,
    germanName TEXT,
    matchingStrategy TEXT DEFAULT 'SeasonAndEpisodeNumber',
    filters TEXT DEFAULT '[{"attribute":"duration","type":"GreaterThan","value":"15"}]',
    episodeRegex TEXT DEFAULT '(?<=[E/])(\d{2})(?=\))',
    seasonRegex TEXT DEFAULT '(?<=[S(])(\d{2})(?=[/E])',
    titleRegexRules TEXT DEFAULT '[]',
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS GeneratedRuleset_tvdbId_idx ON GeneratedRuleset(tvdbId);

CREATE TABLE IF NOT EXISTS TopicCategory (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    tmdbId INTEGER,
    cachedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS TopicCategory_topic_idx ON TopicCategory(topic);

-- Prisma migrations table (for compatibility)
CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    finished_at DATETIME,
    migration_name TEXT NOT NULL,
    logs TEXT,
    rolled_back_at DATETIME,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    applied_steps_count INTEGER DEFAULT 0
);
