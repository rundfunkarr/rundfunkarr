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
    mediaMetadata TEXT,
    warning TEXT,
    subtitleArtifact TEXT,
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
    id TEXT NOT NULL PRIMARY KEY,
    topic TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    tmdbId INTEGER,
    cachedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
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
CREATE TABLE IF NOT EXISTS "SearchSubscription" (
 "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "query" TEXT NOT NULL,
 "channel" TEXT NOT NULL DEFAULT '', "minMinutes" INTEGER NOT NULL DEFAULT 0,
 "maxMinutes" INTEGER NOT NULL DEFAULT 0, "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
 "quality" TEXT NOT NULL DEFAULT 'high', "action" TEXT NOT NULL DEFAULT 'notify',
 "category" TEXT NOT NULL DEFAULT 'default', "paused" BOOLEAN NOT NULL DEFAULT false,
 "initialized" BOOLEAN NOT NULL DEFAULT false, "lastCheckedAt" DATETIME,
 "nextCheckAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastError" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "SubscriptionMatch" (
 "id" TEXT NOT NULL PRIMARY KEY, "subscriptionId" TEXT NOT NULL, "sourceKey" TEXT NOT NULL,
 "title" TEXT NOT NULL, "topic" TEXT NOT NULL, "channel" TEXT NOT NULL,
 "videoUrl" TEXT NOT NULL, "websiteUrl" TEXT NOT NULL, "duration" INTEGER NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'new', "downloadId" TEXT, "foundAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SubscriptionMatch_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "SearchSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "SearchSubscription_paused_nextCheckAt_idx" ON "SearchSubscription"("paused","nextCheckAt");
CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionMatch_subscriptionId_sourceKey_key" ON "SubscriptionMatch"("subscriptionId","sourceKey");
CREATE INDEX IF NOT EXISTS "SubscriptionMatch_subscriptionId_state_foundAt_idx" ON "SubscriptionMatch"("subscriptionId","state","foundAt");
CREATE TABLE IF NOT EXISTS "AuthConfig" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "username" TEXT NOT NULL DEFAULT '',
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "apiKey" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "loginBlockedUntil" DATETIME
);
CREATE TABLE IF NOT EXISTS "AuthSession" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "revision" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);
CREATE INDEX IF NOT EXISTS "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
