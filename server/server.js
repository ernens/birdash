#!/usr/bin/env node
/**
 * BIRDASH — Backend API
 * Expose birds.db (SQLite) via HTTP POST /api/query
 * Port 7474 — proxifié par Caddy sous /birds/api/
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const { spawn } = require('child_process');

// --- Dépendance : better-sqlite3 (npm install better-sqlite3)
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('[BIRDASH] better-sqlite3 non trouvé. Exécute : npm install better-sqlite3');
  process.exit(1);
}

const https = require('https');
const SunCalc = require('suncalc');
const _backupRoutes = require('./routes/backup');
const _alerts = require('./lib/alerts');
const _timelineRoutes = require('./routes/timeline');
const _systemRoutes = require('./routes/system');
const _whatsNewRoutes = require('./routes/whats-new');
const _dataRoutes = require('./routes/data');
const _detectionRoutes = require('./routes/detections');
const _audioRoutes = require('./routes/audio');

const JSON_CT = { 'Content-Type': 'application/json' };

// --- Configuration
const PORT      = process.env.BIRDASH_PORT || 7474;
const DB_PATH   = process.env.BIRDASH_DB   || path.join(
  process.env.HOME, 'birdash', 'data', 'birds.db'
);
const SONGS_DIR = process.env.BIRDASH_SONGS_DIR || path.join(
  process.env.HOME, 'BirdSongs', 'Extracted', 'By_Date'
);
const PHOTO_CACHE_DIR = path.join(process.env.HOME, 'birdash', 'photo-cache');

// ── Security ─────────────────────────────────────────────────────────────────
// Optional API token for write operations (POST/DELETE).
// If set, mutating endpoints require: Authorization: Bearer <token>
const API_TOKEN = process.env.BIRDASH_API_TOKEN || '';

// Content-Security-Policy — restrict what the browser can load
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "media-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// ── Settings helpers ────────────────────────────────────────────────────────
const BIRDNET_CONF = '/etc/birdnet/birdnet.conf';
const _birdashEngine = path.join(process.env.HOME, 'birdash', 'engine');
const _birdengine = path.join(process.env.HOME, 'birdengine');
// Use birdengine if it has .tflite models, otherwise fall back to birdash/engine
const _hasModels = (dir) => { try { return fs.readdirSync(path.join(dir, 'models')).some(f => f.endsWith('.tflite')); } catch { return false; } };
const BIRDNET_DIR = _hasModels(_birdengine) ? _birdengine : _hasModels(_birdashEngine) ? _birdashEngine : _birdengine;

// Parse birdnet.conf → { KEY: value } — cached 60s
let _birdnetConfCache = null;
let _birdnetConfTs = 0;
const BIRDNET_CONF_TTL = 60 * 1000;

async function parseBirdnetConf() {
  const now = Date.now();
  if (_birdnetConfCache && (now - _birdnetConfTs) < BIRDNET_CONF_TTL) {
    return _birdnetConfCache;
  }
  const raw = await fsp.readFile(BIRDNET_CONF, 'utf8');
  const conf = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Remove surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    conf[key] = val;
  }
  _birdnetConfCache = conf;
  _birdnetConfTs = now;
  return conf;
}

// Write updates to birdnet.conf (preserves comments, ordering, creates backup)
async function writeBirdnetConf(updates) {
  // Backup first
  await fsp.copyFile(BIRDNET_CONF, BIRDNET_CONF + '.bak').catch(() => {});
  const raw = await fsp.readFile(BIRDNET_CONF, 'utf8');
  const lines = raw.split('\n');
  const written = new Set();
  const result = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eq = trimmed.indexOf('=');
    if (eq < 1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key in updates) {
      written.add(key);
      const val = updates[key];
      // Quote if contains spaces or special chars
      const needsQuote = /[\s#"'$]/.test(String(val));
      return needsQuote ? `${key}="${val}"` : `${key}=${val}`;
    }
    return line;
  });
  // Append keys that weren't already in the file
  for (const key of Object.keys(updates)) {
    if (!written.has(key)) {
      const val = updates[key];
      const needsQuote = /[\s#"'$]/.test(String(val));
      result.push(needsQuote ? `${key}="${val}"` : `${key}=${val}`);
      written.add(key);
    }
  }
  // Write via temp file + sudo cp
  const tmpFile = '/tmp/birdnet.conf.tmp';
  await fsp.writeFile(tmpFile, result.join('\n'));
  await execCmd('sudo', ['cp', tmpFile, BIRDNET_CONF]);
  await fsp.unlink(tmpFile).catch(() => {});
}

// Execute a command, return stdout
function execCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `exit ${code}`)));
  });
}

// Validation whitelist for settings
const SETTINGS_VALIDATORS = {
  SITE_NAME:       v => typeof v === 'string' && v.length <= 100,
  SITE_BRAND:      v => typeof v === 'string' && v.length <= 50,
  LATITUDE:        v => !isNaN(v) && v >= -90 && v <= 90,
  LONGITUDE:       v => !isNaN(v) && v >= -180 && v <= 180,
  MODEL:           v => typeof v === 'string' && /^[a-zA-Z0-9_.\-]+$/.test(v),
  SF_THRESH:       v => !isNaN(v) && v >= 0 && v <= 1,
  CONFIDENCE:      v => !isNaN(v) && v >= 0.01 && v <= 0.99,
  BIRDNET_CONFIDENCE: v => !isNaN(v) && v >= 0.01 && v <= 0.99,
  PERCH_CONFIDENCE:   v => !isNaN(v) && v >= 0.01 && v <= 0.99,
  PERCH_MIN_MARGIN:   v => !isNaN(v) && v >= 0 && v <= 0.5,
  SENSITIVITY:     v => !isNaN(v) && v >= 0.5 && v <= 1.5,
  OVERLAP:         v => !isNaN(v) && v >= 0 && v <= 2.9,
  RECORDING_LENGTH: v => !isNaN(v) && v >= 6 && v <= 120,
  EXTRACTION_LENGTH: v => v === '' || (!isNaN(v) && v >= 3 && v <= 30),
  AUDIOFMT:        v => ['mp3','wav','flac','ogg'].includes(v),
  CHANNELS:        v => v == 1 || v == 2,
  DATABASE_LANG:   v => /^[a-z]{2}(_[A-Z]{2})?$/.test(v),
  BIRDWEATHER_ID:  v => typeof v === 'string' && v.length <= 64,
  FULL_DISK:       v => ['purge','keep'].includes(v),
  PURGE_THRESHOLD: v => !isNaN(v) && v >= 50 && v <= 99,
  MAX_FILES_SPECIES: v => !isNaN(v) && v >= 0,
  PRIVACY_THRESHOLD: v => !isNaN(v) && v >= 0 && v <= 3,
  DUAL_MODEL_ENABLED: v => v == 0 || v == 1,
  SECONDARY_MODEL: v => typeof v === 'string' && v.length <= 100,
  NOTIFY_RARE_SPECIES: v => v == 0 || v == 1,
  NOTIFY_RARE_THRESHOLD: v => !isNaN(v) && v >= 1 && v <= 1000,
  NOTIFY_FIRST_SEASON: v => v == 0 || v == 1,
  NOTIFY_FAVORITES:    v => v == 0 || v == 1,
  NOTIFY_SEASON_DAYS: v => !isNaN(v) && v >= 7 && v <= 365,
  AUDIO_RETENTION_DAYS: v => !isNaN(v) && v >= 7 && v <= 365,
  NOTIFY_ENABLED: v => v == 0 || v == 1,
  REC_CARD:        v => typeof v === 'string' && v.length <= 200,
  RTSP_STREAM:     v => typeof v === 'string' && v.length <= 500,
  APPRISE_NOTIFY_EACH_DETECTION: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES: v => v == 0 || v == 1,
  APPRISE_NOTIFY_NEW_SPECIES_EACH_DAY: v => v == 0 || v == 1,
  APPRISE_WEEKLY_REPORT: v => v == 0 || v == 1,
  APPRISE_NOTIFICATION_TITLE: v => typeof v === 'string' && v.length <= 200,
  APPRISE_NOTIFICATION_BODY: v => typeof v === 'string' && v.length <= 500,
  APPRISE_MINIMUM_SECONDS_BETWEEN_NOTIFICATIONS_PER_SPECIES: v => !isNaN(v) && v >= 0,
  BIRDASH_ALERT_TEMP_WARN: v => !isNaN(v) && v >= 30 && v <= 100,
  BIRDASH_ALERT_TEMP_CRIT: v => !isNaN(v) && v >= 30 && v <= 100,
  BIRDASH_ALERT_DISK_WARN: v => !isNaN(v) && v >= 30 && v <= 99,
  BIRDASH_ALERT_DISK_CRIT: v => !isNaN(v) && v >= 30 && v <= 99,
  BIRDASH_ALERT_RAM_WARN:  v => !isNaN(v) && v >= 30 && v <= 99,
  BIRDASH_ALERT_BACKLOG:   v => !isNaN(v) && v >= 1 && v <= 1000,
  BIRDASH_ALERT_NO_DET_H:  v => !isNaN(v) && v >= 1 && v <= 168,
  BIRDASH_ALERT_ON_TEMP:      v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_TEMP_CRIT: v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_DISK:      v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_RAM:       v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_BACKLOG:   v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_NO_DET:    v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_INFLUX:    v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_MISSING:   v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_RARE_VISITOR: v => v == 0 || v == 1,
  BIRDASH_ALERT_ON_SVC_DOWN: v => v == 0 || v == 1,
  IMAGE_PROVIDER:  v => ['WIKIPEDIA','FLICKR'].includes(v),
  RARE_SPECIES_THRESHOLD: v => !isNaN(v) && v >= 1 && v <= 365,
  RAW_SPECTROGRAM: v => v == 0 || v == 1,
  DATA_MODEL_VERSION: v => v == 1 || v == 2,
};

// ── Backup cron helper ────────────────────────────────────────────────────────
// Allowed services for restart
const ALLOWED_SERVICES = ['birdengine', 'birdengine-recording', 'birdash', 'caddy', 'ttyd'];

// Charger la config locale (birdash-local.js) si disponible
// — silencieux si le fichier n'existe pas (installation fraîche)
let _localConfig = {};
try {
  const fs_test = require('fs');
  const localPath = require('path').join(__dirname, '..', 'public', 'js', 'birdash-local.js');
  if (fs_test.existsSync(localPath)) {
    _localConfig = require(localPath);
    console.log('[BIRDASH] Config locale chargée : birdash-local.js');
  }
} catch(e) {
  console.warn('[BIRDASH] birdash-local.js non chargé :', e.message);
}

// Clé API eBird — configurable via birdash-local.js (ebirdApiKey)
// ou variable d'environnement EBIRD_API_KEY
const EBIRD_API_KEY  = process.env.EBIRD_API_KEY  || _localConfig.ebirdApiKey        || '';
const EBIRD_REGION   = (_localConfig.location && _localConfig.location.region) || 'BE';
const BW_STATION_ID  = process.env.BW_STATION_ID  || _localConfig.birdweatherStationId || '';
// Cache BirdWeather (TTL 5 min — données live)
let _bwCache = null, _bwCacheTs = 0;
const BW_TTL = 5 * 60 * 1000;
let _ebirdCache = null;
let _ebirdCacheTs = 0;
let _weatherCache = null;
let _weatherCacheTs = 0;
const WEATHER_TTL = 3600 * 1000; // 1 heure
const _speciesNamesCache = {}; // lang → { sci: comName }
let _detectedSpeciesCache = null; // [sci, sci, …]
let _detectedSpeciesCacheTs = 0;
const EBIRD_TTL = 3600 * 1000; // 1 heure
let _whatsNewCache = null, _whatsNewCacheTs = 0;
const WHATS_NEW_TTL = 5 * 60 * 1000; // 5 minutes
const TIMELINE_TTL_TODAY = 2 * 60 * 1000;  // 2 min pour aujourd'hui
const TIMELINE_TTL_PAST  = 60 * 60 * 1000; // 60 min pour dates passées

// Créer le répertoire cache photos si absent
if (!fs.existsSync(PHOTO_CACHE_DIR)) {
  fs.mkdirSync(PHOTO_CACHE_DIR, { recursive: true });
  console.log(`[BIRDASH] Dossier photo-cache créé : ${PHOTO_CACHE_DIR}`);
}

// ── Photo cache helpers ─────────────────────────────────────────────────────

// Nom de fichier sûr : "Pica pica" → "Pica_pica"
function photoCacheKey(sciName) {
  return sciName.replace(/[^a-zA-Z0-9_\-]/g, '_').replace(/__+/g, '_');
}

// Fetch HTTPS avec redirect (max 3 sauts) — retourne Buffer ou null
function fetchBuffer(url, hops = 3) {
  return new Promise((resolve) => {
    if (hops <= 0) return resolve(null);
    const lib = url.startsWith('https') ? https : require('http');
    lib.get(url, { headers: { 'User-Agent': 'BIRDASH/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchBuffer(res.headers.location, hops - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// Fetch JSON depuis une URL HTTPS
function fetchJson(url, extraHeaders = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : require('http');
    const headers = { 'User-Agent': 'BIRDASH/1.0', 'Accept': 'application/json', ...extraHeaders };
    lib.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve(null); } });
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
  });
}

// Résoudre l'URL de photo pour un nom scientifique (iNat → Wikipedia)
async function resolvePhotoUrl(sciName) {
  // 1. iNaturalist
  const tn   = encodeURIComponent(sciName);
  const data = await fetchJson(
    `https://api.inaturalist.org/v1/taxa?taxon_name=${tn}&rank=species&per_page=3`
  );
  if (data?.results) {
    const taxon = data.results.find(t => t.name.toLowerCase() === sciName.toLowerCase());
    const url   = taxon?.default_photo?.medium_url
               || taxon?.default_photo?.square_url
               || taxon?.default_photo?.url;
    if (url) return { url, src: 'iNaturalist' };
  }
  // 2. Wikipedia
  const title = sciName.replace(/ /g, '_');
  const wiki  = await fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  );
  const wUrl  = wiki?.thumbnail?.source || wiki?.originalimage?.source;
  if (wUrl) return { url: wUrl, src: 'Wikipedia' };

  return null;
}

// Cache a photo from external URL to disk, returns local path or null
async function cacheExternalPhoto(sciName, externalUrl, index) {
  if (!externalUrl) return null;
  const key = photoCacheKey(sciName);
  const suffix = index > 0 ? `_${index}` : '';
  const jpgPath = path.join(PHOTO_CACHE_DIR, `${key}${suffix}.jpg`);
  // Already cached?
  try { await fsp.access(jpgPath); return `/birds/api/photo-idx?sci=${encodeURIComponent(sciName)}&idx=${index}`; } catch {}
  // Download and cache
  try {
    const buf = await fetchBuffer(externalUrl);
    if (buf && buf.length >= 512) {
      await fsp.writeFile(jpgPath, buf);
      const metaPath = path.join(PHOTO_CACHE_DIR, `${key}${suffix}.json`);
      await fsp.writeFile(metaPath, JSON.stringify({ src: externalUrl.includes('inaturalist') ? 'iNaturalist' : 'Wikipedia', original: externalUrl }));
      return `/birds/api/photo-idx?sci=${encodeURIComponent(sciName)}&idx=${index}`;
    }
  } catch(e) { console.error(`[photo-cache] Failed to cache ${sciName}#${index}:`, e.message); }
  return null;
}

// ── Scan des MP3 récents ────────────────────────────────────────────────────
// Retourne la liste des MP3 des dernières 48h, triés par mtime croissant

// Bootstrap DB if missing (fresh install)
if (!fs.existsSync(DB_PATH)) {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  console.log(`[BIRDASH] Creating new birds.db at ${DB_PATH}`);
  const initDb = new Database(DB_PATH);
  initDb.exec(`CREATE TABLE IF NOT EXISTS detections (
    Date DATE, Time TIME, Sci_Name VARCHAR(100) NOT NULL, Com_Name VARCHAR(100) NOT NULL,
    Confidence FLOAT, Lat FLOAT, Lon FLOAT, Cutoff FLOAT,
    Week INT, Sens FLOAT, Overlap FLOAT, File_Name VARCHAR(100) NOT NULL, Model VARCHAR(50)
  )`);
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_date_time ON detections(Date, Time DESC)');
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_com_name ON detections(Com_Name)');
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_sci_name ON detections(Sci_Name)');
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_date_com ON detections(Date, Com_Name)');
  initDb.exec('CREATE INDEX IF NOT EXISTS idx_date_conf ON detections(Date, Confidence)');
  initDb.pragma('journal_mode = WAL');
initDb.pragma('busy_timeout = 5000');
  initDb.close();
  console.log('[BIRDASH] Empty birds.db created successfully');
}

// Ouvre en lecture seule (requêtes SELECT)
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
db.pragma('busy_timeout = 5000');

// Connexion en écriture pour les suppressions uniquement
const dbWrite = new Database(DB_PATH, { fileMustExist: true });
dbWrite.pragma('journal_mode = WAL');
dbWrite.pragma('busy_timeout = 5000');

// Ensure indexes exist on existing databases
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_date_time ON detections(Date, Time DESC)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_com_name ON detections(Com_Name)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_sci_name ON detections(Sci_Name)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_date_com ON detections(Date, Com_Name)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_date_conf ON detections(Date, Confidence)');

// ── Favorites table ──────────────────────────────────────────────────────────
dbWrite.exec(`CREATE TABLE IF NOT EXISTS favorites (
  com_name TEXT PRIMARY KEY,
  sci_name TEXT,
  added_at TEXT DEFAULT (datetime('now'))
)`);

// ── Notes table ─────────────────────────────────────────────────────────────
dbWrite.exec(`CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  com_name TEXT NOT NULL,
  sci_name TEXT,
  date TEXT,
  time TEXT,
  note TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`);
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_notes_species ON notes(com_name)');
dbWrite.exec('CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(com_name, date)');

dbWrite.exec(`CREATE TABLE IF NOT EXISTS photo_preferences (
  sci_name TEXT NOT NULL,
  preferred_idx INTEGER DEFAULT 0,
  banned_urls TEXT DEFAULT '[]',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sci_name)
)`);

console.log(`[BIRDASH] birds.db ouvert : ${DB_PATH}`);

// ── Birdash validation database ──────────────────────────────────────────────
const BIRDASH_DB_PATH = path.join(process.env.HOME, 'birdash', 'birdash.db');
let birdashDb;
try {
  birdashDb = new Database(BIRDASH_DB_PATH);
  birdashDb.pragma('journal_mode = WAL');
  birdashDb.pragma('busy_timeout = 5000');
  birdashDb.exec(`CREATE TABLE IF NOT EXISTS validations (
    date       TEXT,
    time       TEXT,
    sci_name   TEXT,
    status     TEXT DEFAULT 'unreviewed',
    notes      TEXT DEFAULT '',
    updated_at TEXT,
    PRIMARY KEY(date, time, sci_name)
  )`);
  console.log(`[BIRDASH] birdash.db ouvert : ${BIRDASH_DB_PATH}`);
} catch(e) {
  console.error('[BIRDASH] birdash.db error:', e.message);
  birdashDb = null;
}

// ── Taxonomy database ─────────────────────────────────────────────────────────
const TAXONOMY_DB_PATH = path.join(__dirname, '..', 'config', 'taxonomy.db');
const TAXONOMY_CSV_URL = 'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=csv&cat=species';
const TAXONOMY_CACHE_PATH = path.join(__dirname, '..', 'config', 'ebird-taxonomy.csv');
// Synonymes BirdNET → eBird (noms scientifiques qui diffèrent)
const TAXONOMY_SYNONYMS = {
  'Charadrius dubius': 'Thinornis dubius',
  'Corvus monedula': 'Coloeus monedula',
  'Carduelis carduelis': 'Carduelis carduelis',
};

let taxonomyDb;
try {
  taxonomyDb = new Database(TAXONOMY_DB_PATH);
  taxonomyDb.pragma('journal_mode = WAL');
  taxonomyDb.pragma('busy_timeout = 5000');
  taxonomyDb.exec(`CREATE TABLE IF NOT EXISTS species_taxonomy (
    sci_name    TEXT PRIMARY KEY,
    order_name  TEXT,
    family_sci  TEXT,
    family_com  TEXT,
    ebird_code  TEXT,
    taxon_order REAL
  )`);
  taxonomyDb.exec(`CREATE INDEX IF NOT EXISTS idx_tax_order ON species_taxonomy(order_name)`);
  taxonomyDb.exec(`CREATE INDEX IF NOT EXISTS idx_tax_family ON species_taxonomy(family_sci)`);
  taxonomyDb.exec(`CREATE TABLE IF NOT EXISTS family_translations (
    family_sci  TEXT NOT NULL,
    locale      TEXT NOT NULL,
    family_com  TEXT,
    PRIMARY KEY (family_sci, locale)
  )`);
  console.log('[BIRDASH] taxonomy.db ouvert');
} catch(e) {
  console.error('[BIRDASH] taxonomy.db error:', e.message);
  taxonomyDb = null;
}

// Download eBird taxonomy CSV and populate the taxonomy DB
async function refreshTaxonomy() {
  if (!taxonomyDb) return;
  const count = taxonomyDb.prepare('SELECT COUNT(*) as n FROM species_taxonomy').get().n;
  if (count > 1000) {
    console.log(`[BIRDASH] Taxonomy already populated (${count} species)`);
    console.log(`[BIRDASH] Family translations: ${taxonomyDb.prepare('SELECT COUNT(*) as n FROM family_translations').get().n} entries`);
    return;
  }

  console.log('[BIRDASH] Downloading eBird taxonomy...');
  let csvData;
  // Try cached file first
  try {
    const stat = await fsp.stat(TAXONOMY_CACHE_PATH);
    const age = Date.now() - stat.mtimeMs;
    if (age < 30 * 24 * 3600 * 1000) { // less than 30 days old
      csvData = await fsp.readFile(TAXONOMY_CACHE_PATH, 'utf8');
      console.log('[BIRDASH] Using cached eBird taxonomy CSV');
    }
  } catch(e) {}

  if (!csvData) {
    try {
      csvData = await new Promise((resolve, reject) => {
        https.get(TAXONOMY_CSV_URL, res => {
          if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve(data));
          res.on('error', reject);
        }).on('error', reject);
      });
      await fsp.writeFile(TAXONOMY_CACHE_PATH, csvData);
      console.log('[BIRDASH] eBird taxonomy downloaded and cached');
    } catch(e) {
      console.error('[BIRDASH] Failed to download eBird taxonomy:', e.message);
      return;
    }
  }

  // Parse CSV and populate DB
  const lines = csvData.split('\n');
  const header = lines[0];
  // Find column indices by header names
  const cols = header.split(',');
  const iSci = cols.indexOf('SCIENTIFIC_NAME');
  const iOrder = cols.indexOf('ORDER');
  const iFamCom = cols.indexOf('FAMILY_COM_NAME');
  const iFamSci = cols.indexOf('FAMILY_SCI_NAME');
  const iCode = cols.indexOf('SPECIES_CODE');
  const iTaxon = cols.indexOf('TAXON_ORDER');

  if (iSci < 0 || iOrder < 0) {
    console.error('[BIRDASH] eBird CSV format unrecognized');
    return;
  }

  const insert = taxonomyDb.prepare(
    'INSERT OR REPLACE INTO species_taxonomy (sci_name, order_name, family_sci, family_com, ebird_code, taxon_order) VALUES (?,?,?,?,?,?)'
  );
  const tx = taxonomyDb.transaction((rows) => { for (const r of rows) insert.run(...r); });

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Parse CSV respecting quoted fields
    const fields = [];
    let field = '', inQuote = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { fields.push(field); field = ''; continue; }
      field += ch;
    }
    fields.push(field);
    if (fields.length <= Math.max(iSci, iOrder, iFamSci, iFamCom)) continue;
    rows.push([
      fields[iSci], fields[iOrder], fields[iFamSci] || '', fields[iFamCom] || '',
      fields[iCode] || '', parseFloat(fields[iTaxon]) || 0
    ]);
  }
  tx(rows);

  // Add synonyms for BirdNET species that use different names
  const synInsert = taxonomyDb.prepare(
    'INSERT OR IGNORE INTO species_taxonomy (sci_name, order_name, family_sci, family_com, ebird_code, taxon_order) ' +
    'SELECT ?, order_name, family_sci, family_com, ebird_code, taxon_order FROM species_taxonomy WHERE sci_name = ?'
  );
  for (const [birdnet, ebird] of Object.entries(TAXONOMY_SYNONYMS)) {
    synInsert.run(birdnet, ebird);
  }

  console.log(`[BIRDASH] Taxonomy populated: ${rows.length} species`);

  console.log(`[BIRDASH] Family translations: ${taxonomyDb.prepare('SELECT COUNT(*) as n FROM family_translations').get().n} entries`);
}

// Populate taxonomy in background after startup
setTimeout(() => refreshTaxonomy().catch(e => console.error('[BIRDASH] Taxonomy refresh error:', e.message)), 3000);

// ══════════════════════════════════════════════════════════════════════════════

// Start alert monitoring system
_alerts.startAlerts({ db, execCmd, parseBirdnetConf, ALLOWED_SERVICES });

// --- Validation de sécurité
const ALLOWED_START = /^\s*(SELECT|PRAGMA|WITH)\s/i;
const FORBIDDEN     = /(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|ATTACH|DETACH|REINDEX|VACUUM)\s/i;
const FORBIDDEN_CHARS = /;/; // Interdit les requêtes multiples

function validateQuery(sql) {
  if (!sql || typeof sql !== 'string') return false;
  if (sql.length > 4000)               return false;
  if (!ALLOWED_START.test(sql))        return false;
  // Retirer les string literals avant de vérifier les mots-clés dangereux
  const stripped = sql.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
  if (FORBIDDEN.test(stripped))        return false;
  // Interdire les points-virgules (requêtes multiples)
  if (FORBIDDEN_CHARS.test(stripped))  return false;
  return true;
}

// --- Origines autorisées pour CORS (configurable via env)
const ALLOWED_ORIGINS = (process.env.BIRDASH_CORS_ORIGINS || '').split(',').filter(Boolean);

function getCorsOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;
  // Si aucune origine configurée, autoriser localhost uniquement
  if (ALLOWED_ORIGINS.length === 0) {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
    return null;
  }
  // Vérifier si l'origine est dans la liste autorisée
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) return origin;
  return null;
}

// --- Rate limiter en mémoire (par IP, token bucket)
const _rateBuckets = new Map();
const RATE_WINDOW  = 60 * 1000; // 1 minute
const RATE_MAX     = 120;       // max requêtes par minute par IP
// Nettoyage périodique des buckets expirés
const _rateBucketCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of _rateBuckets) {
    if (now - b.ts > RATE_WINDOW * 2) _rateBuckets.delete(ip);
  }
}, 5 * 60 * 1000);

function rateLimit(req) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = _rateBuckets.get(ip);
  if (!bucket || now - bucket.ts > RATE_WINDOW) {
    bucket = { count: 0, ts: now };
    _rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_MAX;
}

// ── Auth helper: check Bearer token for write operations ─────────────────────
function requireAuth(req, res) {
  if (!API_TOKEN) return true; // no token configured → open access (LAN-only deployment)
  const auth = req.headers['authorization'] || '';
  // Only accept Bearer token in header (no query string — avoids log/proxy leaks)
  if (auth === `Bearer ${API_TOKEN}`) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized — set Authorization: Bearer <token> header' }));
  return false;
}
if (!API_TOKEN) console.warn('[BIRDASH] WARNING: No BIRDASH_API_TOKEN set — write endpoints are unprotected. Set Environment=BIRDASH_API_TOKEN=... in birdash.service for production.');

// --- Adaptive gain state & logic (module-level for background collector access)
function readJsonFile(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function writeJsonFileAtomic(p, data) {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}
// --- Shared context for route modules
const _routeCtx = {
  requireAuth, execCmd, readJsonFile, writeJsonFileAtomic, JSON_CT,
  db, dbWrite, birdashDb, taxonomyDb, parseBirdnetConf, SONGS_DIR,
  ALLOWED_SERVICES, BIRDNET_DIR, validateQuery, photoCacheKey, PHOTO_CACHE_DIR,
};

// --- Handler HTTP
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB max for POST bodies

const server = http.createServer((req, res) => {
  // Body size limit for POST requests
  if (req.method === 'POST') {
    let bodySize = 0;
    let bodyLimited = false;
    req.on('data', (chunk) => {
      bodySize += chunk.length;
      if (bodySize > MAX_BODY_SIZE && !bodyLimited) {
        bodyLimited = true;
        req.removeAllListeners('data'); // Stop reading
        req._aborted = true;
        if (!res.headersSent) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
        }
      }
    });
    // Expose flag for route handlers to check
    req._bodyLimited = () => bodyLimited;
  }

  // Headers de sécurité
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // CSP set below after pathname is parsed

  // CORS — restrictif par défaut
  const allowedOrigin = getCorsOrigin(req);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Rate limiting
  if (rateLimit(req)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'Too many requests' }));
    return;
  }

  // Skip if body was already rejected (413)
  if (req._aborted) return;
  // Extraire le pathname proprement (ignore query string éventuel)
  const pathname = req.url.split('?')[0].replace(/\/$/, '') || '/';
  // CSP only for non-API routes (HTML pages)
  if (!pathname.startsWith('/api/')) res.setHeader('Content-Security-Policy', CSP);
  console.log(`[BIRDASH] ${req.method} ${req.url} → pathname: ${pathname}`);

  // ── Route : GET /api/photo?sci=Pica+pica ────────────────────────────────────
  // Cache disque → iNaturalist → Wikipedia
  if (req.method === 'GET' && pathname === '/api/photo') {
    const sciName = new URL(req.url, 'http://localhost').searchParams.get('sci');

    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end('sci param required'); return;
    }

    const key      = photoCacheKey(sciName);
    const jpgPath  = path.join(PHOTO_CACHE_DIR, key + '.jpg');
    const metaPath = path.join(PHOTO_CACHE_DIR, key + '.json');

    // Route photo entièrement async
    (async () => {
      try {
        // ── Cas 1 : image en cache disque ────────────────────────────────
        try {
          await fsp.access(jpgPath);
          // Le fichier existe
          let meta = { src: 'cache' };
          try { meta = JSON.parse(await fsp.readFile(metaPath, 'utf8')); } catch(e) {}
          res.writeHead(200, {
            'Content-Type':  'image/jpeg',
            'Cache-Control': 'public, max-age=2592000',
            'X-Photo-Source': meta.src || 'cache',
          });
          fs.createReadStream(jpgPath).pipe(res);
          return;
        } catch(e) { /* pas en cache, on résout */ }

        // ── Cas 2 : résoudre + télécharger + mettre en cache ─────────────
        const resolved = await resolvePhotoUrl(sciName);
        if (!resolved) {
          res.writeHead(404); res.end('no photo found'); return;
        }

        const imgBuf = await fetchBuffer(resolved.url);
        if (!imgBuf || imgBuf.length < 512) {
          res.writeHead(502); res.end('image fetch failed'); return;
        }

        // Sauvegarder sur disque (async)
        await fsp.writeFile(jpgPath, imgBuf);
        await fsp.writeFile(metaPath, JSON.stringify({ src: resolved.src, original: resolved.url }));
        console.log(`[photo-cache] ${sciName} → ${resolved.src} (${imgBuf.length} bytes)`);

        res.writeHead(200, {
          'Content-Type':   'image/jpeg',
          'Content-Length': imgBuf.length,
          'Cache-Control':  'public, max-age=2592000',
          'X-Photo-Source': resolved.src,
        });
        res.end(imgBuf);
      } catch(e) {
        console.error('[photo]', e.message);
        if (!res.headersSent) { res.writeHead(500); res.end(); }
      }
    })();
    return;
  }

  // ── Route : GET /api/photo-idx?sci=Pica+pica&idx=0 ──────────────────────────
  // Serves cached indexed photos (multiple photos per species)
  if (req.method === 'GET' && pathname === '/api/photo-idx') {
    const idxParams = new URL(req.url, 'http://localhost').searchParams;
    const sciName = idxParams.get('sci');
    const idx = parseInt(idxParams.get('idx') || '0', 10);
    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end('sci param required'); return;
    }
    (async () => {
      const key = photoCacheKey(sciName);
      const suffix = idx > 0 ? `_${idx}` : '';
      const jpgPath = path.join(PHOTO_CACHE_DIR, `${key}${suffix}.jpg`);
      try {
        await fsp.access(jpgPath);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=2592000',
        });
        fs.createReadStream(jpgPath).pipe(res);
      } catch {
        const fallback = path.join(PHOTO_CACHE_DIR, `${key}.jpg`);
        try {
          await fsp.access(fallback);
          res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000' });
          fs.createReadStream(fallback).pipe(res);
        } catch {
          res.writeHead(404); res.end('photo not found');
        }
      }
    })();
    return;
  }

  // ── Route : DELETE /api/photo?sci=Pica+pica ─────────────────────────────────
  // Delete cached photo so next GET re-fetches from iNaturalist/Wikipedia
  if (req.method === 'DELETE' && pathname === '/api/photo') {
    if (!requireAuth(req, res)) return;
    const sciName = new URL(req.url, 'http://localhost').searchParams.get('sci');
    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'sci param required' })); return;
    }
    (async () => {
      try {
        const key = photoCacheKey(sciName);
        const jpgPath = path.join(PHOTO_CACHE_DIR, key + '.jpg');
        const metaPath = path.join(PHOTO_CACHE_DIR, key + '.json');
        let deleted = false;
        try { await fsp.unlink(jpgPath); deleted = true; } catch(e) {}
        try { await fsp.unlink(metaPath); } catch(e) {}
        console.log(`[photo-cache] Deleted: ${sciName} (${deleted ? 'found' : 'not cached'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/photo-cache-stats ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/photo-cache-stats') {
    (async () => {
      try {
        const files = (await fsp.readdir(PHOTO_CACHE_DIR)).filter(f => f.endsWith('.jpg'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cached: files.length, dir: PHOTO_CACHE_DIR }));
      } catch(e) {
        console.error('[photo-cache-stats]', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: 'cache_error' }));
      }
    })();
    return;
  }

  // ── Route : GET /api/species-names?lang=de ──────────────────────────────
  // Returns { "Sci_Name": "Translated Com_Name" } from BirdNET label files
  if (req.method === 'GET' && pathname === '/api/species-names') {
    const lang = new URL(req.url, 'http://localhost').searchParams.get('lang') || 'fr';
    if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(lang)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'invalid lang' })); return;
    }

    // Cache in memory (labels don't change at runtime)
    // Limit cache to 6 languages to prevent unbounded growth
    if (Object.keys(_speciesNamesCache).length > 6) {
      const oldest = Object.keys(_speciesNamesCache)[0];
      delete _speciesNamesCache[oldest];
    }
    if (!_speciesNamesCache[lang]) {
      const candidates = [
        path.join(process.env.HOME, 'birdash', 'engine', 'models', 'l18n', `labels_${lang}.json`),
        path.join(process.env.HOME, 'birdengine', 'models', 'l18n', `labels_${lang}.json`),
      ];
      const labelFile = candidates.find(f => fs.existsSync(f));
      try {
        if (!labelFile) throw new Error('not found');
        const raw = fs.readFileSync(labelFile, 'utf8');
        _speciesNamesCache[lang] = JSON.parse(raw);
        console.log(`[species-names] Loaded ${Object.keys(_speciesNamesCache[lang]).length} names for ${lang}`);
      } catch(e) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `labels_${lang}.json not found` }));
        return;
      }
    }

    // Only return species that exist in our DB (not all 7000)
    // Invalidate cache after 1 hour
    if (_detectedSpeciesCache && (Date.now() - _detectedSpeciesCacheTs) > 3600000) _detectedSpeciesCache = null;
    const detected = _detectedSpeciesCache || (function() {
      const rows = db.prepare('SELECT DISTINCT Sci_Name FROM detections').all();
      _detectedSpeciesCache = rows.map(r => r.Sci_Name);
      _detectedSpeciesCacheTs = Date.now();
      return _detectedSpeciesCache;
    })();

    const result = {};
    const labels = _speciesNamesCache[lang];
    for (const sci of detected) {
      if (labels[sci]) result[sci] = labels[sci];
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400',
    });
    res.end(JSON.stringify(result));
    return;
  }

  // ── Route : GET /api/species-info?sci=Pica+pica ───────────────────────────
  // Returns multiple photos + Wikipedia summary for species detail page
  if (req.method === 'GET' && pathname === '/api/species-info') {
    const spParams = new URL(req.url, 'http://localhost').searchParams;
    const sciName = spParams.get('sci');
    let infoLang = spParams.get('lang') || 'fr';
    if (!/^[a-z]{2}$/.test(infoLang)) infoLang = 'en'; // SSRF guard
    if (!sciName || !/^[a-zA-Z ]+$/.test(sciName)) {
      res.writeHead(400); res.end(JSON.stringify({ error: 'sci param required' })); return;
    }

    (async () => {
      try {
        const result = { photos: [], summary: '', summaryFr: '', habitat: '', range: '', conservation: '', family: '', order: '', wingspan: '', size: '', diet: '' };
        const tn = encodeURIComponent(sciName);

        // 1. iNaturalist — taxon info + observation photos
        const inatData = await fetchJson(
          `https://api.inaturalist.org/v1/taxa?q=${tn}&rank=species&per_page=5`
        );
        const taxon = inatData?.results?.find(t => t.name.toLowerCase() === sciName.toLowerCase());

        if (taxon) {
          // Default photo
          const dp = taxon.default_photo;
          if (dp) {
            const medUrl = dp.medium_url || dp.url;
            if (medUrl) result.photos.push({ url: medUrl, attr: dp.attribution || '', src: 'iNaturalist' });
          }
          // Taxonomy
          if (taxon.iconic_taxon_name) result.order = taxon.iconic_taxon_name;
          if (taxon.ancestors) {
            const fam = taxon.ancestors.find(a => a.rank === 'family');
            if (fam) result.family = fam.name;
            const ord = taxon.ancestors.find(a => a.rank === 'order');
            if (ord) result.order = ord.name;
          }

          // Observation photos (research-grade, top-voted — diverse angles)
          const obsData = await fetchJson(
            `https://api.inaturalist.org/v1/observations?taxon_id=${taxon.id}&quality_grade=research&photos=true&per_page=10&order=desc&order_by=votes`
          );
          if (obsData?.results) {
            for (const obs of obsData.results) {
              if (result.photos.length >= 10) break;
              for (const p of (obs.photos || [])) {
                if (result.photos.length >= 10) break;
                const url = p.url?.replace(/square/, 'medium');
                if (url && !result.photos.some(x => x.url === url)) {
                  result.photos.push({ url, attr: p.attribution || '', src: 'iNaturalist' });
                }
              }
            }
          }

          // Conservation status
          if (taxon.conservation_status) {
            result.conservation = taxon.conservation_status.status_name || taxon.conservation_status.status || '';
          } else if (taxon.conservation_statuses?.length) {
            const iucn = taxon.conservation_statuses.find(c => c.authority === 'IUCN Red List') || taxon.conservation_statuses[0];
            result.conservation = iucn.status_name || iucn.status || '';
          }
        }

        // 2. English Wikipedia — summary
        const wikiTitle = sciName.replace(/ /g, '_');
        const wiki = await fetchJson(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`
        );
        if (wiki) {
          result.summary = wiki.extract || '';
          if (wiki.originalimage?.source && result.photos.length < 10) {
            result.photos.push({ url: wiki.originalimage.source, attr: 'Wikipedia', src: 'Wikipedia' });
          }
        }

        // 3. Localized Wikipedia — description in user's language
        if (infoLang !== 'en') {
          const wikiLocal = await fetchJson(
            `https://${infoLang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`
          );
          if (wikiLocal?.extract) {
            result.summaryFr = wikiLocal.extract;
          }
        }

        // 4. Try Wikidata for structured data (size, wingspan, habitat, diet)
        try {
          const wdSearch = await fetchJson(
            `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${tn}&language=en&format=json&limit=1`
          );
          const wdId = wdSearch?.search?.[0]?.id;
          if (wdId) {
            const wdEntity = await fetchJson(
              `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wdId}&props=claims&format=json`
            );
            const claims = wdEntity?.entities?.[wdId]?.claims;
            if (claims) {
              // P2050 = wingspan, P2048 = height/length
              const getAmount = (prop) => {
                const c = claims[prop]?.[0]?.mainsnak?.datavalue?.value;
                return c?.amount ? parseFloat(c.amount) : null;
              };
              const ws = getAmount('P2050');
              if (ws) result.wingspan = ws > 10 ? `${Math.round(ws)} cm` : `${Math.round(ws*100)} cm`;
              const sz = getAmount('P2048');
              if (sz) result.size = sz > 10 ? `${Math.round(sz)} cm` : `${Math.round(sz*100)} cm`;

              // P2572 = IUCN conservation status label (if not already set)
              if (!result.conservation && claims['P141']?.[0]?.mainsnak?.datavalue?.value?.id) {
                const csId = claims['P141'][0].mainsnak.datavalue.value.id;
                const csMap = { Q211005:'Least Concern', Q719675:'Near Threatened', Q278113:'Vulnerable',
                                Q11394:'Endangered', Q219127:'Critically Endangered', Q3245245:'Data Deficient' };
                result.conservation = csMap[csId] || '';
              }
            }
          }
        } catch(e) { /* Wikidata optional */ }

        // Deduplicate photos by URL
        const seen = new Set();
        result.photos = result.photos.filter(p => {
          const key = p.url.replace(/\/\d+px-/, '/XXpx-');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        // Cache all photos locally and replace external URLs with local ones
        const cachedPhotos = await Promise.all(
          result.photos.map(async (p, i) => {
            const localUrl = await cacheExternalPhoto(sciName, p.url, i);
            return { url: localUrl || p.url, attr: p.attr, src: p.src };
          })
        );
        result.photos = cachedPhotos;

        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(JSON.stringify(result));
      } catch(e) {
        console.error('[species-info]', e.message);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: 'internal_error' }));
        }
      }
    })();
    return;
  }

  // ── Route : GET /api/birdweather ─────────────────────────────────────────────
  // Proxy BirdWeather API — évite les CORS + cache 5 min
  // ?endpoint=stats|species|detections  ?period=day|week|month|all
  if (req.method === 'GET' && pathname === '/api/birdweather') {
    if (!BW_STATION_ID) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_station', message: 'birdweatherStationId non configuré dans birdash-local.js' }));
      return;
    }
    const qp       = new URL(req.url, 'http://localhost').searchParams;
    const VALID_ENDPOINTS = ['stats', 'species', 'detections'];
    const VALID_PERIODS   = ['day', 'week', 'month', 'all'];
    const endpoint = VALID_ENDPOINTS.includes(qp.get('endpoint')) ? qp.get('endpoint') : 'stats';
    const period   = VALID_PERIODS.includes(qp.get('period'))     ? qp.get('period')   : 'day';
    const locale   = /^[a-z]{2}$/.test(qp.get('locale') || '')   ? qp.get('locale')   : 'fr';
    const limit    = Math.min(20, Math.max(1, parseInt(qp.get('limit') || '10') || 10));
    const cacheKey = `${endpoint}_${period}`;
    if (_bwCache && _bwCache[cacheKey] && _bwCache[cacheKey]._ts && (Date.now() - _bwCache[cacheKey]._ts) < BW_TTL) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
      res.end(JSON.stringify(_bwCache[cacheKey]));
      return;
    }
    (async () => {
      try {
        const BASE = `https://app.birdweather.com/api/v1/stations/${BW_STATION_ID}`;
        const url = endpoint === 'stats'
          ? `${BASE}/stats?period=${period}`
          : endpoint === 'species'
          ? `${BASE}/species?period=${period}&limit=${limit}&locale=${locale}`
          : `${BASE}/detections?limit=${limit}&locale=${locale}`;
        const data = await fetchJson(url);
        if (!data) { res.writeHead(502); res.end(JSON.stringify({ error: 'birdweather_unreachable' })); return; }
        // Injecter l'ID de station dans la réponse stats pour que le client l'affiche
        if (endpoint === 'stats') data.stationId = BW_STATION_ID;
        if (!_bwCache) _bwCache = {};
        data._ts = Date.now();
        _bwCache[cacheKey] = data;
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS' });
        res.end(JSON.stringify(data));
      } catch(e) {
        console.error('[BirdWeather]', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: 'birdweather_error' }));
      }
    })();
    return;
  }

  // ── Route : GET /api/ebird-notable ─────────────────────────────────────────
  // Proxy l'API eBird notable observations pour la Belgique (BE)
  // Paramètres optionnels: ?days=7&maxResults=20
  // Nécessite EBIRD_API_KEY configuré dans l'environnement
  if (req.method === 'GET' && pathname === '/api/ebird-notable') {
    if (!EBIRD_API_KEY) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_key', message: 'EBIRD_API_KEY non configuré. Obtenir une clé gratuite sur https://ebird.org/api/keygen' }));
      return;
    }

    // Servir depuis le cache mémoire si TTL valide
    if (_ebirdCache && (Date.now() - _ebirdCacheTs) < EBIRD_TTL) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
      res.end(JSON.stringify(_ebirdCache));
      return;
    }

    (async () => {
      try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const days       = Math.min(30, parseInt(params.get('days') || '7'));
        const maxResults = Math.min(50, parseInt(params.get('maxResults') || '20'));
        const url = `https://api.ebird.org/v2/data/obs/${EBIRD_REGION}/recent/notable?detail=simple&back=${days}&maxResults=${maxResults}`;

        const data = await fetchJson(url, { 'X-eBirdApiToken': EBIRD_API_KEY });
        if (!data) {
          res.writeHead(502); res.end(JSON.stringify({ error: 'ebird_unreachable' }));
          return;
        }

        // Normaliser les données
        const result = (Array.isArray(data) ? data : []).map(obs => ({
          comName:   obs.comName,
          sciName:   obs.sciName,
          locName:   obs.locName,
          lat:       obs.lat,
          lng:       obs.lng,
          obsDt:     obs.obsDt,
          howMany:   obs.howMany || 1,
          subId:     obs.subId,
          obsUrl:    `https://ebird.org/checklist/${obs.subId}`,
        }));

        _ebirdCache   = { obs: result, fetchedAt: new Date().toISOString() };
        _ebirdCacheTs = Date.now();

        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS' });
        res.end(JSON.stringify(_ebirdCache));
      } catch(e) {
        console.error('[eBird]', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: 'ebird_error' }));
      }
    })();
    return;
  }

  // ── Route : GET /api/weather?days=30 ─────────────────────────────────────
  // Proxy Open-Meteo free API — daily weather data for the station location
  // Cached for 1 hour (WEATHER_TTL)
  if (req.method === 'GET' && pathname === '/api/weather') {
    (async () => {
      try {
        const params = new URL(req.url, 'http://localhost').searchParams;
        const days = Math.min(90, Math.max(1, parseInt(params.get('days') || '30')));

        // Serve from cache if valid
        if (_weatherCache && _weatherCache._days === days && (Date.now() - _weatherCacheTs) < WEATHER_TTL) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
          const { _days: _, ...cached } = _weatherCache;
          res.end(JSON.stringify(cached));
          return;
        }

        // Read lat/lon from birdnet.conf
        const conf = await parseBirdnetConf();
        const lat = conf.LATITUDE  || conf.LAT || '50.85';
        const lon = conf.LONGITUDE || conf.LON || '4.35';

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max&past_days=${days}&forecast_days=2&timezone=auto`;

        const data = await new Promise((resolve, reject) => {
          https.get(url, (resp) => {
            let body = '';
            resp.on('data', chunk => { body += chunk; });
            resp.on('end', () => {
              try { resolve(JSON.parse(body)); }
              catch(e) { reject(new Error('Invalid JSON from Open-Meteo')); }
            });
            resp.on('error', reject);
          }).on('error', reject);
        });

        if (data.error) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'open_meteo_error', detail: data.reason || data.error }));
          return;
        }

        const result = {
          daily: data.daily || {},
          daily_units: data.daily_units || {},
          latitude: data.latitude,
          longitude: data.longitude,
          timezone: data.timezone,
          fetchedAt: new Date().toISOString(),
          _days: days,
        };

        _weatherCache = result;
        _weatherCacheTs = Date.now();

        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS' });
        const { _days, ...responseData } = result;
        res.end(JSON.stringify(responseData));
      } catch(e) {
        console.error('[weather]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'weather_error', message: e.message }));
      }
    })();
    return;
  }
  // ── Audio routes (delegated to routes/audio.js) ──
  if (_audioRoutes.handle(req, res, pathname, _routeCtx)) return;

  // ── Route : GET /api/settings ───────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/settings') {
    (async () => {
      try {
        const conf = await parseBirdnetConf();
        // Redact sensitive fields
        delete conf.CADDY_PWD;
        delete conf.ICE_PWD;
        delete conf.FLICKR_API_KEY;
        delete conf.BIRDWEATHER_ID;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(conf));
      } catch(e) {
        console.error('[settings]', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Route : POST /api/settings ──────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/settings') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      (async () => {
        try {
          const { updates } = JSON.parse(body);
          if (!updates || typeof updates !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'updates object required' }));
            return;
          }
          // Validate each key
          const validated = {};
          const errors = [];
          for (const [key, val] of Object.entries(updates)) {
            // Skip keys without a validator (pass-through from conf, not editable)
            if (!SETTINGS_VALIDATORS[key]) { if (key !== '__v_skip' && !key.startsWith('_')) console.warn('[settings] Unknown key ignored:', key); continue; }
            if (!SETTINGS_VALIDATORS[key](val)) {
              errors.push(`Invalid value for ${key}: ${val}`);
              continue;
            }
            validated[key] = val;
          }
          if (errors.length > 0 && Object.keys(validated).length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errors.join('; ') }));
            return;
          }
          await writeBirdnetConf(validated);
          console.log(`[settings] Updated: ${Object.keys(validated).join(', ')}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, updated: Object.keys(validated), warnings: errors.length ? errors : undefined }));
        } catch(e) {
          console.error('[settings]', e.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return;
  }

  // ── Route : GET /api/apprise ────────────────────────────────────────────────
  // Returns the content of apprise.txt (notification service URLs)
  if (req.method === 'GET' && pathname === '/api/apprise') {
    (async () => {
      const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
      try {
        const content = await fsp.readFile(appriseFile, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ urls: content.trim() }));
      } catch(e) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ urls: '' }));
      }
    })();
    return;
  }

  // ── Route : POST /api/apprise ─────────────────────────────────────────────
  // Saves apprise notification URLs to apprise.txt
  if (req.method === 'POST' && pathname === '/api/apprise') {
    if (!requireAuth(req, res)) return;
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { urls } = JSON.parse(body);
        if (typeof urls !== 'string') throw new Error('urls must be a string');
        const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
        await fsp.writeFile(appriseFile, urls.trim() + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch(e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Route : POST /api/apprise/test ────────────────────────────────────────
  // Sends a test notification via Apprise
  if (req.method === 'POST' && pathname === '/api/apprise/test') {
    (async () => {
      try {
        const appriseFile = path.join(process.env.HOME, 'birdash', 'config', 'apprise.txt');
        const _ap = [
          path.join(process.env.HOME, 'birdengine', 'venv', 'bin', 'apprise'),
          path.join(process.env.HOME, 'birdash', 'engine', 'venv', 'bin', 'apprise'),
        ];
        const appriseBin = _ap.find(p => fs.existsSync(p)) || _ap[0];
        const { execFile } = require('child_process');
        const testI18n = {
          fr: { title: 'BIRDASH — Test', body: 'Ceci est une notification de test. Si vous voyez ce message, les notifications fonctionnent !' },
          en: { title: 'BIRDASH — Test', body: 'This is a test notification. If you see this, notifications are working!' },
          de: { title: 'BIRDASH — Test', body: 'Dies ist eine Testbenachrichtigung. Wenn Sie diese Nachricht sehen, funktionieren die Benachrichtigungen!' },
          nl: { title: 'BIRDASH — Test', body: 'Dit is een testmelding. Als u dit bericht ziet, werken de meldingen!' },
        };
        let _testLang = 'en';
        try { const m = fs.readFileSync(BIRDNET_CONF, 'utf8').match(/^DATABASE_LANG=(.+)/m); if (m) _testLang = m[1].replace(/"/g, '').trim().slice(0, 2); } catch {}
        const tt = testI18n[_testLang] || testI18n.en;
        const result = await new Promise((resolve, reject) => {
          execFile(appriseBin, [
            '-vv',
            '-t', tt.title,
            '-b', tt.body,
            '--config=' + appriseFile
          ], { timeout: 15000 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout + stderr);
          });
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, output: result }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    })();
    return;
  }

  // ── Route : GET /api/alert-thresholds ───────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/alert-thresholds') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getAlertThresholds()));
    return;
  }

  // ── Route : GET /api/alert-status ─────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/alert-status') {
    const status = {};
    for (const [type, ts] of Object.entries(_alertLastSent)) {
      status[type] = { lastSent: new Date(ts).toISOString(), cooldownRemaining: Math.max(0, ALERT_COOLDOWN - (Date.now() - ts)) };
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ alerts: status, interval: ALERT_CHECK_INTERVAL, cooldown: ALERT_COOLDOWN }));
    return;
  }

  // ── Route : GET /api/logs (SSE live stream) ────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/logs') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':\n\n'); // SSE comment to establish connection

    const { spawn } = require('child_process');
    const journal = spawn('journalctl', [
      '-u', 'birdengine', '-u', 'birdash', '-u', 'birdengine-recording',
      '-f', '--no-pager', '-o', 'json', '--since', 'now',
    ]);

    journal.stdout.on('data', (chunk) => {
      const lines = chunk.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        try {
          const j = JSON.parse(line);
          const msg = j.MESSAGE || '';
          if (!msg) continue;
          const unit = (j._SYSTEMD_UNIT || '').replace('.service', '');
          const ts = j.__REALTIME_TIMESTAMP
            ? new Date(parseInt(j.__REALTIME_TIMESTAMP) / 1000).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '';
          // Categorize
          let cat = 'system';
          if (/BirdWeather|uploaded/i.test(msg)) cat = 'birdweather';
          else if (/detection|detect|inference|\d+\.\d+s$/i.test(msg)) cat = 'detection';
          else if (/error|fail|exception|traceback/i.test(msg)) cat = 'error';
          else if (/GET |POST |DELETE /i.test(msg)) cat = 'api';
          else if (/purge|cleanup|removed/i.test(msg)) cat = 'cleanup';
          else if (/recording|arecord|wav/i.test(msg)) cat = 'recording';

          const data = JSON.stringify({ ts, unit, cat, msg });
          res.write(`data: ${data}\n\n`);
        } catch(e) {}
      }
    });

    journal.stderr.on('data', () => {});
    journal.on('close', () => { try { res.end(); } catch(e) {} });
    req.on('close', () => { try { journal.kill(); } catch(e) {} });
    return;
  }

  // ── System routes (delegated to routes/system.js) ──
  if (_systemRoutes.handle(req, res, pathname, _routeCtx)) return;

  // ── Whats-new route (delegated to routes/whats-new.js) ──
  if (_whatsNewRoutes.handle(req, res, pathname, _routeCtx)) return;

  // ── Timeline route (delegated to routes/timeline.js) ──────────────────────
  if (_timelineRoutes.handle(req, res, pathname, _routeCtx)) return;


  // ── Data routes (delegated to routes/data.js) ──
  if (_dataRoutes.handle(req, res, pathname, _routeCtx)) return;

  // ── Backup routes (delegated to routes/backup.js) ──
  if (_backupRoutes.handle(req, res, pathname, _routeCtx)) return;

  // ── Detection routes (delegated to routes/detections.js) ──
  if (_detectionRoutes.handle(req, res, pathname, _routeCtx)) return;


  // ── Route : GET /api/audio/devices ──────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api/audio/devices') {
    (async () => {
      try {
        const { stdout } = await new Promise((resolve, reject) => {
          require('child_process').exec('arecord -l 2>/dev/null', (err, stdout, stderr) => {
            resolve({ stdout: stdout || '', stderr });
          });
        });
        const devices = [];
        const lines = stdout.split('\n');
        for (const line of lines) {
          const m = line.match(/^card (\d+): (\w+) \[(.+?)\], device (\d+): (.+)/);
          if (m) {
            const id = `hw:${m[1]},${m[3 + 1]}`;
            const name = m[3];
            const isUsb = /usb|rode|ai.?micro|scarlett|behringer|zoom|tascam|presonus/i.test(name);
            // Get details via arecord --dump-hw-params
            let channels = 2, rates = [];
            try {
              const { stdout: info } = await new Promise((resolve, reject) => {
                require('child_process').exec(
                  `arecord -D ${id} --dump-hw-params -d 0 2>&1 || true`,
                  { timeout: 3000 },
                  (err, stdout) => resolve({ stdout: stdout || '' })
                );
              });
              const chMatch = info.match(/CHANNELS\s*:.*?(\d+)/s);
              if (chMatch) channels = parseInt(chMatch[1]);
              const rateMatch = info.match(/RATE\s*:\s*(\d+)/);
              if (rateMatch) rates.push(parseInt(rateMatch[1]));
            } catch {}
            const cardName = m[2]; // ALSA card name (e.g. AIMicro)
            const dsnoop_id = `dsnoop:CARD=${cardName},DEV=${m[4]}`;
            devices.push({
              id: dsnoop_id, // Use dsnoop for shared access
              hw_id: id,     // Direct hw access (exclusive)
              name,
              alsa_card: parseInt(m[1]),
              alsa_device: parseInt(m[4]),
              channels,
              sample_rates: rates.length ? rates : [48000],
              usb_audio: isUsb,
            });
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ devices }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }


  console.warn(`[BIRDASH] 404 — route inconnue : ${req.method} ${pathname}`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Route inconnue : ${req.method} ${pathname}` }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[BIRDASH] API démarrée sur http://127.0.0.1:${PORT}`);
});

function gracefulShutdown() {
  _alerts.stopAlerts();
  if (_rateBucketCleanup) clearInterval(_rateBucketCleanup);
  _backupRoutes.shutdown();
  _audioRoutes.shutdown();
  try { db.close(); } catch{} try { dbWrite.close(); } catch{}
  try { if (taxonomyDb) taxonomyDb.close(); } catch{} try { if (birdashDb) birdashDb.close(); } catch{}
  process.exit(0);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT',  gracefulShutdown);
