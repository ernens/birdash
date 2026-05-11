/**
 * BIRDASH — Migration sandbox tests
 *
 * Each caddy-* migration writes paths into /etc/caddy/Caddyfile. Mickey hit
 * a 404 outage in 2026-05 because migration 011 v1 hardcoded /home/bjorn/
 * — on mickey (user=mickey) that pointed file_server at a non-existent
 * directory.
 *
 * This suite runs each migration end-to-end against a fixture Caddyfile
 * whose existing root is /home/fake_user/birdash/public, and asserts the
 * migration substitutes that user's home (not the CI runner's $HOME, not
 * the bjorn hardcode) into every new file_server block.
 *
 * Mechanism: tests/migrations-sandbox.sh stubs sudo/caddy/systemctl onto
 * PATH and rewrites the script's hardcoded /etc/caddy/Caddyfile to a tmp
 * path. The real bash + python heredoc + regex detection logic all run.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const MIGR_DIR = path.join(ROOT, 'scripts/migrations');
const SANDBOX = path.join(__dirname, 'migrations-sandbox.sh');

// A minimally-realistic Caddyfile shaped like a post-install install.sh
// would produce — has a /home/fake_user root, the @birds catch-all that
// 009/010 anchor on, and the api/audio handles. Enough surface for every
// caddy-* migration's regex anchors to match.
const FIXTURE_CADDYFILE = `:80 {
\thandle /birds/api/* {
\t\turi strip_prefix /birds
\t\treverse_proxy localhost:7474 {
\t\t\tflush_interval -1
\t\t\ttransport http {
\t\t\t\tresponse_header_timeout 120s
\t\t\t}
\t\t}
\t}
\thandle /birds/audio/* {
\t\tencode zstd gzip
\t\turi strip_prefix /birds/audio
\t\troot * /home/fake_user/BirdSongs/Extracted
\t\tfile_server
\t}
\t@birds path /birds /birds/*
\thandle @birds {
\t\tencode zstd gzip
\t\turi strip_prefix /birds
\t\troot * /home/fake_user/birdash/public
\t\theader Cache-Control "public, no-cache"
\t\tfile_server
\t}
\tredir / /birds/ permanent
}
`;

// Migrations that touch the Caddyfile and substitute paths. Other
// migrations (asoundrc, killmode, daily-stats, etc.) don't write paths,
// so they're out of scope for this suite.
const CADDY_MIGRATIONS = [
  '009-caddy-i18n-cache.sh',
  '010-caddy-vendor-cache.sh',
  '011-caddy-https-http2.sh',
];

for (const mig of CADDY_MIGRATIONS) {
  test(`migration ${mig}: substitutes detected home, no /home/bjorn/ leakage`, () => {
    const tmpFile = path.join(os.tmpdir(), `Caddyfile.test.${process.pid}.${mig}`);
    fs.writeFileSync(tmpFile, FIXTURE_CADDYFILE);
    try {
      const r = spawnSync('bash', [SANDBOX, path.join(MIGR_DIR, mig), tmpFile], {
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, `migration ${mig} exited ${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
      const result = fs.readFileSync(tmpFile, 'utf8');
      // The detected home (fake_user) must appear in the result. 011
      // rewrites the entire file; 009/010 add a new block. Either way
      // /home/fake_user/birdash/public should be present.
      assert.match(result, /\/home\/fake_user\/birdash\/public/,
        `${mig} did not preserve /home/fake_user/ in output`);
      // No hardcoded /home/bjorn/ leakage. This is the regression guard.
      assert.doesNotMatch(result, /\/home\/bjorn\//,
        `${mig} leaked /home/bjorn/ into the result`);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
      // Migration writes a .before-NNN backup alongside the target file.
      const backup = `${tmpFile}.before-${mig.replace(/\.sh$/, '')}`;
      try { fs.unlinkSync(backup); } catch {}
    }
  });

  test(`migration ${mig}: idempotent on second run`, () => {
    const tmpFile = path.join(os.tmpdir(), `Caddyfile.idem.${process.pid}.${mig}`);
    fs.writeFileSync(tmpFile, FIXTURE_CADDYFILE);
    try {
      const r1 = spawnSync('bash', [SANDBOX, path.join(MIGR_DIR, mig), tmpFile], { encoding: 'utf8' });
      assert.equal(r1.status, 0, `first run failed: ${r1.stderr}`);
      const r2 = spawnSync('bash', [SANDBOX, path.join(MIGR_DIR, mig), tmpFile], { encoding: 'utf8' });
      assert.equal(r2.status, 0, `second run failed: ${r2.stderr}`);
      assert.match(r2.stdout, /already applied/,
        `${mig} should report "already applied" on second run, got: ${r2.stdout}`);
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
      const backup = `${tmpFile}.before-${mig.replace(/\.sh$/, '')}`;
      try { fs.unlinkSync(backup); } catch {}
    }
  });
}
