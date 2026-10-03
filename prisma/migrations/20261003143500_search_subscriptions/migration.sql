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
