'use strict';
/**
 * Refinement routes — expose les bbox pré-calculés (Detection Refinement
 * Module, Phase 1A) + le verdict de stabilité (Phase 2).
 *
 * GET /api/detections/bbox?file=<File_Name>
 *   → 200 { file_name, t_min_s, t_max_s, f_min_hz, f_max_hz,
 *            peak_t_s, peak_energy, snr_estimate, truncated,
 *            algorithm_version, created_at,
 *            stability_status, recentered_confidence,
 *            ratio_to_original, stability_inference_ms } — les 4 derniers
 *            sont null si Phase 2 n'a pas (encore) tourné sur ce clip.
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
      SELECT b.file_name, b.t_min_s, b.t_max_s, b.f_min_hz, b.f_max_hz,
             b.peak_t_s, b.peak_energy, b.snr_estimate, b.truncated,
             b.algorithm_version, b.created_at,
             s.stability_status        AS stability_status,
             s.recentered_confidence   AS recentered_confidence,
             s.ratio_to_original       AS ratio_to_original,
             s.inference_ms            AS stability_inference_ms
      FROM detection_bbox_v1 b
      LEFT JOIN detection_stability_v1 s ON s.file_name = b.file_name
      WHERE b.file_name = ?
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
