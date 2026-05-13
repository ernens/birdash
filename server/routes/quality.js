'use strict';
/**
 * Quality routes — backs the "Detection Quality" cockpit.
 *
 * Response shape (top-level keys consumed by quality.html):
 *   review        — workload (backlog) + quality (% of REVIEWED items)
 *   agreement     — to_watch / strong / median (diagnostic, not raw table)
 *   prefilter     — measured engine counters OR not_instrumented placeholder
 *   balance       — BirdNET vs Perch totals + delta vs prior period
 *   throttle      — inferred per-species volume delta (proxy, not causality)
 *   throttle_measured — engine-counted throttle drops (Phase B)
 *   timeline      — daily volume by model
 *   synthesis     — { headline_key, params, severity }
 *
 * Honest labelling: every block carries a `source` ∈
 *   observed | inferred | measured | not_instrumented
 * The frontend renders that as a badge so users never confuse a proxy
 * (timeline-comparison "throttle effect") with an engine measurement.
 */

const { localDateOffset } = require('../lib/local-date');

function handle(req, res, pathname, ctx) {
  const { db, birdashDb, parseBirdnetConf } = ctx;

  if (req.method !== 'GET') return false;

  if (pathname === '/api/quality/random-sample') {
    return handleRandomSample(req, res, db, birdashDb);
  }

  if (pathname !== '/api/quality') return false;

  const url = new URL(req.url, 'http://x');
  const days = Math.min(365, Math.max(1, parseInt(url.searchParams.get('days') || '30')));
  const minVolume = Math.max(1, parseInt(url.searchParams.get('min_volume') || '20'));

  (async () => {
    try {
      const review    = await reviewOutcomes(db, birdashDb, days);
      const agreement = await modelAgreement(db, days, minVolume);
      const prefilter = prefilterFromEvents(db, days);
      const balance   = modelBalance(db, days);
      const throttle  = throttleEffect(db);
      const throttleMeasuredVal = throttleMeasured(db, days);
      const timeline  = dailyTimeline(db, days);
      const baseline  = calibrationBaseline(birdashDb, days);
      const synthesis = buildSynthesis({ review, agreement, prefilter, balance });

      const result = {
        days, minVolume,
        review, agreement, prefilter, balance,
        throttle, throttle_measured: throttleMeasuredVal,
        timeline, baseline, synthesis,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error('[quality]', e);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  })();
  return true;
}

// ── Calibration baseline ──────────────────────────────────────────────────
// Aggregates validations tagged with notes='calibration' (i.e. produced via
// review.html?mode=calibration on the random-sample queue). Unlike the
// `review` block, which counts the suspicion-driven queue and is biased
// toward rejection, this baseline is uniformly sampled and therefore a
// trustworthy quality estimate. Returns null until at least 1 such
// validation exists, so the UI can render an explainer card rather than
// stale zeros.
function calibrationBaseline(birdashDb, days) {
  if (!birdashDb) {
    return { source: 'not_instrumented', reviewed: 0, note_key: 'quality_baseline_no_db' };
  }
  const fromDate = isoDateOffset(-days);
  const rows = birdashDb.prepare(`
    SELECT status, COUNT(*) AS n
    FROM validations
    WHERE notes = 'calibration' AND date >= ?
    GROUP BY status
  `).all(fromDate);
  const counts = { confirmed: 0, doubtful: 0, rejected: 0 };
  for (const r of rows) if (r.status in counts) counts[r.status] = r.n;
  const reviewed = counts.confirmed + counts.doubtful + counts.rejected;
  if (reviewed === 0) {
    return {
      source: 'not_instrumented',
      reviewed: 0,
      note_key: 'quality_baseline_no_data',
    };
  }
  return {
    source: 'observed',
    days,
    reviewed,
    confirmed: counts.confirmed,
    doubtful:  counts.doubtful,
    rejected:  counts.rejected,
    confirmed_pct: Math.round((counts.confirmed / reviewed) * 100),
    doubtful_pct:  Math.round((counts.doubtful  / reviewed) * 100),
    rejected_pct:  Math.round((counts.rejected  / reviewed) * 100),
  };
}

// ── Review outcomes ─────────────────────────────────────────────────────────
// Splits explicitly into:
//   workload : total / reviewed / unreviewed (= backlog)
//   quality  : % among REVIEWED items (confirmed/doubtful/rejected)
// Mixing the two was the #1 readability bug — "unreviewed = 35k" dwarfed
// every other figure and made the quality ratio unreadable.
async function reviewOutcomes(db, birdashDb, days) {
  const fromDate = isoDateOffset(-days);
  const total = db.prepare(
    'SELECT COUNT(*) AS n FROM detections WHERE Date >= ?'
  ).get(fromDate).n;

  // birdashDb is null on environments where birdash.db couldn't be opened
  // (CI, fresh installs). Match the "honest labelling" pattern used by
  // prefilterFromEvents: return a not_instrumented payload rather than 5xx.
  if (!birdashDb) {
    return {
      source: 'not_instrumented',
      total, reviewed: 0, unreviewed: total,
      confirmed: 0, doubtful: 0, rejected: 0,
      quality: null,
    };
  }

  const valRows = birdashDb.prepare(
    'SELECT status FROM validations WHERE date >= ?'
  ).all(fromDate);

  const counts = { confirmed: 0, doubtful: 0, rejected: 0 };
  for (const v of valRows) if (v.status in counts) counts[v.status]++;
  const reviewed = counts.confirmed + counts.doubtful + counts.rejected;
  const unreviewed = Math.max(0, total - reviewed);

  return {
    source: 'observed',
    total,
    reviewed,
    unreviewed,
    confirmed: counts.confirmed,
    doubtful: counts.doubtful,
    rejected: counts.rejected,
    // Quality ratios computed only on REVIEWED items so they are not
    // crushed by the backlog. Frontend uses these for the bar chart.
    quality: reviewed > 0 ? {
      confirmed_pct: Math.round((counts.confirmed / reviewed) * 100),
      doubtful_pct:  Math.round((counts.doubtful  / reviewed) * 100),
      rejected_pct:  Math.round((counts.rejected  / reviewed) * 100),
    } : null,
  };
}

// ── Model agreement (observed proxy) ───────────────────────────────────────
// Returns three diagnostic views instead of a long uniform table:
//   to_watch    — frequent species with low agreement (worth checking)
//   strong      — species with both high agreement AND meaningful volume
//   all         — full sorted list for the "all" tab (capped at 50)
//
// Plus a `median_pct` for frequent species used in the synthesis line.
//
// This matches the spec: "show diagnosis, not a brute table". The volume
// guard (minVolume) still applies — species with < minVolume Perch hits
// never appear, period.
async function modelAgreement(db, days, minVolume) {
  const fromDate = isoDateOffset(-days);
  const rows = db.prepare(`
    SELECT Date, Sci_Name, Com_Name, Time, Model
    FROM detections WHERE Date >= ?
  `).all(fromDate);

  const bins = new Map();   // date|sci|3s-bin → { com, birdnet, perch }
  for (const r of rows) {
    const t = r.Time || '00:00:00';
    const seconds = (parseInt(t.slice(0, 2)) || 0) * 3600
                  + (parseInt(t.slice(3, 5)) || 0) * 60
                  + (parseInt(t.slice(6, 8)) || 0);
    const bin = Math.floor(seconds / 3);
    const key = `${r.Date}|${r.Sci_Name}|${bin}`;
    if (!bins.has(key)) bins.set(key, { com: r.Com_Name, birdnet: false, perch: false });
    const e = bins.get(key);
    if (String(r.Model || '').toLowerCase().startsWith('perch')) e.perch = true;
    else e.birdnet = true;
  }

  const sp = new Map();   // sci → { com, perch, agreed }
  for (const [key, v] of bins) {
    if (!v.perch) continue;
    const sci = key.split('|')[1];
    if (!sp.has(sci)) sp.set(sci, { com: v.com, perch: 0, agreed: 0 });
    const s = sp.get(sci);
    s.perch++;
    if (v.birdnet) s.agreed++;
  }

  const all = [];
  for (const [sci, v] of sp) {
    if (v.perch < minVolume) continue;
    all.push({
      sci_name: sci,
      com_name: v.com,
      perch_count: v.perch,
      agreed_count: v.agreed,
      agreement_pct: v.perch ? Math.round((v.agreed / v.perch) * 100) : 0,
    });
  }

  // Sort once by perch_count desc — drives default "to watch" volume bias.
  all.sort((a, b) => b.perch_count - a.perch_count);

  // To watch: low agreement (<60%) AND in the top half by volume.
  // Strong:   high agreement (>=75%) AND meaningful volume.
  const to_watch = all
    .filter(s => s.agreement_pct < 60)
    .slice(0, 10);
  const strong = all
    .filter(s => s.agreement_pct >= 75)
    .slice(0, 10);

  // Median agreement on the (volume-filtered) population. Used in the
  // synthesis line as a single qualitative health indicator.
  let median_pct = null;
  if (all.length > 0) {
    const sorted = [...all].map(s => s.agreement_pct).sort((a, b) => a - b);
    const m = Math.floor(sorted.length / 2);
    median_pct = sorted.length % 2 ? sorted[m] : Math.round((sorted[m - 1] + sorted[m]) / 2);
  }

  return {
    source: 'observed',
    bin_seconds: 3,
    min_volume: minVolume,
    species_count: all.length,
    median_pct,
    to_watch,
    strong,
    all: all.slice(0, 50),
  };
}

// ── Pre-filter impact (Phase B: from quality_events) ──────────────────────
function prefilterFromEvents(db, days) {
  const tableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='quality_events'"
  ).get();
  if (!tableExists) {
    return {
      source: 'not_instrumented',
      privacy_dropped: null, dog_dropped: null, dog_cooldown_skipped: null,
      cross_confirm_rejected: null, files_processed: null,
      note_key: 'quality_prefilter_note_no_table',
    };
  }
  const fromDate = isoDateOffset(-days);
  const row = db.prepare(`
    SELECT
      SUM(privacy_dropped)        AS privacy_dropped,
      SUM(dog_dropped)            AS dog_dropped,
      SUM(dog_cooldown_skipped)   AS dog_cooldown_skipped,
      SUM(throttle_dropped)       AS throttle_dropped,
      SUM(files_processed)        AS files_processed,
      SUM(cross_confirm_rejected) AS cross_confirm_rejected
    FROM quality_events WHERE Date >= ?
  `).get(fromDate);
  const total = (row.files_processed || 0) + (row.privacy_dropped || 0) + (row.dog_dropped || 0);
  if (total === 0) {
    return {
      source: 'not_instrumented',
      privacy_dropped: null, dog_dropped: null, dog_cooldown_skipped: null,
      cross_confirm_rejected: null, files_processed: null,
      note_key: 'quality_prefilter_note_no_events',
    };
  }
  return {
    source: 'measured',
    privacy_dropped:        row.privacy_dropped || 0,
    dog_dropped:            row.dog_dropped || 0,
    dog_cooldown_skipped:   row.dog_cooldown_skipped || 0,
    throttle_dropped:       row.throttle_dropped || 0,
    files_processed:        row.files_processed || 0,
    cross_confirm_rejected: null,
    cross_confirm_note_key: 'quality_cross_confirm_note',
  };
}

function throttleMeasured(db, days) {
  const tableExists = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='quality_events'"
  ).get();
  if (!tableExists) return { source: 'not_instrumented', dropped: null };
  const fromDate = isoDateOffset(-days);
  const row = db.prepare(
    'SELECT SUM(throttle_dropped) AS n FROM quality_events WHERE Date >= ?'
  ).get(fromDate);
  return { source: 'measured', dropped: row.n || 0 };
}

