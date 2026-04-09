'use strict';
/**
 * Weekly report generator.
 * Produces a summary of the week's bird detections and sends via Apprise.
 */
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { execFile } = require('child_process');

/**
 * Generate report data for a given week.
 * @param {object} db - readonly SQLite connection (birds.db)
 * @param {string} weekStart - 'YYYY-MM-DD' (Monday)
 * @param {string} weekEnd - 'YYYY-MM-DD' (Sunday)
 * @returns {object} Report data
 */
function generateReport(db, weekStart, weekEnd) {
  // Overall stats from daily_stats
  const overall = db.prepare(`
    SELECT COUNT(DISTINCT date) as days, SUM(count) as total_det,
           COUNT(DISTINCT sci_name) as species, ROUND(AVG(avg_conf),3) as avg_conf
    FROM daily_stats WHERE date BETWEEN ? AND ?
  `).get(weekStart, weekEnd);

  // Top 10 species
  const topSpecies = db.prepare(`
    SELECT com_name, sci_name, SUM(count) as total, ROUND(AVG(avg_conf),3) as avg_conf
    FROM daily_stats WHERE date BETWEEN ? AND ?
    GROUP BY sci_name ORDER BY total DESC LIMIT 10
  `).all(weekStart, weekEnd);

  // New species (first ever detection during this week)
  const newSpecies = db.prepare(`
    SELECT ds.com_name, ds.sci_name, SUM(ds.count) as total
    FROM daily_stats ds
    WHERE ds.date BETWEEN ? AND ?
    AND ds.sci_name NOT IN (
      SELECT DISTINCT sci_name FROM daily_stats WHERE date < ?
    )
    GROUP BY ds.sci_name ORDER BY total DESC
  `).all(weekStart, weekEnd, weekStart);

  // Best detection (highest single-day confidence)
  const bestDetection = db.prepare(`
    SELECT com_name, sci_name, date, max_conf FROM daily_stats
    WHERE date BETWEEN ? AND ?
    ORDER BY max_conf DESC LIMIT 1
  `).get(weekStart, weekEnd);

  // Previous week comparison
  const prevStart = shiftDate(weekStart, -7);
  const prevEnd = shiftDate(weekEnd, -7);
  const prevOverall = db.prepare(`
    SELECT SUM(count) as total_det, COUNT(DISTINCT sci_name) as species
    FROM daily_stats WHERE date BETWEEN ? AND ?
  `).get(prevStart, prevEnd);

  // Same week last year
  const lyStart = shiftDate(weekStart, -365);
  const lyEnd = shiftDate(weekEnd, -365);
  const lastYear = db.prepare(`
    SELECT SUM(count) as total_det, COUNT(DISTINCT sci_name) as species
    FROM daily_stats WHERE date BETWEEN ? AND ?
  `).get(lyStart, lyEnd);

  // Daily breakdown
  const daily = db.prepare(`
    SELECT date, SUM(count) as detections, COUNT(DISTINCT sci_name) as species
    FROM daily_stats WHERE date BETWEEN ? AND ?
    GROUP BY date ORDER BY date
  `).all(weekStart, weekEnd);

  // Record day of the week
  const recordDay = daily.reduce((best, d) => (!best || d.detections > best.detections) ? d : best, null);

  return {
    weekStart, weekEnd,
    overall: overall || { days: 0, total_det: 0, species: 0, avg_conf: 0 },
    topSpecies,
    newSpecies,
    bestDetection,
    daily,
    recordDay,
    comparison: {
      prevWeek: prevOverall || { total_det: 0, species: 0 },
      lastYear: lastYear || { total_det: 0, species: 0 },
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format report as readable text for ntfy notification.
 */
function formatText(report, stationName = 'BirdStation') {
  const r = report;
  const o = r.overall;
  const lines = [];

  lines.push(`${stationName} — Weekly Report`);
  lines.push(`${r.weekStart} to ${r.weekEnd}`);
  lines.push('');
  lines.push(`${o.total_det?.toLocaleString() || 0} detections | ${o.species || 0} species | ${o.days || 0} days`);
  lines.push(`Avg confidence: ${((o.avg_conf || 0) * 100).toFixed(1)}%`);

  // Comparison
  const prevDelta = (o.total_det || 0) - (r.comparison.prevWeek.total_det || 0);
  if (r.comparison.prevWeek.total_det) {
    lines.push(`vs last week: ${prevDelta >= 0 ? '+' : ''}${prevDelta} detections (${r.comparison.prevWeek.species} species)`);
  }
  if (r.comparison.lastYear.total_det) {
    const lyDelta = (o.total_det || 0) - (r.comparison.lastYear.total_det || 0);
    lines.push(`vs same week last year: ${lyDelta >= 0 ? '+' : ''}${lyDelta} detections (${r.comparison.lastYear.species} species)`);
  }

  // New species
  if (r.newSpecies.length) {
    lines.push('');
    lines.push(`New species (${r.newSpecies.length}):`);
    for (const s of r.newSpecies.slice(0, 5)) {
      lines.push(`  + ${s.com_name} (${s.total}x)`);
    }
  }

  // Top species
  if (r.topSpecies.length) {
    lines.push('');
    lines.push('Top species:');
    for (const s of r.topSpecies.slice(0, 5)) {
      lines.push(`  ${s.com_name}: ${s.total}`);
    }
  }

  // Best detection
  if (r.bestDetection) {
    lines.push('');
    lines.push(`Best detection: ${r.bestDetection.com_name} (${(r.bestDetection.max_conf * 100).toFixed(1)}%) on ${r.bestDetection.date}`);
  }

  return lines.join('\n');
}

/**
 * Send report via Apprise (same mechanism as alerts).
 */
async function sendReport(title, body) {
  const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
  const _apprisePaths = [
    path.join(process.env.HOME, 'birdengine', 'venv', 'bin', 'apprise'),
    path.join(process.env.HOME, 'birdash', 'engine', 'venv', 'bin', 'apprise'),
  ];
  const appriseBin = _apprisePaths.find(p => fs.existsSync(p)) || _apprisePaths[0];

  try {
    const content = await fsp.readFile(appriseFile, 'utf8');
    if (!content.trim()) { console.log('[BIRDASH] Weekly report: apprise.txt empty, skipping send'); return false; }
  } catch(e) { console.log('[BIRDASH] Weekly report: no apprise.txt, skipping send'); return false; }

  return new Promise((resolve) => {
    execFile(appriseBin, ['-t', title, '-b', body, '--config=' + appriseFile],
      { timeout: 30000 }, (err) => {
        if (err) { console.error('[BIRDASH] Weekly report send error:', err.message); resolve(false); }
        else { console.log('[BIRDASH] Weekly report sent successfully'); resolve(true); }
      });
  });
}

/**
 * Check if it's time to send the weekly report (Sunday evening).
 * Call this hourly. It will generate + send once per week.
 */
let _lastReportWeek = '';

function checkAndSend(db, birdashDb, stationName) {
  const now = new Date();
  if (now.getDay() !== 0) return; // Not Sunday
  if (now.getHours() < 20) return; // Before 8 PM

  const weekEnd = now.toISOString().split('T')[0];
  const monday = new Date(now);
  monday.setDate(now.getDate() - 6);
  const weekStart = monday.toISOString().split('T')[0];
  const weekKey = weekStart;

  if (_lastReportWeek === weekKey) return; // Already sent this week
  _lastReportWeek = weekKey;

  try {
    const report = generateReport(db, weekStart, weekEnd);
    const text = formatText(report, stationName);

    // Save report to config
    const reportPath = path.join(process.env.HOME, 'birdash', 'config', 'weekly-reports.json');
    let reports = [];
    try { reports = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch(e) {}
    reports.push(report);
    if (reports.length > 52) reports = reports.slice(-52); // Keep 1 year
    fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2));

    // Send
    sendReport(`${stationName} Weekly — ${report.overall.species} species, ${(report.overall.total_det || 0).toLocaleString()} detections`, text);
  } catch(e) {
    console.error('[BIRDASH] Weekly report error:', e.message);
  }
}

// ── Utility ──────────────────────────────────────────────────────────────────
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

module.exports = { generateReport, formatText, sendReport, checkAndSend };
