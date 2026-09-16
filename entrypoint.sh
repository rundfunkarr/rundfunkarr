#!/bin/sh
set -e

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

PUID=${PUID:-1001}
PGID=${PGID:-1001}

echo "Starting with UID: $PUID, GID: $PGID"

# Get or create group with desired GID
GROUP_NAME=$(getent group "$PGID" | cut -d: -f1)
if [ -z "$GROUP_NAME" ]; then
    echo "Creating group 'appgroup' with GID $PGID"
    addgroup -g "$PGID" appgroup
    GROUP_NAME="appgroup"
else
    echo "Using existing group '$GROUP_NAME' for GID $PGID"
fi

# Get or create user with desired UID
USER_NAME=$(getent passwd "$PUID" | cut -d: -f1)
if [ -z "$USER_NAME" ]; then
    echo "Creating user 'appuser' with UID $PUID in group $GROUP_NAME"
    adduser -u "$PUID" -G "$GROUP_NAME" -s /bin/sh -D appuser
    USER_NAME="appuser"
else
    echo "Using existing user '$USER_NAME' for UID $PUID"
fi

echo "Running as user: $USER_NAME ($(id "$USER_NAME"))"

# Ensure required directories exist with correct permissions
DOWNLOAD_DIR="${DOWNLOAD_FOLDER_PATH:-/app/downloads}"
TEMP_DIR="${DOWNLOAD_TEMP_PATH:-$DOWNLOAD_DIR/incomplete}"
echo "Ensuring required directories exist..."
mkdir -p /app/prisma/data "$DOWNLOAD_DIR" "$TEMP_DIR"
echo "Directories created/verified: /app/prisma/data, $DOWNLOAD_DIR, $TEMP_DIR"

# Fix ownership and permissions of app directories
echo "Setting ownership to $PUID:$PGID..."
chown -R "$PUID:$PGID" /app/prisma/data /app/ffmpeg 2>/dev/null || echo "Note: Could not chown /app directories"
chown -R "$PUID:$PGID" "$DOWNLOAD_DIR" "$TEMP_DIR" 2>/dev/null || echo "Note: Could not chown download directories (this is normal for mounted volumes)"

echo "Setting permissions..."
chmod -R 755 /app/prisma/data 2>/dev/null || true
chmod -R 755 "$DOWNLOAD_DIR" "$TEMP_DIR" 2>/dev/null || echo "Note: Could not chmod download directories (this is normal for mounted volumes)"

# Show actual permissions for debugging
echo "Download directory permissions:"
ls -la "$DOWNLOAD_DIR" 2>&1 || echo "Cannot list $DOWNLOAD_DIR"

DB_PATH="/app/prisma/data/rundfunkarr.db"

echo "Checking database volume writability..."
# shellcheck disable=SC2016
if ! su-exec "$USER_NAME" sh -c 'tmp="$1/.rundfunkarr-write-test.$$"; touch "$tmp" && rm -f "$tmp"' sh /app/prisma/data; then
    fail "Database directory /app/prisma/data is not writable by UID $PUID/GID $PGID. Fix the host volume ownership/permissions or set PUID/PGID to a user that can write there."
fi

# shellcheck disable=SC2016
if [ -e "$DB_PATH" ] && ! su-exec "$USER_NAME" sh -c ': >> "$1"' sh "$DB_PATH"; then
    fail "Database file $DB_PATH exists but is not writable by UID $PUID/GID $PGID. Fix the file ownership/permissions on the host volume."
fi

# Initialize and validate the database schema
echo "Initializing database schema..."
if [ "${DEBUG:-false}" = "true" ]; then
    echo "DATABASE_URL: $DATABASE_URL"
    echo "Checking prisma directory..."
    ls -la /app/prisma/ 2>&1 || echo "Cannot list /app/prisma/"
    ls -la /app/prisma/data/ 2>&1 || echo "Cannot list /app/prisma/data/"
fi

echo "Initializing database at $DB_PATH..."
if su-exec "$USER_NAME" sqlite3 "$DB_PATH" < /app/init-db.sql 2>&1; then
    echo "Database initialized successfully"
    # Ensure database file has correct permissions
    chown "$PUID:$PGID" "$DB_PATH" 2>/dev/null || true
    chmod 644 "$DB_PATH" 2>/dev/null || true
else
    fail "Database initialization failed. Check that /app/prisma/data is writable by UID $PUID/GID $PGID."
fi

MISSING_TABLES=""
for table in TvdbSeries TvdbEpisode Download Config GeneratedRuleset TopicCategory; do
    if ! su-exec "$USER_NAME" sqlite3 "$DB_PATH" "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '$table';" | grep -q 1; then
        MISSING_TABLES="$MISSING_TABLES $table"
    fi
done

if [ -n "$MISSING_TABLES" ]; then
    fail "Database initialization incomplete. Missing tables:$MISSING_TABLES"
fi

if ! su-exec "$USER_NAME" sqlite3 "$DB_PATH" "BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS __rundfunkarr_write_test (id INTEGER); DROP TABLE __rundfunkarr_write_test; COMMIT;" 2>&1; then
    fail "Database file $DB_PATH is not writable by UID $PUID/GID $PGID. Fix the host volume ownership/permissions."
fi

echo "Database directory after migration:"
ls -la /app/prisma/data/ 2>&1 || echo "Cannot list /app/prisma/data/"

# Run as the user
exec su-exec "$USER_NAME" "$@"
