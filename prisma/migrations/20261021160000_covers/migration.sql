-- Poster for cached series and preview images of programme pages
ALTER TABLE "TvdbSeries" ADD COLUMN "image" TEXT;

CREATE TABLE "WebsitePreview" (
    "url" TEXT NOT NULL PRIMARY KEY,
    "imageUrl" TEXT,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

CREATE INDEX "WebsitePreview_expiresAt_idx" ON "WebsitePreview"("expiresAt");
