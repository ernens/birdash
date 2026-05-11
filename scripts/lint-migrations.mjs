#!/usr/bin/env node
/**
 * lint-migrations.mjs — Static check for cross-user safety in migration scripts.
 *
 * Walks scripts/migrations/*.sh and flags any literal `/home/<name>/` path that
 * would break on a Pi where the Linux user isn't `<name>`. Mickey hit this
 * exact bug via migration 011 v1: hardcoded `/home/bjorn/` written into
 * Caddyfile → 404 on every page because file_server looked at a non-existent
 * directory.
 *
 * Allowlist (won't flag):
 *   - lines starting with `#` (comments — we mention /home/<name> in prose)
 *   - lines containing `$DETECTED_HOME`, `${DETECTED_HOME}`, `$HOME`, `${HOME}`
 *   - lines containing `[^` (regex character class — the detection grep itself)
 *
 * The recommended pattern lives in 011-caddy-https-http2.sh:
 *
 *   DETECTED_HOME=$(grep -oE 'root \* /home/[^/]+' "$CADDYFILE" \
 *                   | head -1 | awk '{print $3}')
 *   if [ -z "$DETECTED_HOME" ]; then DETECTED_HOME="$HOME"; fi
 *
 * Exit code: 0 = clean, 1 = hardcode found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrDir = path.join(__dirname, 'migrations');

const files = fs.readdirSync(migrDir).filter(f => f.endsWith('.sh')).sort();

let errors = 0;
for (const f of files) {
  const lines = fs.readFileSync(path.join(migrDir, f), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;  // pure-comment line
    const m = line.match(/\/home\/([a-z][a-z0-9_-]*)\//);
    if (!m) continue;
    // Allow shell-variable substitutions of $HOME / $DETECTED_HOME
    if (/\$\{?(HOME|DETECTED_HOME)\}?/.test(line)) continue;
    // Allow regex character classes like [^/]+ — line is itself the detector
    if (line.includes('[^')) continue;
    errors++;
    console.error(`${f}:${i + 1}: hardcoded /home/${m[1]}/ — use $DETECTED_HOME instead`);
    console.error(`    ${line.trim()}`);
  }
}

if (errors > 0) {
  console.error(`\nlint-migrations: ${errors} issue(s) in ${files.length} file(s).`);
  console.error(`See scripts/migrations/011-caddy-https-http2.sh for the DETECTED_HOME pattern.`);
  process.exit(1);
}
console.log(`lint-migrations: ${files.length} file(s) clean.`);
