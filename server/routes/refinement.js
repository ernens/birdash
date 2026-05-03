'use strict';
/**
 * Refinement routes — expose les bbox pré-calculés (Detection Refinement
 * Module, Phase 1A). Lecture seule. La table `detection_bbox_v1` est
 * peuplée hors-ligne par `scripts/refinement/backfill_bbox.py`.
 *
 * GET /api/detections/bbox?file=<File_Name>
 *   → 200 { file_name, t_min_s, t_max_s, f_min_hz, f_max_hz,
 *            peak_t_s, peak_energy, snr_estimate, truncated,
 *            algorithm_version, created_at }
 *   → 404 si pas encore raffiné (le frontend tombe alors en mode "pas
 *         d'overlay" — le spectrogramme reste affiché normalement)
 */

function handle(req, res, pathname, ctx) {
  const { db } = ctx;

  if (req.method !== 'GET' || pathname !== '/api/detections/bbox') return false;

  const url = new URL(req.url, 'http://x');
  const file = url.searchParams.get('file');
  if (!file) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing ?file=<File_Name>' }));
    return true;
  }

  try {
    const row = db.prepare(`
      SELECT file_name, t_min_s, t_max_s, f_min_hz, f_max_hz,
             peak_t_s, peak_energy, snr_estimate, truncated,
             algorithm_version, created_at
      FROM detection_bbox_v1
      WHERE file_name = ?
    `).get(file);

    if (!row) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no bbox for this file' }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(row));
  } catch (e) {
    console.error('[refinement]', e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
  return true;
}

module.exports = { handle };