// ── Model balance — pilot card #4 ──────────────────────────────────────────
// Compares BirdNET vs Perch totals over the period vs the immediately prior
// period of equal length. Used by the "Balance" pilot card and by the
// synthesis line ("sudden BirdNET vs Perch imbalance").
function modelBalance(db, days) {
  const fromDate = isoDateOffset(-days);
  const priorFrom = isoDateOffset(-2 * days);
  const cur = db.prepare(`
    SELECT
      SUM(CASE WHEN Model LIKE 'perch%' THEN 1 ELSE 0 END) AS perch,
      SUM(CASE WHEN Model NOT LIKE 'perch%' THEN 1 ELSE 0 END) AS birdnet
    FROM detections WHERE Date >= ?
  `).get(fromDate);
  const prior = db.prepare(`
    SELECT
      SUM(CASE WHEN Model LIKE 'perch%' THEN 1 ELSE 0 END) AS perch,
      SUM(CASE WHEN Model NOT LIKE 'perch%' THEN 1 ELSE 0 END) AS birdnet
    FROM detections WHERE Date >= ? AND Date < ?
  `).get(priorFrom, fromDate);

  const birdnet = cur.birdnet || 0;
  const perch   = cur.perch   || 0;
  const total   = birdnet + perch;
  const priorBirdnet = prior.birdnet || 0;
  const priorPerch   = prior.perch   || 0;
  const priorTotal   = priorBirdnet + priorPerch;

  const ratio = total > 0 ? perch / total : null;          // 0..1, share of Perch
  const priorRatio = priorTotal > 0 ? priorPerch / priorTotal : null;

  return {
    source: 'observed',
    days,
    birdnet, perch, total,
    prior: { birdnet: priorBirdnet, perch: priorPerch, total: priorTotal },
    perch_share: ratio !== null ? Math.round(ratio * 100) : null,
    prior_perch_share: priorRatio !== null ? Math.round(priorRatio * 100) : null,
    delta_share: (ratio !== null && priorRatio !== null)
      ? Math.round((ratio - priorRatio) * 100) : null,
    delta_total_pct: priorTotal > 0
      ? Math.round((total - priorTotal) / priorTotal * 100) : null,
  };
}

