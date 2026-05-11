'use strict';
/**
 * Data routes — photo preferences, favorites, notes, query
 */
const path = require('path');
const fs = require('fs');

// Use centralized result cache (cleared on mutations via clearAll())
const resultCache = require('../lib/result-cache');
const QUERY_CACHE_TTL = 2 * 60 * 1000;

// Exported so detections.js can invalidate after DELETE / edit
function clearQueryCache() { resultCache.clearAll(); }

function handle(req, res, pathname, ctx) {
  const { requireAuth, db, dbWrite, readJsonFile, writeJsonFileAtomic, JSON_CT, validateQuery, photoCacheKey, PHOTO_CACHE_DIR, ebirdFreq, SONGS_DIR } = ctx;

  // ── Route : GET /api/rare-today ──────────────────────────────────────────
  // Returns species detected today that are genuinely rare in the region
  // (via eBird) or locally (after 30+ days of data).
  // Uses raw `detections` table for historical scans (not the active_detections
  // VIEW) because the NOT EXISTS anti-join costs ~6s on 1M rows. The ~13
  // rejected detections are negligible for rarity classification.
  // Result cached 5 min via resultCache (cleared on mutations).
  if (req.method === 'GET' && pathname === '/api/rare-today') {
    (async () => {
      try {
        const { localDateStr } = require('../lib/local-date');
        const dateStr = new URL(req.url, 'http://x').searchParams.get('date')
          || localDateStr();
        const cacheKey = 'rare-today:' + dateStr;
        const cached = resultCache.get(cacheKey);
        if (cached) {
          res.writeHead(200, JSON_CT);
          res.end(JSON.stringify(cached));
          return;
        }

        // Use raw detections table for heavy historical scans (~50ms vs 6s)
        const totalDays = db.prepare(
          "SELECT COUNT(DISTINCT Date) as n FROM detections WHERE Date < ?"
        ).get(dateStr)?.n || 0;

        // Today's species — small result set, VIEW cost is negligible
        const todaySpecies = db.prepare(`
          SELECT Com_Name, Sci_Name, COUNT(*) as n
          FROM active_detections
          WHERE Date = ? AND Confidence >= 0.7
          GROUP BY Com_Name
        `).all(dateStr);

        // Historical counts (past year) — raw table, fast
        const histMap = {};
        const histRows = db.prepare(`
          SELECT Com_Name, COUNT(*) as cnt
          FROM detections
          WHERE Date < ? AND Date >= DATE(?, '-365 days')
          GROUP BY Com_Name
        `).all(dateStr, dateStr);
        for (const h of histRows) histMap[h.Com_Name] = h.cnt;

        const rares = [];
        for (const sp of todaySpecies) {
          const hist = histMap[sp.Com_Name] || 0;
          const check = ebirdFreq
            ? ebirdFreq.checkRarity(sp.Sci_Name, hist, totalDays)
            : { isRare: false, source: 'unavailable' };
          if (check.isRare) {
            rares.push({
              Com_Name: sp.Com_Name,
              Sci_Name: sp.Sci_Name,
              n: sp.n,
              totalDet: hist + sp.n,
              source: check.source,
            });
          }
        }
        resultCache.set(cacheKey, rares, 5 * 60 * 1000);
        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify(rares));
      } catch (e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // ── Route : GET /api/photo-pref?sci=X ──────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/photo-pref') {
    const sci = new URL(req.url, 'http://localhost').searchParams.get('sci');
    if (!sci) { res.writeHead(400, JSON_CT); res.end('{"error":"sci required"}'); return true; }
    try {
      const row = db.prepare('SELECT preferred_idx, banned_urls FROM photo_preferences WHERE sci_name=?').get(sci);
      res.writeHead(200, JSON_CT);
      res.end(JSON.stringify(row || { preferred_idx: 0, banned_urls: '[]' }));
    } catch(e) { res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message })); }
    return true;
  }

  // ── Route : POST /api/photo-pref ─────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/photo-pref') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { sci_name, action, photo_url, preferred_idx } = JSON.parse(body);
        if (!sci_name) { res.writeHead(400, JSON_CT); res.end('{"error":"sci_name required"}'); return true; }

        // Get current prefs
        let row = db.prepare('SELECT preferred_idx, banned_urls FROM photo_preferences WHERE sci_name=?').get(sci_name);
        let banned = [];
        let prefIdx = 0;
        if (row) {
          try { banned = JSON.parse(row.banned_urls); } catch {}
          prefIdx = row.preferred_idx || 0;
        }

        if (action === 'ban' && photo_url) {
          if (!banned.includes(photo_url)) banned.push(photo_url);
        } else if (action === 'unban' && photo_url) {
          banned = banned.filter(u => u !== photo_url);
        } else if (action === 'set_preferred' && typeof preferred_idx === 'number') {
          prefIdx = preferred_idx;
        } else if (action === 'reset') {
          banned = [];
          prefIdx = 0;
        }

        dbWrite.prepare(`INSERT OR REPLACE INTO photo_preferences (sci_name, preferred_idx, banned_urls, updated_at)
          VALUES (?, ?, ?, datetime('now'))`).run(sci_name, prefIdx, JSON.stringify(banned));

        // If banning, also delete the cached photo to force re-resolve
        if (action === 'ban') {
          const key = photoCacheKey(sci_name);
          const jpgPath = path.join(PHOTO_CACHE_DIR, key + '.jpg');
          const metaPath = path.join(PHOTO_CACHE_DIR, key + '.json');
          try { fs.unlinkSync(jpgPath); } catch {}
          try { fs.unlinkSync(metaPath); } catch {}
        }

        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ ok: true, preferred_idx: prefIdx, banned_urls: JSON.stringify(banned) }));
      } catch(e) { res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: e.message })); }
    });
    return true;
  }

  // ── Route : GET /api/favorites/stats ─────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/favorites/stats') {
    try {
      const favs = db.prepare('SELECT com_name, sci_name, added_at FROM favorites ORDER BY added_at DESC').all();
      if (!favs.length) {
        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ favorites: [], stats: { total: 0 } }));
        return;
      }
      const names = favs.map(f => f.com_name);
      const placeholders = names.map(() => '?').join(',');

      // Per-species lifetime stats from the pre-aggregated species_stats
      // table (sub-millisecond) instead of GROUP BY over active_detections
      // (the NOT EXISTS view was the dominant cost: measured 2.5 s for the
      // full endpoint, of which ~2.3 s was the view's anti-join scan).
      // last_time isn't pre-aggregated, so a small dedicated query against
      // detections (idx_com_name) still gathers it — ~50 ms for 10 favs.
      const lifetime = db.prepare(
        `SELECT com_name, count_07 as n, first_date, last_date, avg_conf
         FROM species_stats WHERE com_name IN (${placeholders})`
      ).all(...names);
      const lifetimeMap = {};
      for (const r of lifetime) lifetimeMap[r.com_name] = r;

      const lastTimeRows = db.prepare(
        `SELECT Com_Name, MAX(Time) as last_time
         FROM detections WHERE Com_Name IN (${placeholders}) GROUP BY Com_Name`
      ).all(...names);
      const lastTimeMap = {};
      for (const r of lastTimeRows) lastTimeMap[r.Com_Name] = r.last_time;

      const { localDateStr } = require('../lib/local-date');
      const todayStr = localDateStr();
      // Today's counts from daily_stats (also pre-aggregated). count_07 is
      // the standard 0.7 bucket, matching what the favorites UI displays.
      const todayCounts = db.prepare(
        `SELECT com_name, SUM(count_07) as n FROM daily_stats
         WHERE com_name IN (${placeholders}) AND date=? GROUP BY com_name`
      ).all(...names, todayStr);
      const todayMap = {};
      for (const r of todayCounts) todayMap[r.com_name] = r.n;

      const enriched = favs.map(f => ({
        com_name: f.com_name,
        sci_name: f.sci_name,
        added_at: f.added_at,
        total_detections: lifetimeMap[f.com_name]?.n || 0,
        today_detections: todayMap[f.com_name] || 0,
        last_date: lifetimeMap[f.com_name]?.last_date || null,
        last_time: lastTimeMap[f.com_name] || null,
        first_date: lifetimeMap[f.com_name]?.first_date || null,
        avg_conf: lifetimeMap[f.com_name]?.avg_conf || 0,
      }));

      const totalDets = enriched.reduce((s, f) => s + f.total_detections, 0);
      const todayDets = enriched.reduce((s, f) => s + f.today_detections, 0);
      const activeFavs = enriched.filter(f => f.today_detections > 0).length;

      res.writeHead(200, JSON_CT);
      res.end(JSON.stringify({
        favorites: enriched,
        stats: { total: favs.length, total_detections: totalDets, today_detections: todayDets, active_today: activeFavs }
      }));
    } catch(e) {
      res.writeHead(500, JSON_CT);
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── Route : GET /api/favorites ────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/favorites') {
    try {
      const rows = db.prepare('SELECT com_name, sci_name, added_at FROM favorites ORDER BY added_at DESC').all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows));
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return true;
  }

  // ── Route : POST /api/favorites ───────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/favorites') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { action, com_name, sci_name } = JSON.parse(body);
        if (!com_name) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'com_name required' }));
          return;
        }
        if (action === 'remove') {
          dbWrite.prepare('DELETE FROM favorites WHERE com_name=?').run(com_name);
        } else {
          dbWrite.prepare('INSERT OR REPLACE INTO favorites (com_name, sci_name) VALUES (?, ?)').run(com_name, sci_name || '');
        }
        clearQueryCache(); // clears resultCache too
        const rows = db.prepare('SELECT com_name, sci_name, added_at FROM favorites ORDER BY added_at DESC').all();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, favorites: rows }));
      } catch(e) {
        console.error('[favorites]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error' }));
      }
    });
    return true;
  }

  // ── Route : GET /api/notes?com_name=X ─────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/notes') {
    const comName = new URL(req.url, 'http://localhost').searchParams.get('com_name');
    if (!comName) { res.writeHead(400, JSON_CT); res.end('{"error":"com_name required"}'); return true; }
    try {
      const rows = db.prepare('SELECT id, com_name, sci_name, date, time, note, created_at, updated_at FROM notes WHERE com_name=? ORDER BY date IS NULL, date DESC, time DESC').all(comName);
      res.writeHead(200, JSON_CT);
      res.end(JSON.stringify(rows));
    } catch(e) { console.error('[notes]', e.message); res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: 'Internal error' })); }
    return true;
  }

  // ── Route : POST /api/notes ──────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/notes') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { id, com_name, sci_name, date, time, note } = JSON.parse(body);
        if (!com_name || !note?.trim()) {
          res.writeHead(400, JSON_CT);
          res.end('{"error":"com_name and note required"}');
          return;
        }
        let result;
        if (id) {
          // Update existing
          dbWrite.prepare('UPDATE notes SET note=?, updated_at=datetime(\'now\') WHERE id=?').run(note.trim(), id);
          result = { ok: true, id };
        } else {
          // Insert new
          const info = dbWrite.prepare('INSERT INTO notes (com_name, sci_name, date, time, note) VALUES (?,?,?,?,?)')
            .run(com_name, sci_name || '', date || null, time || null, note.trim());
          result = { ok: true, id: info.lastInsertRowid };
        }
        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify(result));
      } catch(e) { console.error('[notes]', e.message); res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: 'Internal error' })); }
    });
    return true;
  }

  // ── Route : DELETE /api/notes?id=X ───────────────────────────────────────
  if (req.method === 'DELETE' && pathname === '/api/notes') {
    if (!requireAuth(req, res)) return true;
    const id = new URL(req.url, 'http://localhost').searchParams.get('id');
    if (!id) { res.writeHead(400, JSON_CT); res.end('{"error":"id required"}'); return true; }
    try {
      dbWrite.prepare('DELETE FROM notes WHERE id=?').run(id);
      res.writeHead(200, JSON_CT);
      res.end('{"ok":true}');
    } catch(e) { console.error('[notes]', e.message); res.writeHead(500, JSON_CT); res.end(JSON.stringify({ error: 'Internal error' })); }
    return true;
  }

  // ── Route : POST /api/recordings/clear-orphan ───────────────────────────
  // Self-healing endpoint: when the spectro modal hits 404 on the audio
  // file, it pings here so the dangling File_Name reference gets cleared
  // from `detections`. Without this, the same orphan row keeps surfacing
  // in the "best recordings" view (GROUP BY Com_Name + MAX(Confidence))
  // and frustrates the user every time.
  //
  // Server verifies the file is actually missing before mutating — a
  // malicious or buggy client can't nullify rows whose audio still exists.
  // The detection row itself stays (count/conf are real signal); only the
  // File_Name column is cleared so the row drops out of File_Name != ''
  // queries. No auth required: it's a constrained, self-validating op.
  if (req.method === 'POST' && pathname === '/api/recordings/clear-orphan') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { fileName } = JSON.parse(body);
        if (typeof fileName !== 'string' || !fileName) {
          res.writeHead(400, JSON_CT); res.end('{"error":"fileName required"}'); return;
        }
        // Same regex as buildAudioUrl / purge.js — avoids path traversal
        // and rejects malformed names before we touch the filesystem.
        const m = fileName.match(/^(.+?)-\d+-(\d{4}-\d{2}-\d{2})-/);
        if (!m || fileName.includes('/') || fileName.includes('..')) {
          res.writeHead(400, JSON_CT); res.end('{"error":"bad fileName"}'); return;
        }
        const species = m[1];
        const date = m[2];
        const fp = path.join(SONGS_DIR, date, species, fileName);
        if (fs.existsSync(fp)) {
          // File is on disk — refuse to mutate.
          res.writeHead(409, JSON_CT); res.end('{"error":"file still on disk"}'); return;
        }
        const r = dbWrite.prepare('UPDATE detections SET File_Name = \'\' WHERE File_Name = ?').run(fileName);
        if (r.changes > 0) {
          // Clear cached "best" / recordings query results so the row
          // disappears from the UI on next refresh.
          resultCache.clearAll();
          console.log(`[orphan-audio] cleared ${r.changes} ref(s) to missing ${fileName}`);
        }
        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ ok: true, cleared: r.changes }));
      } catch (e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return true;
  }

  // Route : POST /api/query
  if (req.method === 'POST' && pathname === '/api/query') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { sql, params = [] } = JSON.parse(body);

        if (!validateQuery(sql)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Query not allowed' }));
          return;
        }

        // Cache expensive read-only queries for 2 min
        const qKey = 'q:' + sql + '|' + JSON.stringify(params);
        const qHit = resultCache.get(qKey);
        if (qHit) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(qHit);
          return;
        }

        // Slow-query log: queries crossing 500 ms get a one-line console
        // entry with the SQL and params, surfacing hotspots empirically
        // (caller pages aren't always obvious from the SQL alone). 500 ms
        // is roughly where a human notices latency; anything fast enough
        // not to clear that bar doesn't need logging.
        const _qt0 = Date.now();
        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);
        const _qt = Date.now() - _qt0;
        if (_qt > 500) {
          const oneLine = sql.replace(/\s+/g, ' ').trim().slice(0, 200);
          console.warn(`[slow-query ${_qt}ms] ${oneLine} :: ${JSON.stringify(params).slice(0, 100)}`);
        }
        if (rows.length > 10000) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Too many rows (max 10000)' }));
          return;
        }

        // Extrait les noms de colonnes depuis la première ligne
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        const data    = rows.map(r => columns.map(c => r[c]));

        const json = JSON.stringify({ columns, rows: data });
        resultCache.set(qKey, json, QUERY_CACHE_TTL);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(json);

      } catch (err) {
        console.error('[BIRDASH] Erreur SQL :', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal error while executing query' }));
      }
    });
    return true;
  }


  return false;
}

module.exports = { handle, clearQueryCache };
