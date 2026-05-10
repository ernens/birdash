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
 *   const { localDateStr, localDateOffset, localTimeStr } = require('./lib/local-date');
 *   const today = localDateStr();              // "2026-04-12"
 *   const weekAgo = localDateOffset(-7);       // "2026-04-05"
 *   const now = localTimeStr();                // "14:23:07"
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

// "HH:MM:SS" in local time. Pairs with localDateStr for SQL queries
// against (Date, Time) columns, which the engine writes in local time.
function localTimeStr(d) {
  const now = d || new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

module.exports = { localDateStr, localDateOffset, localTimeStr };
