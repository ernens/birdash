'use strict';
/**
 * Whats-new route — /api/whats-new
 *
 * The heavy computation (10 SQLite queries, ~11s on Pi with 1M rows) runs
 * in a Worker Thread so the main event loop stays responsive.  A proactive
 * timer refreshes the cache every 5 minutes so users always get a fast
 * cache hit (<5ms).  The first computation is kicked off at startup.
 */
const path = require('path');
const { Worker } = require('worker_threads');
const resultCache = require('../lib/result-cache');

const PROJECT_ROOT   = path.join(__dirname, '..', '..');
const WORKER_PATH    = path.join(__dirname, '..', 'lib', 'whats-new-worker.js');
const WHATS_NEW_TTL  = 6 * 60 * 1000;   // 6 min (timer fires every 5 min, leaves margin)
const REFRESH_INTERVAL = 5 * 60 * 1000;  // 5 min

let _refreshTimer = null;
let _workerRunning = false;
let _ctx = null; // stored at first handle() call

// ── Run the worker thread ─────────────────────────────────────────────────
function _runWorker() {
  if (_workerRunning || !_ctx) return;
  _workerRunning = true;

  const { db: _db, readJsonFile, parseBirdnetConf } = _ctx;

  // Gather params synchronously (fast, <1ms)
  const DETECTION_RULES_PATH = path.join(PROJECT_ROOT, 'config', 'detection_rules.json');
  const DB_PATH = _db.name;  // better-sqlite3 exposes .name = file path
  const BIRDASH_DB_PATH = path.join(process.env.HOME, 'birdash', 'birdash.db');

  // parseBirdnetConf is async — kick off worker after it resolves
  parseBirdnetConf().then(conf => {
    const lat = parseFloat(conf.LATITUDE || conf.LAT || '0');
    const lon = parseFloat(conf.LONGITUDE || conf.LON || '0');
    const minConf = parseFloat(conf.CONFIDENCE || conf.BIRDNET_CONFIDENCE || '0.7');

    const worker = new Worker(WORKER_PATH, {
      workerData: {
        dbPath: DB_PATH,
        birdashDbPath: BIRDASH_DB_PATH,
        rulesPath: DETECTION_RULES_PATH,
        lat, lon, minConf
      }
    });

    const timeout = setTimeout(() => {
      console.error('[whats-new] Worker timeout (60s) — terminating');
      worker.terminate();
      _workerRunning = false;
    }, 60_000);

    worker.on('message', msg => {
      clearTimeout(timeout);
      _workerRunning = false;
      if (msg.type === 'result') {
        resultCache.set('whats-new', msg.data, WHATS_NEW_TTL);
        console.log(`[whats-new] Cache refreshed (worker) at ${new Date().toLocaleTimeString()}`);
      } else {
        console.error('[whats-new] Worker error:', msg.message);
      }
    });

    worker.on('error', err => {
      clearTimeout(timeout);
      _workerRunning = false;
      console.error('[whats-new] Worker crashed:', err.message);
    });

    worker.on('exit', code => {
      clearTimeout(timeout);
      _workerRunning = false;
      if (code !== 0) console.warn(`[whats-new] Worker exited with code ${code}`);
    });
  }).catch(err => {
    _workerRunning = false;
    console.error('[whats-new] Failed to parse config:', err.message);
  });
}

// ── Route handler ─────────────────────────────────────────────────────────
function handle(req, res, pathname, ctx) {
  // Store context on first call (needed by the proactive timer)
  if (!_ctx) {
    _ctx = ctx;
    // Kick off first computation after a short delay (let server finish booting)
    setTimeout(_runWorker, 3000);
    // Proactive refresh timer
    _refreshTimer = setInterval(_runWorker, REFRESH_INTERVAL);
  }

  if (req.method === 'GET' && pathname === '/api/whats-new') {
    const cached = resultCache.get('whats-new');
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cached));
    } else {
      // Cache miss (first request before worker finishes) — return empty
      // structure so the frontend renders gracefully instead of 502.
      // The worker is already running; next request will have data.
      if (!_workerRunning) _runWorker();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        generatedAt: null,
        alerts: [], phenology: [],
        context: {
          dawn_chorus: { insufficientData: true, data: null },
          acoustic_quality: { insufficientData: true, data: null },
          species_richness: { insufficientData: true, data: null },
          moon_phase: { insufficientData: false, data: null }
        }
      }));
    }
    return true;
  }

  return false;
}

function shutdown() {
  if (_refreshTimer) { clearInterval(_refreshTimer); _refreshTimer = null; }
}

module.exports = { handle, shutdown };
