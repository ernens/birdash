#!/usr/bin/env node
/**
 * bench-sqlite.mjs — micro-benchmark for SQLite query performance.
 *
 * Connects to birds.db + birdash.db (same paths birdash uses) and runs a
 * representative set of queries multiple times. Measures cold-cache (first
 * run) and warm-cache (subsequent runs) latency.
 *
 * Usage:
 *   node scripts/bench-sqlite.mjs                 # default: report
 *   node scripts/bench-sqlite.mjs --json          # JSON output for diffs
 *
 * Each query is run N times. We report min / median / p95 / max in ms.
 */
import Database from 'better-sqlite3';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME;

const DB_PATH = process.env.BIRDASH_DB || path.join(HOME, 'BirdNET-Pi', 'scripts', 'birds.db');
const BIRDASH_DB_PATH = path.join(HOME, 'birdash', 'birdash.db');

const ITER_PER_QUERY = 25;
const WARMUP_RUNS = 3;
const JSON_OUT = process.argv.includes('--json');
// --baseline: use the conservative defaults (busy_timeout=5000 only — no
//             cache bump, no mmap, no temp_store=memory). Use this on a
//             fresh process to capture the "before" numbers.
// --tuned (default): apply server/lib/db-pragmas.applyReadPragmas — same
//                    settings birdash actually uses in production.
const USE_BASELINE = process.argv.includes('--baseline');

// ── Open connections the way birdash does ────────────────────────────────
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
if (USE_BASELINE) {
  db.pragma('busy_timeout = 5000');
} else {
  const require = createRequire(import.meta.url);
  const pragmas = require(path.join(__dirname, '..', 'server', 'lib', 'db-pragmas.js'));
  pragmas.applyReadPragmas(db);
}

let hasBirdash = false;
try {
  db.exec(`ATTACH '${BIRDASH_DB_PATH}' AS vdb`);
  db.exec(`CREATE TEMP VIEW IF NOT EXISTS active_detections AS
    SELECT d.* FROM detections d
    WHERE NOT EXISTS (
      SELECT 1 FROM vdb.validations v
      WHERE v.date = d.Date AND v.time = d.Time
        AND v.sci_name = d.Sci_Name AND v.status = 'rejected'
    )`);
  hasBirdash = true;
} catch {
  db.exec('CREATE TEMP VIEW IF NOT EXISTS active_detections AS SELECT * FROM detections');
}

// Echo current PRAGMAs so the report is self-describing
const pragmas = {
  journal_mode:       db.pragma('journal_mode',  { simple: true }),
  synchronous:        db.pragma('synchronous',   { simple: true }),
  cache_size:         db.pragma('cache_size',    { simple: true }),
  mmap_size:          db.pragma('mmap_size',     { simple: true }),
  temp_store:         db.pragma('temp_store',    { simple: true }),
  page_size:          db.pragma('page_size',     { simple: true }),
  busy_timeout:       db.pragma('busy_timeout',  { simple: true }),
};

// Get a "today-ish" date that has data, plus a 30d window
const today = db.prepare('SELECT MAX(Date) AS d FROM detections').get().d;
const thirtyDaysAgo = (() => {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
})();
const oneYearAgo = (() => {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 365);
  return d.toISOString().slice(0, 10);
})();

