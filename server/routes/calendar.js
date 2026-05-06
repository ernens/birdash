'use strict';
/**
 * Calendar route — /api/calendar/month
 *
 * Replaces 7 client-side queries from public/calendar.html with a single
 * server endpoint that aggregates the month from `daily_stats` and
 * `species_stats` instead of scanning the full `detections` table (~436k rows).
 *
 * Fast path (conf == 0.7): uses daily_stats.count_07 + species_stats.count_07.
 * Slow path (other conf): server returns 400; client falls back to its
 * legacy per-query logic. The 0.7 default covers virtually all installs.
 */

const resultCache = require('../lib/result-cache');

const CAL_TTL_TODAY = 60 * 1000;       // 1 min for the current month (today changes)
const CAL_TTL_PAST  = 60 * 60 * 1000;  // 60 min for past months

const FAST_CONF = 0.7;
const CONF_EPS  = 0.001;

function isoDate(d) { return d.toLocaleDateString('sv-SE'); }

function computeMonth(db, from, to) {
  // 1. Daily counts in range — det = sum of conf>=0.7, sp = species with at least one
  const dailyRows = db.prepare(`
    SELECT date,
           SUM(count_07) AS det,
           SUM(CASE WHEN count_07 > 0 THEN 1 ELSE 0 END) AS sp
    FROM daily_stats
    WHERE date >= ? AND date <= ?
    GROUP BY date
    ORDER BY date
  `).all(from, to);

  const map = {};
  let maxDet = 1;
  for (const r of dailyRows) {
    if (!r.det) continue; // skip days with rows but zero conf>=0.7 detections
    map[r.date] = {
      det: r.det, sp: r.sp,
      new_count: 0,
      very_rare_count: 0, rare_count: 0, uncommon_count: 0,
      return_30_count: 0, return_90_count: 0,
      new_names: [],
      very_rare_names: [], rare_names: [], uncommon_names: [],
      return_30_names: [], return_90_names: [],
    };
    if (r.det > maxDet) maxDet = r.det;
  }

  // 2. New species — first day with conf>=0.7 falls in the range. We can't
  //    use species_stats.first_date directly since that's first-ever (any conf).
  const newRows = db.prepare(`
    SELECT sci_name, com_name, MIN(date) AS first_date
    FROM daily_stats
    WHERE count_07 > 0
    GROUP BY sci_name
    HAVING first_date >= ? AND first_date <= ?
  `).all(from, to);
  const newSpeciesSet = new Set();
  for (const r of newRows) {
    newSpeciesSet.add(r.com_name);
    if (map[r.first_date]) {
      map[r.first_date].new_count++;
      map[r.first_date].new_names.push({ com: r.com_name, sci: r.sci_name });
    }
  }

  // 3. Lifetime counts per species — direct from species_stats.
  const lifetimeRows = db.prepare(`
    SELECT sci_name, com_name, count_07 AS lc
    FROM species_stats
    WHERE count_07 > 0
  `).all();
  const lifetimeMap = {};
  for (const r of lifetimeRows) {
    lifetimeMap[r.com_name] = { sci: r.sci_name, count: r.lc };
  }

  // 4. (date, species) pairs in range — bucket by lifetime count.
  const detRows = db.prepare(`
    SELECT date, sci_name, com_name
    FROM daily_stats
    WHERE date >= ? AND date <= ? AND count_07 > 0
  `).all(from, to);
  const veryRareSet = new Set(), rareSet = new Set();
  for (const r of detRows) {
    if (!map[r.date]) continue;
    const lc = lifetimeMap[r.com_name]?.count || 0;
    const item = { com: r.com_name, sci: r.sci_name };
    if (lc === 1) {
      map[r.date].very_rare_count++;
      map[r.date].very_rare_names.push(item);
      veryRareSet.add(r.com_name);
    } else if (lc <= 5) {
      map[r.date].rare_count++;
      map[r.date].rare_names.push(item);
      rareSet.add(r.com_name);
    } else if (lc <= 12) {
      map[r.date].uncommon_count++;
      map[r.date].uncommon_names.push(item);
    }
  }

  // 5. Returns after ≥30j of absence. The original LAG ran over ALL distinct
  //    (date, species) pairs of all history. We restrict the partition to
  //    species that actually appear in the month — typically 50–100 species
  //    instead of the full 146, and we feed off daily_stats (~27k rows)
  //    instead of detections (~436k).
  const returnRows = db.prepare(`
    WITH species_in_month AS (
      SELECT DISTINCT sci_name FROM daily_stats
      WHERE date >= ? AND date <= ? AND count_07 > 0
    ),
    ranked AS (
      SELECT date, sci_name, com_name,
             LAG(date) OVER (PARTITION BY sci_name ORDER BY date) AS prev_date
      FROM daily_stats
      WHERE count_07 > 0
        AND sci_name IN (SELECT sci_name FROM species_in_month)
    )
    SELECT date, sci_name, com_name, prev_date,
           CAST(julianday(date) - julianday(prev_date) AS INTEGER) AS gap
    FROM ranked
    WHERE date >= ? AND date <= ?
      AND prev_date IS NOT NULL
      AND julianday(date) - julianday(prev_date) >= 30
  `).all(from, to, from, to);
  for (const r of returnRows) {
    if (!map[r.date]) continue;
    const item = { com: r.com_name, sci: r.sci_name, gap: r.gap, prev_date: r.prev_date };
    if (r.gap >= 90) {
      map[r.date].return_90_count++;
      map[r.date].return_90_names.push(item);
    } else {
      map[r.date].return_30_count++;
      map[r.date].return_30_names.push(item);
    }
  }

  // 6. Distinct species in the month — for the KPI bar.
  const totalSpecies = new Set();
  for (const r of detRows) totalSpecies.add(r.com_name);

  // 7. Station age — first ever detection (any species, conf >= 0.7).
  const ageRow = db.prepare(`
    SELECT MIN(date) AS first_date FROM daily_stats WHERE count_07 > 0
  `).get();

  return {
    daily: map,
    meta: {
      totalSpecies: totalSpecies.size,
      newSpecies: newSpeciesSet.size,
      rareSpecies: veryRareSet.size + rareSet.size,
    },
    maxDet,
    firstEverDate: ageRow?.first_date || null,
    confidenceUsed: FAST_CONF,
  };
}

