'use strict';
/**
 * Weather Prefetch — keeps a fresh copy of the Open-Meteo daily aggregate
 * response on disk so `/api/weather?days=30` never has to wait on the
 * external API at request time. Without this, cold-start TTFB was 36-83 s
 * (Pi 4 → Open-Meteo HTTPS handshake + slow path), measured 2026-05-13.
 *
 * Different from weather-watcher.js: that one writes hourly snapshots to
 * birdash.db for per-detection chips. This one writes the *daily*
 * aggregate JSON that weather.html consumes for the 30-day chart + the
 * 2-day forecast tile. Two different Open-Meteo response shapes.
 *
 * Strategy: synchronous file read on the route, async refresh in the
 * background every 30 min. A missing or unreadable file falls through to
 * a direct fetch (cold-boot path only).
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const CACHE_PATH = path.join(PROJECT_ROOT, 'data', 'weather-cache.json');
const TICK_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT = 30000;
const DEFAULT_DAYS = 30;

let _timer = null;
let _parseBirdnetConf = null;
let _inFlight = null;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: REQUEST_TIMEOUT }, (resp) => {
      let body = '';
      resp.on('data', c => { body += c; });
      resp.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
      });
      resp.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function refresh(days) {
  if (_inFlight) return _inFlight;
  const window = days || DEFAULT_DAYS;
  _inFlight = (async () => {
    try {
      const conf = await _parseBirdnetConf();
      const lat = conf.LATITUDE  || conf.LAT || '50.85';
      const lon = conf.LONGITUDE || conf.LON || '4.35';
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}` +
        `&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,` +
        `precipitation_sum,windspeed_10m_max&past_days=${window}` +
        `&forecast_days=2&timezone=auto`;
      const data = await fetchJson(url);
      if (data.error) throw new Error(data.reason || data.error);
      const result = {
        daily: data.daily || {},
        daily_units: data.daily_units || {},
        latitude: data.latitude,
        longitude: data.longitude,
        timezone: data.timezone,
        fetchedAt: new Date().toISOString(),
        _days: window,
      };
      fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      const tmp = CACHE_PATH + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(result));
      fs.renameSync(tmp, CACHE_PATH);
      console.log('[BIRDASH] weather-prefetch: refreshed (' + window + ' days)');
      return result;
    } catch (e) {
      console.error('[BIRDASH] weather-prefetch error:', e.message);
      return null;
    } finally {
      _inFlight = null;
    }
  })();
  return _inFlight;
}

function read() {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const obj = JSON.parse(raw);
    const ageMs = Date.now() - new Date(obj.fetchedAt).getTime();
    return { ...obj, ageMs };
  } catch {
    return null;
  }
}

function start(parseBirdnetConf) {
  if (_timer) return;
  _parseBirdnetConf = parseBirdnetConf;
  setTimeout(() => refresh(), 5000);  // initial kick, after server is up
  _timer = setInterval(() => refresh(), TICK_MS);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop, refresh, read, CACHE_PATH, DEFAULT_DAYS };
