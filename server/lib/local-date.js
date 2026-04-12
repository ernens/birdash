'use strict';
/**
 * Canonical local-date helpers for the analytical layer.
 *
 * Every endpoint that computes "today", "N days ago", or a default date
 * MUST use these instead of toISOString().split('T')[0] — the latter
 * returns UTC which is 1-2 hours behind CEST, producing the wrong
 * calendar day between midnight and ~02:00 local time.
 *
 * Usage:
 *   const { localDateStr, localDateOffset } = require('./lib/local-date');
 *   const today = localDateStr();              // "2026-04-12"
 *   const weekAgo = localDateOffset(-7);       // "2026-04-05"
 */

function localDateStr(d) {
  const now = d || new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function localDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateStr(d);
}

module.exports = { localDateStr, localDateOffset };
