'use strict';
/**
 * Network routes — multi-station federation.
 *
 * Public API (exposed to other stations):
 *   GET /api/public/station-info
 *   GET /api/public/summary?date=...
 *   GET /api/public/species?date=...
 *
 * Internal API (managing peer stations):
 *   GET /api/stations
 *   POST /api/stations
 *   DELETE /api/stations/:id
 *   POST /api/stations/:id/sync
 *   GET /api/network/overview
 */
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const https = require('https');
const http  = require('http');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const STATIONS_FILE = path.join(PROJECT_ROOT, 'config', 'stations.json');
const SNAPSHOTS_FILE = path.join(PROJECT_ROOT, 'config', 'station-snapshots.json');

// ── Station persistence (JSON file, no extra DB table) ──────────────────────
function loadStations() {
  try { return JSON.parse(fs.readFileSync(STATIONS_FILE, 'utf8')); }
  catch(e) { return []; }
}
function saveStations(stations) {
  fs.writeFileSync(STATIONS_FILE, JSON.stringify(stations, null, 2));
}
function loadSnapshots() {
  try { return JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8')); }
  catch(e) { return {}; }
}
function saveSnapshots(snaps) {
  fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(snaps, null, 2));
}

// ── Fetch helper ──────────────────────────────────────────────────────────────
function fetchJSON(url, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs }, res => {
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function handle(req, res, pathname, ctx) {
  const { requireAuth, db, JSON_CT, parseBirdnetConf } = ctx;

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC API — exposed to peer stations (no auth required)
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /api/public/station-info ──────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/public/station-info') {
    (async () => {
      try {
        const conf = await parseBirdnetConf();
        const totalDet = db.prepare('SELECT COUNT(*) as n FROM detections').get().n;
        const totalSp = db.prepare('SELECT COUNT(DISTINCT Sci_Name) as n FROM detections').get().n;
        const lastDate = db.prepare('SELECT MAX(Date) as d FROM detections').get().d;
        const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({
          name: conf.STATION_NAME || 'BirdStation',
          location: { lat: parseFloat(conf.LATITUDE) || null, lon: parseFloat(conf.LONGITUDE) || null },
          version: pkg.version,
          totalDetections: totalDet,
          totalSpecies: totalSp,
          lastDetectionDate: lastDate,
          uptime: process.uptime(),
        }));
      } catch(e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── GET /api/public/summary?date=... ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/public/summary') {
    const qs = new URL(req.url, 'http://x').searchParams;
    const date = qs.get('date') || new Date().toISOString().split('T')[0];
    try {
      const rows = db.prepare(`
        SELECT SUM(count) as total, COUNT(DISTINCT sci_name) as species, ROUND(AVG(avg_conf),3) as avg_conf
        FROM daily_stats WHERE date = ?
      `).get(date);
      const top = db.prepare(`
        SELECT com_name, sci_name, count as total FROM daily_stats
        WHERE date = ? ORDER BY count DESC LIMIT 5
      `).all(date);

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ date, ...(rows || { total: 0, species: 0 }), topSpecies: top }));
    } catch(e) {
      res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── GET /api/public/species?date=... ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/public/species') {
    const qs = new URL(req.url, 'http://x').searchParams;
    const date = qs.get('date') || new Date().toISOString().split('T')[0];
    try {
      const rows = db.prepare(`
        SELECT com_name, sci_name, count as total, avg_conf, first_time, last_time
        FROM daily_stats WHERE date = ? ORDER BY count DESC
      `).all(date);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(rows));
    } catch(e) {
      res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNAL API — station management (auth required for writes)
  // ══════════════════════════════════════════════════════════════════════════

  // ── GET /api/stations ─────────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/stations') {
    const stations = loadStations();
    res.writeHead(200, JSON_CT);
    res.end(JSON.stringify(stations));
    return true;
  }

  // ── POST /api/stations ────────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/stations') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { id, name, url: stUrl } = JSON.parse(body);
        if (!id || !name || !stUrl) { res.writeHead(400, JSON_CT); res.end('{"error":"id, name, url required"}'); return; }
        const stations = loadStations();
        const existing = stations.findIndex(s => s.id === id);
        const entry = { id, name, url: stUrl.replace(/\/+$/, ''), addedAt: new Date().toISOString() };
        if (existing >= 0) stations[existing] = { ...stations[existing], ...entry };
        else stations.push(entry);
        saveStations(stations);
        res.writeHead(200, JSON_CT); res.end(JSON.stringify({ ok: true }));
      } catch(e) { res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message })); }
    });
    return true;
  }

  // ── DELETE /api/stations/:id ──────────────────────────────────────────────
  if (req.method === 'DELETE' && pathname.startsWith('/api/stations/')) {
    if (!requireAuth(req, res)) return true;
    const id = pathname.split('/').pop();
    const stations = loadStations().filter(s => s.id !== id);
    saveStations(stations);
    res.writeHead(200, JSON_CT); res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── POST /api/stations/:id/sync ───────────────────────────────────────────
  if (req.method === 'POST' && pathname.match(/^\/api\/stations\/[^/]+\/sync$/)) {
    if (!requireAuth(req, res)) return true;
    const id = pathname.split('/')[3];
    (async () => {
      try {
        const stations = loadStations();
        const station = stations.find(s => s.id === id);
        if (!station) { res.writeHead(404, JSON_CT); res.end('{"error":"Station not found"}'); return; }

        const date = new Date().toISOString().split('T')[0];
        const [info, summary] = await Promise.allSettled([
          fetchJSON(`${station.url}/api/public/station-info`),
          fetchJSON(`${station.url}/api/public/summary?date=${date}`),
        ]);

        const snaps = loadSnapshots();
        if (!snaps[id]) snaps[id] = {};
        snaps[id][date] = {
          info: info.status === 'fulfilled' ? info.value : null,
          summary: summary.status === 'fulfilled' ? summary.value : null,
          fetchedAt: new Date().toISOString(),
        };
        // Keep only last 30 days
        const keys = Object.keys(snaps[id]).sort();
        if (keys.length > 30) { for (const k of keys.slice(0, keys.length - 30)) delete snaps[id][k]; }
        saveSnapshots(snaps);

        // Update station metadata
        if (info.status === 'fulfilled') {
          station.lastSync = new Date().toISOString();
          station.lat = info.value.location?.lat;
          station.lon = info.value.location?.lon;
          station.version = info.value.version;
          saveStations(stations);
        }

        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ ok: true, info: info.value || null, summary: summary.value || null }));
      } catch(e) { res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message })); }
    })();
    return true;
  }

  // ── GET /api/network/overview ─────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/network/overview') {
    (async () => {
      try {
        const stations = loadStations();
        const snaps = loadSnapshots();
        const date = new URL(req.url, 'http://x').searchParams.get('date') || new Date().toISOString().split('T')[0];

        // Add local station data
        const localSummary = db.prepare(`
          SELECT SUM(count) as total, COUNT(DISTINCT sci_name) as species
          FROM daily_stats WHERE date = ?
        `).get(date);
        const conf = await parseBirdnetConf();

        const overview = {
          date,
          local: {
            name: conf.STATION_NAME || 'BirdStation',
            lat: parseFloat(conf.LATITUDE) || null,
            lon: parseFloat(conf.LONGITUDE) || null,
            ...(localSummary || { total: 0, species: 0 }),
          },
          peers: stations.map(s => ({
            ...s,
            snapshot: snaps[s.id]?.[date] || null,
          })),
        };

        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify(overview));
      } catch(e) { res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message })); }
    })();
    return true;
  }

  return false;
}

