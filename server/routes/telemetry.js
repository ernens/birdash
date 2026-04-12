'use strict';
/**
 * Telemetry routes — opt-in/out + status
 */
const telemetry = require('../lib/telemetry');

function handle(req, res, pathname, ctx) {
  const { db, parseBirdnetConf, JSON_CT } = ctx;

  // ── GET /api/telemetry/status ─────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/telemetry/status') {
    res.writeHead(200, JSON_CT);
    res.end(JSON.stringify(telemetry.getStatus()));
    return true;
  }

  // ── POST /api/telemetry/register ──────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/telemetry/register') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      (async () => {
        try {
          const { stationName } = JSON.parse(body || '{}');
          const conf = await parseBirdnetConf();
          const lat = parseFloat(conf.LATITUDE || conf.LAT || '0');
          const lon = parseFloat(conf.LONGITUDE || conf.LON || '0');
          const model = conf.MODEL || conf.BIRDNET_MODEL || '';

          const result = await telemetry.register(stationName, lat, lon, model);

          // Start daily cron now that we're registered
          telemetry.startDailyCron(db);

          res.writeHead(200, JSON_CT);
          res.end(JSON.stringify({ ok: true, ...result }));
        } catch (e) {
          console.error('[telemetry-route]', e.message);
          res.writeHead(500, JSON_CT);
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return true;
  }

  // ── POST /api/telemetry/disable ───────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/telemetry/disable') {
    telemetry.disable();
    res.writeHead(200, JSON_CT);
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  return false;
}

module.exports = { handle };
