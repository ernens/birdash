'use strict';
/**
 * Security routes — HTTPS toggle for the Caddy reverse-proxy
 *
 * Phase 1 of the in-app HTTPS feature. Reads/writes the marker-delimited
 * `:80 { … }` block in /etc/caddy/Caddyfile so non-technical users can
 * enable HTTPS redirect from Settings → Sécurité without touching a shell.
 *
 * The managed section is delimited by:
 *   # BIRDASH-MANAGED:HTTPS-MODE
 *   …
 *   # BIRDASH-MANAGED-END
 *
 * Write flow: compose → write to /tmp → `caddy validate` → `sudo cp` →
 * respond → deferred `systemctl restart caddy`. The validate step is the
 * safety net. We restart (not reload) because Caddy 2.6.2 panics on reload
 * when the :80 block flips between `redir https://…` and `import birdash_site`
 * (PKI context cleanup race). The deferred fire lets the POST response flush
 * through Caddy before SIGTERM hits it.
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const CADDYFILE = '/etc/caddy/Caddyfile';
const MARKER_BEGIN = '# BIRDASH-MANAGED:HTTPS-MODE';
const MARKER_END = '# BIRDASH-MANAGED-END';

const BLOCK_HTTPS = `${MARKER_BEGIN} — do not edit between markers; toggle via Settings → Sécurité
:80 {
\tredir https://{host}{uri} permanent
}
${MARKER_END}`;

const BLOCK_HTTP = `${MARKER_BEGIN} — do not edit between markers; toggle via Settings → Sécurité
:80 {
\timport birdash_site
}
${MARKER_END}`;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

async function readState() {
  const raw = await fs.readFile(CADDYFILE, 'utf8');
  const begin = raw.indexOf(MARKER_BEGIN);
  const end = raw.indexOf(MARKER_END);
  if (begin < 0 || end < 0 || end < begin) {
    return { enabled: null, managed: false, raw };
  }
  const section = raw.slice(begin, end);
  const enabled = /redir\s+https:/.test(section);
  return { enabled, managed: true, raw };
}

function buildNewCaddyfile(raw, enabled) {
  const begin = raw.indexOf(MARKER_BEGIN);
  if (begin < 0) throw new Error('marker not found in Caddyfile');
  const endIdx = raw.indexOf(MARKER_END, begin);
  if (endIdx < 0) throw new Error('end marker not found in Caddyfile');
  const after = raw.slice(endIdx + MARKER_END.length);
  const before = raw.slice(0, begin);
  return before + (enabled ? BLOCK_HTTPS : BLOCK_HTTP) + after;
}

async function applyState(enabled) {
  const { raw } = await readState();
  const next = buildNewCaddyfile(raw, enabled);
  const tmp = path.join(os.tmpdir(), `Caddyfile.birdash.${process.pid}.${Date.now()}`);
  await fs.writeFile(tmp, next, 'utf8');
  try {
    await run('caddy', ['validate', '--config', tmp, '--adapter', 'caddyfile']);
    await run('sudo', ['-n', 'cp', tmp, CADDYFILE]);
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
}

function scheduleCaddyRestart() {
  setTimeout(() => {
    execFile('sudo', ['-n', 'systemctl', 'restart', 'caddy'], (err, _stdout, stderr) => {
      if (err) console.error('[security] Caddy restart failed:', err.message, (stderr || '').toString().slice(0, 300));
      else console.log('[security] Caddy restarted (HTTPS toggle applied)');
    });
  }, 500);
}

function handle(req, res, pathname, ctx) {
  const { JSON_CT } = ctx;

  if (req.method === 'GET' && pathname === '/api/security/https') {
    (async () => {
      try {
        const { enabled, managed } = await readState();
        res.writeHead(200, { 'Content-Type': JSON_CT });
        res.end(JSON.stringify({ enabled, managed }));
      } catch (e) {
        console.error('[security] GET /https:', e.message);
        res.writeHead(500, { 'Content-Type': JSON_CT });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/security/https') {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      (async () => {
        try {
          const { enabled } = JSON.parse(body || '{}');
          if (typeof enabled !== 'boolean') {
            res.writeHead(400, { 'Content-Type': JSON_CT });
            res.end(JSON.stringify({ error: 'body must be { enabled: boolean }' }));
            return;
          }
          await applyState(enabled);
          console.log(`[security] HTTPS toggle → ${enabled ? 'ON' : 'OFF'}`);
          res.writeHead(200, { 'Content-Type': JSON_CT });
          res.end(JSON.stringify({ ok: true, enabled, restarting: true }));
          scheduleCaddyRestart();
        } catch (e) {
          console.error('[security] POST /https:', e.message, e.stderr || '');
          res.writeHead(500, { 'Content-Type': JSON_CT });
          res.end(JSON.stringify({ error: e.message, detail: (e.stderr || '').toString().slice(0, 500) }));
        }
      })();
    });
    return true;
  }

  return false;
}

module.exports = { handle };