// ── Benchmark queries ────────────────────────────────────────────────────
// Each entry: { name, sql, params, prep? }. We compile the statement once.
const QUERIES = [
  {
    name: 'timeline-today',
    sql: `SELECT Time, Confidence, File_Name, Model, Com_Name, Sci_Name
          FROM active_detections WHERE Date=? AND Confidence>=?
          ORDER BY Time DESC LIMIT 500`,
    params: [today, 0.7],
  },
  {
    name: 'top-species-30d',
    sql: `SELECT Com_Name, COUNT(*) AS n FROM active_detections
          WHERE Date >= ? AND Confidence >= 0.7
          GROUP BY Com_Name ORDER BY n DESC LIMIT 20`,
    params: [thirtyDaysAgo],
  },
  {
    name: 'species-detail-history',
    sql: `SELECT Date, Time, Confidence, File_Name FROM active_detections
          WHERE Com_Name=? AND Confidence>=0.7
          ORDER BY Date DESC, Time DESC LIMIT 200`,
    params: ['Rougegorge familier'],
  },
  {
    name: 'hourly-activity-today',
    sql: `SELECT CAST(SUBSTR(Time,1,2) AS INT) AS h, COUNT(*) AS n
          FROM active_detections WHERE Date=? AND Confidence>=0.7
          GROUP BY h ORDER BY h`,
    params: [today],
  },
  {
    name: 'distinct-species-30d',
    sql: `SELECT COUNT(DISTINCT Com_Name) AS n FROM active_detections
          WHERE Date >= ? AND Confidence >= 0.7`,
    params: [thirtyDaysAgo],
  },
  {
    name: 'rare-species-1y',
    sql: `SELECT Com_Name, COUNT(*) AS n FROM active_detections
          WHERE Date >= ? AND Confidence >= 0.7
          GROUP BY Com_Name HAVING n <= 5
          ORDER BY n ASC LIMIT 50`,
    params: [oneYearAgo],
  },
  {
    name: 'weather-cold-tolerance',
    sql: hasBirdash
      ? `SELECT d.Sci_Name, d.Com_Name, COUNT(*) AS n FROM active_detections d
         JOIN vdb.weather_hourly w
           ON w.date = d.Date AND w.hour = CAST(SUBSTR(d.Time,1,2) AS INT)
         WHERE d.Confidence >= 0.7 AND w.temp_c <= 0
         GROUP BY d.Sci_Name, d.Com_Name ORDER BY n DESC LIMIT 20`
      : null,
  },
  {
    name: 'weather-species-heatmap-top30',
    sql: hasBirdash
      ? `SELECT d.Sci_Name,
            MAX(0, MIN(9, CAST((w.temp_c - (-15)) / 5 AS INT))) AS bin_idx,
            COUNT(*) AS n
         FROM active_detections d
         JOIN vdb.weather_hourly w
           ON w.date = d.Date AND w.hour = CAST(SUBSTR(d.Time,1,2) AS INT)
         WHERE d.Confidence >= 0.7 AND w.temp_c IS NOT NULL
         GROUP BY d.Sci_Name, bin_idx`
      : null,
  },
  {
    name: 'first-last-by-species-1y',
    sql: `SELECT Com_Name, MIN(Date) AS first, MAX(Date) AS last, COUNT(*) AS n
          FROM active_detections WHERE Date >= ? AND Confidence >= 0.7
          GROUP BY Com_Name ORDER BY first ASC`,
    params: [oneYearAgo],
  },
];

// ── Run ──────────────────────────────────────────────────────────────────
function bench(query) {
  if (!query.sql) return null;
  const stmt = db.prepare(query.sql);
  // Warmup
  for (let i = 0; i < WARMUP_RUNS; i++) stmt.all(...(query.params || []));
  const samples = [];
  for (let i = 0; i < ITER_PER_QUERY; i++) {
    const t0 = performance.now();
    const rows = stmt.all(...(query.params || []));
    const t1 = performance.now();
    samples.push({ ms: t1 - t0, rows: rows.length });
  }
  samples.sort((a, b) => a.ms - b.ms);
  const ms = samples.map(s => s.ms);
  const pct = (p) => ms[Math.floor(ms.length * p)];
  return {
    name: query.name,
    rows: samples[0].rows,
    min: ms[0],
    median: pct(0.5),
    p95: pct(0.95),
    max: ms[ms.length - 1],
  };
}

const results = QUERIES.map(bench).filter(Boolean);

if (JSON_OUT) {
  console.log(JSON.stringify({ pragmas, results, today, db: DB_PATH }, null, 2));
} else {
  console.log(`\nDatabase: ${DB_PATH}`);
  console.log(`Today: ${today} · 30d window from ${thirtyDaysAgo} · 1y window from ${oneYearAgo}`);
  console.log('\nActive PRAGMAs:');
  for (const [k, v] of Object.entries(pragmas)) console.log(`  ${k.padEnd(15)} = ${v}`);
  console.log(`\nLatency over ${ITER_PER_QUERY} runs (${WARMUP_RUNS} warmup discarded), in ms:\n`);
  console.log(`  ${'query'.padEnd(34)} ${'rows'.padStart(7)}  ${'min'.padStart(8)}  ${'median'.padStart(8)}  ${'p95'.padStart(8)}  ${'max'.padStart(8)}`);
  console.log(`  ${'-'.repeat(34)}  ${'-'.repeat(7)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}  ${'-'.repeat(8)}`);
  for (const r of results) {
    console.log(`  ${r.name.padEnd(34)} ${String(r.rows).padStart(7)}  ${r.min.toFixed(2).padStart(8)}  ${r.median.toFixed(2).padStart(8)}  ${r.p95.toFixed(2).padStart(8)}  ${r.max.toFixed(2).padStart(8)}`);
  }
  console.log('');
}
db.close();
