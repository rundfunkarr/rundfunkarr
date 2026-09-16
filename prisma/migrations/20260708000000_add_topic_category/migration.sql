-- CreateTable
CREATE TABLE "TopicCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topic" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tmdbId" INTEGER,
    "cachedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "TopicCategory_topic_key" ON "TopicCategory"("topic");

-- CreateIndex
CREATE INDEX "TopicCategory_topic_idx" ON "TopicCategory"("topic");

-- CreateIndex
CREATE INDEX "Download_status_idx" ON "Download"("status");
