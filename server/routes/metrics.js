'use strict';
/**
 * Prometheus scrape endpoint.
 *
 * Both `/metrics` (Prometheus convention) and `/api/metrics` (birdash
 * convention) point at the same handler. Public — birdash binds to
 * 127.0.0.1, Caddy decides what to expose externally. If you proxy this
 * publicly, gate it in Caddy with basicauth or an IP allowlist.
 */

const _metrics = require('../lib/metrics');

function handle(req, res, pathname /*, ctx */) {
  if (req.method !== 'GET') return false;
  if (pathname !== '/metrics' && pathname !== '/api/metrics') return false;

  (async () => {
    try {
      const body = await _metrics.collect();
      res.writeHead(200, { 'Content-Type': _metrics.contentType() });
      res.end(body);
    } catch (e) {
      console.error('[metrics]', e.message);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('# scrape failed: ' + e.message + '\n');
    }
  })();
  return true;
}

module.exports = { handle };
