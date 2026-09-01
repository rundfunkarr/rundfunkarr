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

# Stage 3: Runner
FROM node:24-alpine AS runner
WORKDIR /app

# Install runtime dependencies for FFmpeg, user management, and DB init
RUN apk add --no-cache \
    tar \
    xz \
    wget \
    su-exec \
    shadow \
    sqlite \
    ffmpeg \
    && rm -rf /var/cache/apk/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public folder
COPY --from=builder /app/public ./public

# Copy standalone build
COPY --from=builder /app/standalone-out/ ./
COPY --from=builder /app/.next/static ./.next/static

# Copy Prisma files (client only, no CLI)
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copy database init script
COPY init-db.sql /app/init-db.sql

# Create directories for data and downloads
# Symlink system FFmpeg so the app finds it at expected location
RUN mkdir -p /app/prisma/data /app/downloads /app/ffmpeg \
    && ln -s /usr/bin/ffmpeg /app/ffmpeg/ffmpeg \
    && chown -R nextjs:nodejs /app

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
    CMD wget -q --spider http://localhost:6767/api/download?mode=version || exit 1

# Start the application with entrypoint for PUID/PGID support
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
