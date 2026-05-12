'use strict';
/**
 * auto-purge.js — Daily MP3 retention cleanup with DB marker
 *
 * Promise: keep BirdSongs disk usage bounded by AUDIO_RETENTION_DAYS without
 * losing detection metadata. Stats and history stay intact; only the MP3
 * files are deleted. The UI shows a "purged" placeholder by checking the
 * Audio_Purged_At column on the detection row.
 *
 * Schedule: every day during the 03:00 local hour, debounced 20 h. Idempotent
 * across restarts via config/auto-purge.json (last_run_at).
 *
 * Trigger logic:
 *   - Always: delete clips where Date < (today − AUDIO_RETENTION_DAYS)
 *   - Panic mode: if disk usage ≥ PURGE_THRESHOLD, halve the retention to
 *                 claw space back fast (e.g. 90 d → 45 d).
 *
 * Protected: detections whose Com_Name appears in the `favorites` table are
 * skipped — the user explicitly chose to keep those clips.
 *
 * Origin: 2026-05-12 mickey incident. The legacy purge_audio.sh shell cron
 * triggered only over PURGE_THRESHOLD (95 %), so retention never applied
 * proactively. On birdash-only installs without BirdNET-Pi (mickey), the
 * cron wasn't even present — clips accumulated 25 d, hit 87 % disk, ENOSPC
 * corrupted git mid-fetch. This module replaces the shell script; it owns
 * the auto-purge policy end-to-end and works on any birdash install.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const STATE_FILE   = path.join(PROJECT_ROOT, 'config', 'auto-purge.json');
const LOG_FILE     = path.join(PROJECT_ROOT, 'config', 'auto-purge.log');

const DEFAULT_RETENTION = 90;
const DEFAULT_THRESHOLD = 95;
const PANIC_DIVISOR     = 2;     // halve retention when over threshold

let _cronTimer = null;

// ─── Config (birdnet.conf → JSON override → defaults) ─────────────────────

async function _readConfig(parseBirdnetConf) {
  let retention = DEFAULT_RETENTION;
  let threshold = DEFAULT_THRESHOLD;
  let enabled   = false;       // opt-in by default — safer for fresh installs
  try {
    const conf = (await parseBirdnetConf?.()) || {};
    if (conf.AUDIO_RETENTION_DAYS) retention = parseInt(conf.AUDIO_RETENTION_DAYS, 10) || DEFAULT_RETENTION;
    if (conf.PURGE_THRESHOLD)      threshold = parseInt(conf.PURGE_THRESHOLD, 10) || DEFAULT_THRESHOLD;
    // FULL_DISK=purge in birdnet.conf is the legacy auto-purge opt-in signal.
    // Honour it so existing bird installs keep their behaviour after this
    // module replaces purge_audio.sh.
    if (conf.FULL_DISK === 'purge') enabled = true;
  } catch {}
  // Local override (set via /api/settings/auto-purge UI toggle).
  try {
    const local = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (typeof local.enabled === 'boolean') enabled = local.enabled;
  } catch {}
  return { retention, threshold, enabled };
}

// ─── Disk usage ────────────────────────────────────────────────────────────

function _diskUsagePercent() {
  try {
    const out = execFileSync('df', ['--output=pcent', '/'], { encoding: 'utf8' });
    return parseInt(out.trim().split('\n')[1].replace('%', '').trim(), 10);
  } catch { return 0; }
}

// ─── State + log ───────────────────────────────────────────────────────────

function _loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}
function _saveState(patch) {
  try {
    const merged = { ..._loadState(), ...patch };
    fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2));
  } catch (e) { console.warn('[auto-purge] save state:', e.message); }
}
function _log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
  console.log(`[auto-purge] ${msg}`);
}

// ─── Path resolution (must match purge.js — same filename parsing) ─────────
// File_Name shape: <Species_with_underscores>-<conf>-<YYYY-MM-DD>-birdnet-...
// SONGS_DIR ends with "Extracted/By_Date" — see server/lib/config.js.

function _pathsForRow(row, songsDir) {
  if (!row.File_Name) return null;
  const m = row.File_Name.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
  if (!m) return null;
  return {
    livePath: path.join(songsDir, m[2], m[1], row.File_Name),
    // We also delete the spectrogram sibling .png — same logic purge.js uses.
    livePng:  path.join(songsDir, m[2], m[1], row.File_Name + '.png'),
  };
}

// ─── Date helper (YYYY-MM-DD N days ago, local) ────────────────────────────

function _daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  // ISO slice gives UTC date; we want local — use offset adjustment.
  const tzOffsetMs = d.getTimezoneOffset() * 60 * 1000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 10);
}

// ─── Core purge ────────────────────────────────────────────────────────────

async function _runPurge(db, dbWrite, parseBirdnetConf, songsDir, { dryRun = false } = {}) {
  const cfg = await _readConfig(parseBirdnetConf);
  if (!cfg.enabled) {
    _log('disabled — skipping');
    return { skipped: true, reason: 'disabled' };
  }

  const usage = _diskUsagePercent();
  let effectiveRetention = cfg.retention;
  let mode = 'normal';
  if (usage >= cfg.threshold) {
    effectiveRetention = Math.max(1, Math.floor(cfg.retention / PANIC_DIVISOR));
    mode = 'panic';
  }

  const cutoffDate = _daysAgo(effectiveRetention);
  _log(`start disk=${usage}% threshold=${cfg.threshold}% retention=${effectiveRetention}d mode=${mode} cutoff=${cutoffDate} dryRun=${dryRun}`);

  const favRows = db.prepare('SELECT com_name FROM favorites').all();
  const favs = new Set(favRows.map(r => r.com_name));

  const rows = db.prepare(`
    SELECT rowid, Date, Com_Name, File_Name
    FROM detections
    WHERE Date < ?
      AND Audio_Purged_At IS NULL
      AND File_Name IS NOT NULL
      AND File_Name != ''
  `).all(cutoffDate);

  const update = dbWrite.prepare('UPDATE detections SET Audio_Purged_At = ? WHERE rowid = ?');
  const now = Math.floor(Date.now() / 1000);

  let purged = 0, skipped = 0, errored = 0;

  // Yield to the event loop every YIELD_EVERY iterations so the engine's
  // INSERTs and other writers can grab the dbWrite lock between our batches.
  // Same lesson as the 2026-05-11 stability bug: a tight write loop that
  // never yields starves other writers and triggers "database is locked".
  // Bird's first run will visit ~230 k rows (legacy orphans that need their
  // Audio_Purged_At backfilled); ~1 batch / 100 ms keeps engine latency sane.
  const YIELD_EVERY = 200;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (favs.has(row.Com_Name)) { skipped++; continue; }
    const paths = _pathsForRow(row, songsDir);
    if (!paths) { errored++; continue; }
    if (dryRun) { purged++; continue; }
    // Best-effort unlink: ENOENT = legacy orphan (file already gone), we still
    // mark the row as purged so the UI knows.
    for (const p of [paths.livePath, paths.livePng]) {
      try { fs.unlinkSync(p); }
      catch (e) { if (e.code !== 'ENOENT') errored++; }
    }
    update.run(now, row.rowid);
    purged++;
    if ((i + 1) % YIELD_EVERY === 0) {
      await new Promise(r => setImmediate(r));
    }
  }

  const after = _diskUsagePercent();
  _log(`done purged=${purged} skipped_favorites=${skipped} errored=${errored} disk_before=${usage}% disk_after=${after}%`);

  if (!dryRun) {
    _saveState({
      last_run_at: new Date().toISOString(),
      last_run_count: purged,
      last_run_skipped: skipped,
      last_run_errored: errored,
      last_run_mode: mode,
      last_run_disk_before: usage,
      last_run_disk_after: after,
    });
  }
  return { purged, skipped, errored, mode, dryRun, disk_before: usage, disk_after: after };
}

// ─── Cron: daily during the 03:00 local hour ───────────────────────────────

function start(db, dbWrite, parseBirdnetConf, songsDir) {
  if (_cronTimer) return;
  const tick = async () => {
    const now = new Date();
    if (now.getHours() !== 3) return;
    const last = _loadState().last_run_at;
    if (last && (Date.now() - new Date(last).getTime()) < 20 * 3600 * 1000) return;
    try { await _runPurge(db, dbWrite, parseBirdnetConf, songsDir); }
    catch (e) { _log(`tick error: ${e.message}`); }
  };
  _cronTimer = setInterval(tick, 10 * 60 * 1000);
  // Boot-time check: in case server restarted across the 03:00 window.
  setTimeout(tick, 60 * 1000);
  console.log('[auto-purge] daily cron started (03:00 local, opt-in)');
}

function stop() {
  if (_cronTimer) { clearInterval(_cronTimer); _cronTimer = null; }
}

// ─── Manual triggers for UI ────────────────────────────────────────────────
// dryRun: synchronous, returns the result (counts only — no I/O).
// Real run: fire-and-forget; the API returns immediately and the UI polls
// `getStatus()` to know when it finished. A first-run on a 350 k-row DB
// can take ~5 min with the periodic yield; HTTP shouldn't hold that.

async function runNow(db, dbWrite, parseBirdnetConf, songsDir, opts = {}) {
  if (opts.dryRun) return _runPurge(db, dbWrite, parseBirdnetConf, songsDir, opts);
  _saveState({ last_run_started_at: new Date().toISOString(), last_run_completed_at: null });
  setImmediate(() => {
    _runPurge(db, dbWrite, parseBirdnetConf, songsDir, opts)
      .then(() => _saveState({ last_run_completed_at: new Date().toISOString() }))
      .catch(e => _log(`runNow error: ${e.message}`));
  });
  return { triggered: true };
}

function getStatus() {
  return _loadState();
}

async function getConfig(parseBirdnetConf) {
  return _readConfig(parseBirdnetConf);
}

function setEnabled(enabled) {
  _saveState({ enabled: !!enabled });
}

module.exports = { start, stop, runNow, getStatus, getConfig, setEnabled };