// ── Background sync (every 30 min) ──────────────────────────────────────────
let _syncTimer = null;

function startBackgroundSync(db, parseBirdnetConf) {
  if (_syncTimer) clearInterval(_syncTimer);
  _syncTimer = setInterval(async () => {
    const stations = loadStations();
    if (!stations.length) return;
    const date = new Date().toISOString().split('T')[0];
    const snaps = loadSnapshots();

    for (const station of stations) {
      try {
        const [info, summary] = await Promise.allSettled([
          fetchJSON(`${station.url}/api/public/station-info`),
          fetchJSON(`${station.url}/api/public/summary?date=${date}`),
        ]);
        if (!snaps[station.id]) snaps[station.id] = {};
        snaps[station.id][date] = {
          info: info.status === 'fulfilled' ? info.value : null,
          summary: summary.status === 'fulfilled' ? summary.value : null,
          fetchedAt: new Date().toISOString(),
        };
        if (info.status === 'fulfilled') {
          station.lastSync = new Date().toISOString();
          station.lat = info.value.location?.lat;
          station.lon = info.value.location?.lon;
        }
      } catch(e) { /* silent */ }
    }
    saveStations(stations);
    saveSnapshots(snaps);
  }, 30 * 60 * 1000);
}

function stopBackgroundSync() {
  if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
}

module.exports = { handle, startBackgroundSync, stopBackgroundSync };
