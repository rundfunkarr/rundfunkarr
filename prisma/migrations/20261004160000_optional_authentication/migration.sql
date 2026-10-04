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
