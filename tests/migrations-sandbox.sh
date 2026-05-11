#!/usr/bin/env bash
# tests/migrations-sandbox.sh — Run a migration script against a tmp Caddyfile.
#
# Usage: bash migrations-sandbox.sh <migration.sh> <tmp_caddyfile_path>
#
# Sets up a tmp PATH with no-op stubs for sudo / caddy / systemctl so the
# real migration scripts run end-to-end without needing root privileges or
# the Caddy binary in CI. Also rewrites the migration's hardcoded
# /etc/caddy/Caddyfile path to point at the tmp fixture.
#
# Exit code mirrors the migration's exit code. The caller (the node test)
# reads the resulting tmp Caddyfile and asserts paths were substituted.

set -e
SCRIPT="$1"
TMP_CADDYFILE="$2"

if [ -z "$SCRIPT" ] || [ -z "$TMP_CADDYFILE" ]; then
    echo "usage: $0 <migration.sh> <tmp_caddyfile>" >&2
    exit 2
fi

TMP_BIN=$(mktemp -d)
TMP_SCRIPT=$(mktemp --suffix=.sh)
trap 'rm -rf "$TMP_BIN" "$TMP_SCRIPT"' EXIT

# sudo stub: drop the sudo prefix and exec the rest as the current user.
cat > "$TMP_BIN/sudo" <<'STUB'
#!/usr/bin/env bash
exec "$@"
STUB

# caddy stub: pretend `validate` succeeded so the migration's gate passes.
cat > "$TMP_BIN/caddy" <<'STUB'
#!/usr/bin/env bash
# Migrations grep for "Valid" in the output — emit the expected token.
echo "Valid configuration"
STUB

# systemctl stub: silent success for reload / is-active / etc.
cat > "$TMP_BIN/systemctl" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB

chmod +x "$TMP_BIN"/sudo "$TMP_BIN"/caddy "$TMP_BIN"/systemctl

# Rewrite the migration's hardcoded Caddyfile path to the tmp fixture.
sed "s|/etc/caddy/Caddyfile|$TMP_CADDYFILE|g" "$SCRIPT" > "$TMP_SCRIPT"

PATH="$TMP_BIN:$PATH" bash "$TMP_SCRIPT"
