'use strict';
/**
 * Seasons routes — /api/seasons/report
 *
 * Seasonal ornithological report: compares the current season to the
 * same season in previous years. Answers real questions:
 * - Which migratory species arrived this season? Earlier or later than last year?
 * - Which species departed (present last season, absent now)?
 * - How does species richness evolve year over year?
 *
 * Seasons: spring (Mar-May), summer (Jun-Aug), autumn (Sep-Nov), winter (Dec-Feb)
 */

// Season definitions: { start month (1-based), end month }
const SEASONS = {
  spring: { months: [3, 4, 5],   label: 'spring' },
  summer: { months: [6, 7, 8],   label: 'summer' },
  autumn: { months: [9, 10, 11], label: 'autumn' },
  winter: { months: [12, 1, 2],  label: 'winter' },
};

function _seasonDateRange(season, year) {
  const s = SEASONS[season];
  if (!s) return null;
  if (season === 'winter') {
    // Winter spans Dec of prev year → Feb of year
    const from = `${year - 1}-12-01`;
    const to = `${year}-02-28`;
    return [from, to];
  }
  const from = `${year}-${String(s.months[0]).padStart(2, '0')}-01`;
  // Last day of the last month
  const lastMonth = s.months[s.months.length - 1];
  const lastDay = new Date(year, lastMonth, 0).getDate();
  const to = `${year}-${String(lastMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return [from, to];
}

function _currentSeason() {
  const m = new Date().getMonth() + 1; // 1-based
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}

function handle(req, res, pathname, ctx) {
  const { db, JSON_CT } = ctx;

  // ── GET /api/seasons/report ───────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/seasons/report') {
    (async () => {
      try {
        const qs = new URL(req.url, 'http://x').searchParams;
        const season = qs.get('season') || _currentSeason();
        const year = parseInt(qs.get('year') || new Date().getFullYear());
        const conf = parseFloat(qs.get('conf') || '0.7');

        if (!SEASONS[season]) {
          res.writeHead(400, JSON_CT);
          res.end(JSON.stringify({ error: 'Invalid season. Use: spring, summer, autumn, winter' }));
          return;
        }

        const [from, to] = _seasonDateRange(season, year);
        const [prevFrom, prevTo] = _seasonDateRange(season, year - 1);

        // ── 1. Seasonal species + detections (current + previous year) ──
        const curSpecies = db.prepare(`
          SELECT Com_Name, MAX(Sci_Name) as Sci_Name,
                 COUNT(*) as total, ROUND(AVG(Confidence)*100,1) as avg_conf,
                 MIN(Date) as first_date, MAX(Date) as last_date,
                 COUNT(DISTINCT Date) as days_present
          FROM detections
          WHERE Date BETWEEN ? AND ? AND Confidence >= ?
          GROUP BY Com_Name ORDER BY total DESC
        `).all(from, to, conf);

        const prevSpecies = db.prepare(`
          SELECT Com_Name, MAX(Sci_Name) as Sci_Name,
                 COUNT(*) as total, MIN(Date) as first_date, MAX(Date) as last_date
          FROM detections
          WHERE Date BETWEEN ? AND ? AND Confidence >= ?
          GROUP BY Com_Name ORDER BY total DESC
        `).all(prevFrom, prevTo, conf);

        const curSet = new Set(curSpecies.map(s => s.Com_Name));
        const prevSet = new Set(prevSpecies.map(s => s.Com_Name));
        const prevMap = {};
        for (const s of prevSpecies) prevMap[s.Com_Name] = s;

        // ── 2. Migratory arrivals ───────────────────────────────────────
        // Species whose FIRST EVER detection of the year falls in this season
        const firstOfYear = db.prepare(`
          SELECT Com_Name, MAX(Sci_Name) as Sci_Name, MIN(Date) as first_date
          FROM detections
          WHERE SUBSTR(Date,1,4) = ? AND Confidence >= ?
          GROUP BY Com_Name
          HAVING first_date BETWEEN ? AND ?
          ORDER BY first_date ASC
        `).all(String(year), conf, from, to);

        // Same for previous year (for arrival date comparison)
        const prevFirstOfYear = db.prepare(`
          SELECT Com_Name, MIN(Date) as first_date
          FROM detections
          WHERE SUBSTR(Date,1,4) = ? AND Confidence >= ?
          GROUP BY Com_Name
          HAVING first_date BETWEEN ? AND ?
        `).all(String(year - 1), conf, prevFrom, prevTo);
        const prevFirstMap = {};
        for (const s of prevFirstOfYear) prevFirstMap[s.Com_Name] = s.first_date;

        const arrivals = firstOfYear.map(s => {
          const prevDate = prevFirstMap[s.Com_Name] || null;
          let daysShift = null;
          if (prevDate) {
            const cur = new Date(s.first_date);
            const prev = new Date(prevDate);
            // Compare day-of-year
            const curDOY = Math.floor((cur - new Date(cur.getFullYear(), 0, 1)) / 86400000);
            const prevDOY = Math.floor((prev - new Date(prev.getFullYear(), 0, 1)) / 86400000);
            daysShift = curDOY - prevDOY; // positive = later, negative = earlier
          }
          const det = curSpecies.find(c => c.Com_Name === s.Com_Name);
          return {
            com_name: s.Com_Name,
            sci_name: s.Sci_Name,
            first_date: s.first_date,
            prev_first_date: prevDate,
            days_shift: daysShift,
            total: det ? det.total : 0,
          };
        });

        // ── 3. Departures ───────────────────────────────────────────────
        // Species present in previous year's same season but absent now
        const departures = prevSpecies
          .filter(s => !curSet.has(s.Com_Name))
          .map(s => ({
            com_name: s.Com_Name,
            sci_name: s.Sci_Name,
            prev_total: s.total,
            prev_last_date: s.last_date,
          }));

        // ── 4. Multi-year evolution ─────────────────────────────────────
        const allYears = db.prepare(
          "SELECT DISTINCT SUBSTR(Date,1,4) as y FROM detections ORDER BY y"
        ).all().map(r => parseInt(r.y));

        const evolution = [];
        for (const y of allYears) {
          const [yFrom, yTo] = _seasonDateRange(season, y);
          if (!yFrom) continue;
          const row = db.prepare(`
            SELECT COUNT(DISTINCT Com_Name) as species, COUNT(*) as detections
            FROM detections WHERE Date BETWEEN ? AND ? AND Confidence >= ?
          `).get(yFrom, yTo, conf);
          evolution.push({
            year: y,
            species: row ? row.species : 0,
            detections: row ? row.detections : 0,
          });
        }

        // ── 5. Season-exclusive species ─────────────────────────────────
        // Species detected this season but NOT in the preceding or following season
        const [adjPrevFrom, adjPrevTo] = _seasonDateRange(_adjacentSeason(season, -1), year) || [null, null];
        const [adjNextFrom, adjNextTo] = _seasonDateRange(_adjacentSeason(season, +1), year) || [null, null];

        let adjSpecies = new Set();
        if (adjPrevFrom) {
          const adj = db.prepare(`SELECT DISTINCT Com_Name FROM detections WHERE Date BETWEEN ? AND ? AND Confidence >= ?`).all(adjPrevFrom, adjPrevTo, conf);
          adj.forEach(r => adjSpecies.add(r.Com_Name));
        }
        if (adjNextFrom) {
          const adj = db.prepare(`SELECT DISTINCT Com_Name FROM detections WHERE Date BETWEEN ? AND ? AND Confidence >= ?`).all(adjNextFrom, adjNextTo, conf);
          adj.forEach(r => adjSpecies.add(r.Com_Name));
        }
        const exclusiveCount = curSpecies.filter(s => !adjSpecies.has(s.Com_Name)).length;

        // ── 6. Best days ────────────────────────────────────────────────
        const bestDays = db.prepare(`
          SELECT Date, COUNT(DISTINCT Com_Name) as species, COUNT(*) as detections
          FROM detections WHERE Date BETWEEN ? AND ? AND Confidence >= ?
          GROUP BY Date ORDER BY species DESC LIMIT 5
        `).all(from, to, conf);

        // ── 7. Top species with delta ───────────────────────────────────
        const topSpecies = curSpecies.slice(0, 50).map(s => {
          const prev = prevMap[s.Com_Name];
          return {
            com_name: s.Com_Name,
            sci_name: s.Sci_Name,
            total: s.total,
            avg_conf: s.avg_conf,
            first_date: s.first_date,
            last_date: s.last_date,
            days_present: s.days_present,
            prev_total: prev ? prev.total : 0,
            delta: prev ? s.total - prev.total : s.total,
            delta_pct: prev && prev.total > 0 ? Math.round((s.total - prev.total) / prev.total * 100) : null,
          };
        });

        // ── Response ────────────────────────────────────────────────────
        const curTotal = curSpecies.reduce((s, r) => s + r.total, 0);
        const prevTotal = prevSpecies.reduce((s, r) => s + r.total, 0);

        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({
          season,
          year,
          dateRange: [from, to],
          prevYear: year - 1,
          prevDateRange: [prevFrom, prevTo],
          kpis: {
            species: curSpecies.length,
            prevSpecies: prevSpecies.length,
            detections: curTotal,
            prevDetections: prevTotal,
            arrivals: arrivals.length,
            departures: departures.length,
            exclusiveSpecies: exclusiveCount,
            bestDay: bestDays[0] || null,
          },
          arrivals,
          departures,
          evolution,
          bestDays,
          topSpecies,
        }));
      } catch (e) {
        console.error('[seasons]', e);
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // Keep legacy endpoint alive (redirect)
  if (req.method === 'GET' && pathname === '/api/comparison/weekly') {
    res.writeHead(301, { Location: '/api/seasons/report' });
    res.end();
    return true;
  }

  return false;
}

function _adjacentSeason(season, dir) {
  const order = ['spring', 'summer', 'autumn', 'winter'];
  const idx = order.indexOf(season);
  return order[(idx + dir + 4) % 4];
}

module.exports = { handle };