function handle(req, res, pathname, ctx) {
  const { db } = ctx;

  if (req.method === 'GET' && pathname === '/api/calendar/month') {
    try {
      const params = new URL(req.url, 'http://localhost').searchParams;
      const from = params.get('from');
      const to   = params.get('to');
      const conf = parseFloat(params.get('conf') || String(FAST_CONF));

      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'from/to must be YYYY-MM-DD' }));
        return true;
      }
      if (Math.abs(conf - FAST_CONF) > CONF_EPS) {
        // Slow-path not implemented in Phase 1 — client falls back to its
        // legacy multi-query logic. Document the threshold so the client can
        // log a meaningful warning instead of a generic 400.
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'fast path requires conf=0.7',
          fastConf: FAST_CONF,
        }));
        return true;
      }

      const todayStr = isoDate(new Date());
      const isCurrent = to >= todayStr;
      const ttl = isCurrent ? CAL_TTL_TODAY : CAL_TTL_PAST;
      const cacheKey = `cal:${from}:${to}:${conf}`;

      const hit = resultCache.get(cacheKey);
      if (hit) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(hit));
        return true;
      }

      const t0 = Date.now();
      const result = computeMonth(db, from, to);
      result.tookMs = Date.now() - t0;

      resultCache.set(cacheKey, result, ttl);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return true;
    } catch (e) {
      console.error('[calendar] Error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to compute calendar month' }));
      return true;
    }
  }

  return false;
}

module.exports = { handle };