// ── Volume change per species (proxy for throttle effect) ─────────────────
// Renamed conceptually from "throttle effect" — the title was promising
// causality the metric cannot prove. Same data, honest framing: comparison
// of recent vs prior per-day rate for the loudest species. Useful as a
// directional signal, not as a measurement.
function throttleEffect(db) {
  let enabled = false;
  try {
    const fs = require('fs');
    const conf = fs.readFileSync('/etc/birdnet/birdnet.conf', 'utf8');
    const m = conf.match(/^NOISY_THROTTLE_ENABLED=(.+)/m);
    enabled = m ? m[1].trim().replace(/['"]/g, '') === '1' : false;
  } catch (_) { /* leave disabled */ }

  // INDEXED BY: without the hint, the planner walks idx_com_name (full
  // table scan + temp B-tree, ~870 ms on 345k rows). idx_date_com scans
  // only the 7-day window (~10 ms).
  const recent = db.prepare(`
    SELECT Com_Name, COUNT(*) AS n
    FROM detections INDEXED BY idx_date_com
    WHERE Date >= date('now', '-7 days')
    GROUP BY Com_Name
    ORDER BY n DESC
    LIMIT 5
  `).all();

  if (recent.length === 0) {
    return {
      source: 'inferred', enabled,
      note_key: enabled ? 'quality_volchange_note_on' : 'quality_volchange_note_off',
      species: [],
    };
  }

  const byName = {};
  for (const r of recent) byName[r.Com_Name] = { recent7: r.n };

  const prior = db.prepare(`
    SELECT Com_Name, COUNT(*) AS n
    FROM detections
    WHERE Date >= date('now', '-37 days')
      AND Date <  date('now', '-7 days')
      AND Com_Name IN (${recent.map(() => '?').join(',') || "''"})
    GROUP BY Com_Name
  `).all(...recent.map(r => r.Com_Name));
  for (const r of prior) byName[r.Com_Name].prior30 = r.n;

  const list = recent.map(r => {
    const e = byName[r.Com_Name];
    const recentPerDay = (e.recent7 || 0) / 7;
    const priorPerDay  = (e.prior30 || 0) / 30;
    const delta_pct = priorPerDay > 0
      ? Math.round((recentPerDay - priorPerDay) / priorPerDay * 100)
      : null;
    let interpretation_key;
    if (delta_pct === null)            interpretation_key = 'quality_volchange_interp_low_volume';
    else if (delta_pct < -25)          interpretation_key = 'quality_volchange_interp_dampened';
    else if (delta_pct >  50)          interpretation_key = 'quality_volchange_interp_seasonal';
    else                                interpretation_key = 'quality_volchange_interp_stable';
    return {
      com_name: r.Com_Name,
      recent_per_day: Math.round(recentPerDay * 10) / 10,
      prior_per_day:  Math.round(priorPerDay  * 10) / 10,
      delta_pct,
      interpretation_key,
    };
  });

  return {
    source: 'inferred',
    enabled,
    note_key: enabled ? 'quality_volchange_note_on' : 'quality_volchange_note_off',
    species: list,
  };
}

// ── Daily timeline ─────────────────────────────────────────────────────────
function dailyTimeline(db, days) {
  const fromDate = isoDateOffset(-days);
  const rows = db.prepare(`
    SELECT Date,
           SUM(CASE WHEN Model LIKE 'perch%' THEN 1 ELSE 0 END) AS perch,
           SUM(CASE WHEN Model NOT LIKE 'perch%' THEN 1 ELSE 0 END) AS birdnet,
           COUNT(*) AS total
    FROM detections
    WHERE Date >= ?
    GROUP BY Date
    ORDER BY Date
  `).all(fromDate);
  return { source: 'observed', days: rows };
}

// ── Synthesis line ─────────────────────────────────────────────────────────
// Rule-based: walks the metrics and picks the single most prominent
// concern. No score — just one sentence pointing the user at what to
// look at first. Order matters: backlog before agreement before balance,
// because a 35k backlog dominates every other interpretation.
function buildSynthesis({ review, agreement, prefilter, balance }) {
  const findings = [];

  // Real backlog = items the user explicitly flagged as "doubtful" but
  // never resolved. Total - reviewed isn't a backlog: most stations
  // generate way more detections than any human can curate, so framing
  // unreviewed as "to do" is misleading.
  if (review.doubtful > 20) {
    findings.push({
      key: 'quality_synth_backlog_high',
      params: { count: review.doubtful.toLocaleString('fr-FR') },
      severity: 'attention',
    });
  }

  // Agreement signal — only if we have enough species AND median is low
  if (agreement.species_count >= 3 && agreement.median_pct !== null && agreement.median_pct < 50) {
    findings.push({
      key: 'quality_synth_agreement_low',
      params: { median: agreement.median_pct, count: agreement.to_watch.length },
      severity: 'attention',
    });
  }

  // Prefilter instrumentation gap
  if (prefilter.source === 'not_instrumented') {
    findings.push({
      key: 'quality_synth_prefilter_pending',
      params: {},
      severity: 'info',
    });
  }

  // Balance shift (only if both periods have data)
  if (balance.delta_share !== null && Math.abs(balance.delta_share) >= 15) {
    findings.push({
      key: balance.delta_share > 0
        ? 'quality_synth_balance_perch_up'
        : 'quality_synth_balance_birdnet_up',
      params: { delta: Math.abs(balance.delta_share) },
      severity: 'attention',
    });
  }

  if (findings.length === 0) {
    return {
      headline_key: 'quality_synth_stable',
      params: {},
      severity: 'ok',
      findings: [],
    };
  }

  return {
    headline_key: findings[0].key,
    params: findings[0].params,
    severity: findings[0].severity,
    findings,    // full list — frontend can show secondary points
  };
}

// ── Random sample ─────────────────────────────────────────────────────────
// Returns N random detections from the last `days` window. Designed for
// calibration audits: unlike the review/validation table, the sample is
// drawn uniformly so it isn't biased by what humans chose to inspect.
// For each detection we also attach the partner detection (other model)
// in the same 3-second time bin, when present, so the caller can judge
// inter-model agreement on individual events. Validation status is
// surfaced when the (Date, Time, Sci_Name) tuple was reviewed.
function handleRandomSample(req, res, db, birdashDb) {
  try {
    const url = new URL(req.url, 'http://x');
    const parseIntDefault = (v, d) => { const x = parseInt(v); return Number.isFinite(x) ? x : d; };
    const days = Math.min(365, Math.max(1, parseIntDefault(url.searchParams.get('days'), 7)));
    const n = Math.min(500, Math.max(1, parseIntDefault(url.searchParams.get('n'), 50)));
    const model = (url.searchParams.get('model') || '').toLowerCase();
    const shape = (url.searchParams.get('shape') || '').toLowerCase();
    const fromDate = isoDateOffset(-days);

    let where = 'WHERE Date >= ?';
    const params = [fromDate];
    if (model === 'birdnet') {
      where += " AND (Model IS NULL OR Model NOT LIKE 'perch%')";
    } else if (model === 'perch') {
      where += " AND Model LIKE 'perch%'";
    }

    const rows = db.prepare(`
      SELECT Date, Time, Sci_Name, Com_Name, Confidence, Model,
             Overlap, Sens, Cutoff, File_Name
      FROM detections
      ${where}
      ORDER BY RANDOM()
      LIMIT ?
    `).all(...params, n);

    const valByKey = new Map();
    if (birdashDb && rows.length) {
      const placeholders = rows.map(() => '(?,?,?)').join(',');
      const vparams = [];
      for (const r of rows) vparams.push(r.Date, r.Time, r.Sci_Name);
      try {
        const vrows = birdashDb.prepare(`
          SELECT date, time, sci_name, status
          FROM validations
          WHERE (date, time, sci_name) IN (VALUES ${placeholders})
        `).all(...vparams);
        for (const v of vrows) valByKey.set(`${v.date}|${v.time}|${v.sci_name}`, v.status);
      } catch (_) { /* values-tuple unsupported in some sqlite builds; skip */ }
    }

    const partnerByKey = new Map();
    for (const r of rows) {
      const t = r.Time || '00:00:00';
      const seconds = (parseInt(t.slice(0, 2)) || 0) * 3600
                    + (parseInt(t.slice(3, 5)) || 0) * 60
                    + (parseInt(t.slice(6, 8)) || 0);
      const binStart = Math.floor(seconds / 3) * 3;
      const binEnd = binStart + 3;
      const fromTime = sec2hms(binStart);
      const toTime = sec2hms(binEnd);
      const isPerch = String(r.Model || '').toLowerCase().startsWith('perch');
      const partner = db.prepare(`
        SELECT Confidence, Model
        FROM detections
        WHERE Date = ? AND Sci_Name = ?
          AND Time >= ? AND Time < ?
          AND ${isPerch ? "(Model IS NULL OR Model NOT LIKE 'perch%')" : "Model LIKE 'perch%'"}
        LIMIT 1
      `).get(r.Date, r.Sci_Name, fromTime, toTime);
      partnerByKey.set(`${r.Date}|${r.Time}|${r.Sci_Name}`, partner || null);
    }

    const sample = rows.map(r => {
      const key = `${r.Date}|${r.Time}|${r.Sci_Name}`;
      const partner = partnerByKey.get(key);
      return {
        date: r.Date,
        time: r.Time,
        sci_name: r.Sci_Name,
        com_name: r.Com_Name,
        confidence: r.Confidence,
        model: r.Model,
        overlap: r.Overlap,
        sens: r.Sens,
        cutoff: r.Cutoff,
        file_name: r.File_Name,
        partner: partner ? { confidence: partner.Confidence, model: partner.Model } : null,
        validation_status: valByKey.get(key) || null,
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (shape === 'review') {
      // Match /api/flagged-detections shape so review.html can consume
      // this endpoint without changes when in calibration mode.
      const today = isoDateOffset(0);
      const flagged = sample.map(r => ({
        date: r.date,
        time: r.time,
        sci_name: r.sci_name,
        com_name: r.com_name,
        confidence: r.confidence,
        file_name: r.file_name,
        model: r.model,
        reasons: ['calibration_random'],
        truncated: 0,
        stability_status: null,
        validation: r.validation_status || 'unreviewed',
      }));
      res.end(JSON.stringify({
        flagged,
        dateFrom: fromDate,
        dateTo: today,
        total: flagged.length,
        returned: flagged.length,
        mode: 'calibration',
      }));
      return true;
    }
    res.end(JSON.stringify({
      source: 'observed',
      days, n: sample.length,
      from_date: fromDate,
      sample,
    }));
  } catch (e) {
    console.error('[quality/random-sample]', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return true;
}

function sec2hms(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${h}:${m}:${ss}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function isoDateOffset(deltaDays) {
  return localDateOffset(deltaDays);
}

module.exports = { handle };
