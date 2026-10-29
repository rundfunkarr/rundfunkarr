# Stage 1: Dependencies
FROM node:24-alpine AS deps
WORKDIR /app

# Install dependencies needed for native modules
RUN apk add --no-cache libc6-compat

# Copy package files and prisma schema (needed for postinstall)
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Stage 2: Builder
FROM node:24-alpine AS builder
WORKDIR /app

# Copy dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Version label for the UI, set by the image workflow: the release version for tags
# ("1.4.0"), otherwise the channel ("main", "nightly", "pr-71") plus commit. Without
# these build args the UI shows the package.json version.
ARG APP_VERSION=""
ARG APP_COMMIT=""
ENV NEXT_PUBLIC_APP_VERSION=$APP_VERSION \
    NEXT_PUBLIC_APP_COMMIT=$APP_COMMIT

# Build the application
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Move standalone files to fixed location
# Handle both cases: files directly in standalone/ OR in a subdirectory
RUN mkdir -p /app/standalone-out && \
    if [ -f /app/.next/standalone/server.js ]; then \
      echo "Files directly in standalone/" && \
      cd /app/.next/standalone && tar cf - . | tar xf - -C /app/standalone-out/; \
    else \
      echo "Files in subdirectory" && \
      cd /app/.next/standalone/*/ && tar cf - . | tar xf - -C /app/standalone-out/; \
    fi && \
    ls -la /app/standalone-out/

# The server only loads Prisma's Node library engine (.prisma/client/index.js ->
# runtime/library.js + libquery_engine-*.node). Tracing follows every export
# condition of the generated client and copies the edge, browser and WebAssembly
# runtimes for all databases (~60 MB). outputFileTracingExcludes cannot drop them
# because Next.js does not apply it to the instrumentation and proxy traces.
RUN cd /app/standalone-out/node_modules \
    && test -f @prisma/client/runtime/library.js \
    && find @prisma/client/runtime -type f ! -name library.js -delete \
    && rm -f .prisma/client/edge.js .prisma/client/wasm.js .prisma/client/index-browser.js \
       .prisma/client/query_engine_bg.js .prisma/client/query_engine_bg.wasm \
    && ls .prisma/client/libquery_engine-*.so.node

# Stage 3: yt-dlp
FROM node:24-alpine AS ytdlp
RUN apk add --no-cache curl
COPY src/server/ytdlp-release.json /tmp/ytdlp-release.json

# Select the standalone musl binary for the image's architecture.
RUN case "$(apk --print-arch)" in \
        x86_64) asset=yt-dlp_musllinux ;; \
        aarch64) asset=yt-dlp_musllinux_aarch64 ;; \
        *) echo "Unsupported yt-dlp architecture" >&2; exit 1 ;; \
    esac \
    && version=$(node -p 'require("/tmp/ytdlp-release.json").version') \
    && checksum=$(node -p 'require("/tmp/ytdlp-release.json").sha256[process.argv[1]]' "$asset") \
    && curl -fL "https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${asset}" -o /usr/local/bin/yt-dlp \
    && echo "$checksum  /usr/local/bin/yt-dlp" | sha256sum -c - \
    && chmod +x /usr/local/bin/yt-dlp

# Stage 4: Runner
FROM node:24-alpine AS runner
WORKDIR /app

# Install runtime dependencies for FFmpeg, user management, and DB init
# Note: yt-dlp standalone binary includes bundled Python, no separate install needed
RUN apk add --no-cache \
    tar \
    xz \
    wget \
    su-exec \
    shadow \
    sqlite \
    ffmpeg \
    && rm -rf /var/cache/apk/*

COPY --from=ytdlp /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Create directories for data and downloads
# Symlink system FFmpeg and yt-dlp so the app finds them at expected locations
RUN mkdir -p /app/prisma/data /app/downloads /app/ffmpeg /app/ytdlp \
    && ln -s /usr/bin/ffmpeg /app/ffmpeg/ffmpeg \
    && ln -s /usr/local/bin/yt-dlp /app/ytdlp/yt-dlp \
    && chown -R nextjs:nodejs /app

# Copy with ownership set directly: a later "chown -R /app" would store every
# application file a second time in its own layer.
COPY --chown=nextjs:nodejs --from=builder /app/public ./public
COPY --chown=nextjs:nodejs --from=builder /app/standalone-out/ ./
COPY --chown=nextjs:nodejs --from=builder /app/.next/static ./.next/static

# Prisma schema and migrations for reference; the client and its query engine
# come with the standalone output. The database is created from init-db.sql.
COPY --chown=nextjs:nodejs --from=builder /app/prisma ./prisma

# Copy database init script
COPY --chown=nextjs:nodejs init-db.sql /app/init-db.sql
COPY --chown=nextjs:nodejs scripts/reset-auth.mjs /app/scripts/reset-auth.mjs

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Expose port
EXPOSE 6767

# Environment variables
ENV PORT=6767
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/prisma/data/rundfunkarr.db"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -q --spider http://localhost:6767/api/health || exit 1

# Start the application with entrypoint for PUID/PGID support
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
