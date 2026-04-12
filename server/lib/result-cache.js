'use strict';
/**
 * Centralized result cache for expensive GET endpoints.
 *
 * Every heavy endpoint (whats-new, timeline, rare-today) can store its
 * last computed result here with a TTL. The cache is invalidated in bulk
 * by clearAll() — called from every mutation handler (delete, validate,
 * favorite toggle) so stale data never outlives the action that changed it.
 *
 * Usage:
 *   const resultCache = require('./lib/result-cache');
 *
 *   // In a GET handler:
 *   const hit = resultCache.get('whats-new');
 *   if (hit) { res.end(JSON.stringify(hit)); return; }
 *   const data = await computeExpensiveStuff();
 *   resultCache.set('whats-new', data, 5 * 60 * 1000); // 5 min TTL
 *
 *   // After any mutation:
 *   resultCache.clearAll();
 */

const _entries = new Map(); // key → { data, expiresAt }

function get(key) {
  const e = _entries.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) { _entries.delete(key); return null; }
  return e.data;
}

function set(key, data, ttlMs) {
  _entries.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function clearAll() {
  _entries.clear();
}

module.exports = { get, set, clearAll };
