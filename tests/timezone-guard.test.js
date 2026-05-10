/**
 * BIRDASH — timezone regression guard.
 *
 * Two layers:
 *
 * 1. Static lint over server/ — fails if anyone reintroduces
 *    `toISOString().slice(0, 10)` or `toISOString().split('T')[0]` as a
 *    way to extract a calendar date. Those return UTC, which is 1-2 h
 *    behind Brussels and silently produces the wrong day between local
 *    midnight and ~02:00. Use lib/local-date.js helpers instead.
 *
 * 2. Functional check — under TZ=Europe/Brussels, localDateStr() must
 *    return the *local* day for a UTC time that straddles midnight, and
 *    must disagree with the antipattern there. Catches a regression in
 *    the helper itself (not just its callers).
 *
 * Run: node --test tests/timezone-guard.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');

// Files where a UTC date string is intentional and reviewed:
//   - local-date.js: documents the antipattern in a comment.
//   - weather-watcher.js: feeds Open-Meteo URL params; the API uses
//     timezone=auto server-side, so UTC dates here are harmless.
const ALLOWLIST = new Set([
  path.join(SERVER_DIR, 'lib', 'local-date.js'),
  path.join(SERVER_DIR, 'lib', 'weather-watcher.js'),
]);

// Match the three known UTC-leak patterns on a `.toISOString()` chain:
//   .slice(0, 10)     → "YYYY-MM-DD" (UTC date)
//   .split('T')[0]    → same         (UTC date, alt form)
//   .slice(11, 19)    → "HH:MM:SS"   (UTC time-of-day — fixed in mqtt /
//                                     notif since the polling cutoff is
//                                     compared against local-frame Time).
const ANTIPATTERN = /toISOString\(\)\s*\.\s*(?:slice\(\s*0\s*,\s*10\s*\)|slice\(\s*11\s*,\s*19\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\])/;

function* walkJs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'public') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJs(full);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs')) {
      yield full;
    }
  }
}

describe('timezone antipattern guard', () => {
  it('no toISOString().slice(0,10) / split("T")[0] outside the allowlist', () => {
    const offenders = [];
    for (const file of walkJs(SERVER_DIR)) {
      if (ALLOWLIST.has(file)) continue;
      const src = fs.readFileSync(file, 'utf8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (ANTIPATTERN.test(line)) {
          offenders.push(`${path.relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      'Date should be derived from local-date.js helpers, not from UTC.\n' +
      'Found:\n  ' + offenders.join('\n  ')
    );
  });
});

describe('localDateStr behaviour under Europe/Brussels', () => {
  // Set TZ before requiring the helper so any internal caching picks it up.
  process.env.TZ = 'Europe/Brussels';
  const { localDateStr, localDateOffset, localTimeStr } = require('../server/lib/local-date');

  it('returns the local day for a UTC time that straddles midnight', () => {
    // 2026-04-21 23:30 UTC is 2026-04-22 01:30 Brussels (CEST = UTC+2).
    // The antipattern would say "2026-04-21"; we want "2026-04-22".
    const d = new Date('2026-04-21T23:30:00Z');
    const utcAntipattern = d.toISOString().slice(0, 10);
    assert.equal(utcAntipattern, '2026-04-21', 'sanity: antipattern returns UTC day');
    assert.equal(localDateStr(d), '2026-04-22', 'localDateStr should return Brussels day');
    assert.notEqual(localDateStr(d), utcAntipattern, 'helper must disagree with antipattern at the edge');
  });

  it('localDateOffset(-7) is 7 days before today, both in local space', () => {
    const today = localDateStr();
    const weekAgo = localDateOffset(-7);
    const t = new Date(today + 'T12:00:00');
    const w = new Date(weekAgo + 'T12:00:00');
    const days = Math.round((t - w) / 86400000);
    assert.equal(days, 7);
  });

  it('localTimeStr returns HH:MM:SS in local time', () => {
    // 12:34:56 UTC + 2h = 14:34:56 Brussels (DST). Use a date inside DST
    // so the test isn't sensitive to the season the suite runs in.
    const d = new Date('2026-07-15T12:34:56Z');
    assert.equal(localTimeStr(d), '14:34:56');
  });
});
