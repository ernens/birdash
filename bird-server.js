#!/usr/bin/env node
/**
 * PIBIRD — Backend API
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
  console.error('[PIBIRD] better-sqlite3 non trouvé. Exécute : npm install better-sqlite3');
  process.exit(1);
}

const https = require('https');

// --- Configuration
const PORT      = process.env.PIBIRD_PORT || 7474;
const DB_PATH   = process.env.PIBIRD_DB   || path.join(
  process.env.HOME, 'BirdNET-Pi', 'scripts', 'birds.db'
);
const SONGS_DIR = process.env.PIBIRD_SONGS_DIR || path.join(
  process.env.HOME, 'BirdSongs', 'Extracted', 'By_Date'
);
const PHOTO_CACHE_DIR = path.join(process.env.HOME, 'pibird', 'photo-cache');
const AUDIO_RATE = 48000;

// Charger la config locale (pibird-local.js) si disponible
// — silencieux si le fichier n'existe pas (installation fraîche)
let _localConfig = {};
try {
  const fs_test = require('fs');
  const localPath = require('path').join(__dirname, 'pibird-local.js');
  if (fs_test.existsSync(localPath)) {
    _localConfig = require(localPath);
    console.log('[PIBIRD] Config locale chargée : pibird-local.js');
  }
} catch(e) {
  console.warn('[PIBIRD] pibird-local.js non chargé :', e.message);
}

// Clé API eBird — configurable via pibird-local.js (ebirdApiKey)
// ou variable d'environnement EBIRD_API_KEY
const EBIRD_API_KEY  = process.env.EBIRD_API_KEY  || _localConfig.ebirdApiKey        || '';
const EBIRD_REGION   = (_localConfig.location && _localConfig.location.region) || 'BE';
const BW_STATION_ID  = process.env.BW_STATION_ID  || _localConfig.birdweatherStationId || '';
// Cache BirdWeather (TTL 5 min — données live)
let _bwCache = null, _bwCacheTs = 0;
const BW_TTL = 5 * 60 * 1000;
let _ebirdCache = null;
let _ebirdCacheTs = 0;
const EBIRD_TTL = 3600 * 1000; // 1 heure

// Créer le répertoire cache photos si absent
if (!fs.existsSync(PHOTO_CACHE_DIR)) {
  fs.mkdirSync(PHOTO_CACHE_DIR, { recursive: true });
  console.log(`[PIBIRD] Dossier photo-cache créé : ${PHOTO_CACHE_DIR}`);
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
    lib.get(url, { headers: { 'User-Agent': 'PIBIRD/1.0' } }, (res) => {
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
    const headers = { 'User-Agent': 'PIBIRD/1.0', 'Accept': 'application/json', ...extraHeaders };
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

// ── Scan des MP3 récents ────────────────────────────────────────────────────
// Retourne la liste des MP3 des dernières 48h, triés par mtime croissant
async function getRecentMp3s() {
  const files  = [];
  const cutoff = Date.now() - 48 * 3600 * 1000;

  for (let daysAgo = 0; daysAgo <= 1; daysAgo++) {
    const d = new Date(Date.now() - daysAgo * 86400000);
    const dateStr = d.toISOString().split('T')[0];
    const dayDir  = path.join(SONGS_DIR, dateStr);
    let species;
    try { species = await fsp.readdir(dayDir); } catch(e) { continue; }

    for (const sp of species) {
      const spDir = path.join(dayDir, sp);
      let entries;
      try { entries = await fsp.readdir(spDir); } catch(e) { continue; }
      for (const f of entries) {
        if (!f.endsWith('.mp3')) continue;
        const fp = path.join(spDir, f);
        try {
          const { mtimeMs } = await fsp.stat(fp);
          if (mtimeMs >= cutoff) files.push({ path: fp, mtime: mtimeMs });
        } catch(e) {}
      }
    }
  }
  // Tri chronologique
  return files.sort((a, b) => a.mtime - b.mtime);
}

// Vérifie que la DB existe
if (!fs.existsSync(DB_PATH)) {
  console.error(`[PIBIRD] birds.db introuvable : ${DB_PATH}`);
  process.exit(1);
}

// Ouvre en lecture seule
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

console.log(`[PIBIRD] birds.db ouvert : ${DB_PATH}`);

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
const ALLOWED_ORIGINS = (process.env.PIBIRD_CORS_ORIGINS || '').split(',').filter(Boolean);

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
setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of _rateBuckets) {
    if (now - b.ts > RATE_WINDOW * 2) _rateBuckets.delete(ip);
  }
}, 5 * 60 * 1000);

function rateLimit(req) {
  const ip = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = _rateBuckets.get(ip);
  if (!bucket || now - bucket.ts > RATE_WINDOW) {
    bucket = { count: 0, ts: now };
    _rateBuckets.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count > RATE_MAX;
}

// --- Handler HTTP
const server = http.createServer((req, res) => {
  // Headers de sécurité
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // CORS — restrictif par défaut
  const allowedOrigin = getCorsOrigin(req);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

  // Extraire le pathname proprement (ignore query string éventuel)
  const pathname = req.url.split('?')[0].replace(/\/$/, '') || '/';
  console.log(`[PIBIRD] ${req.method} ${req.url} → pathname: ${pathname}`);

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

  // ── Route : GET /api/birdweather ─────────────────────────────────────────────
  // Proxy BirdWeather API — évite les CORS + cache 5 min
  // ?endpoint=stats|species|detections  ?period=day|week|month|all
  if (req.method === 'GET' && pathname === '/api/birdweather') {
    if (!BW_STATION_ID) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'no_station', message: 'birdweatherStationId non configuré dans pibird-local.js' }));
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
    if (_bwCache && _bwCache[cacheKey] && (Date.now() - _bwCacheTs) < BW_TTL) {
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
        _bwCache[cacheKey] = data;
        _bwCacheTs = Date.now();
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

  // ── Route : GET /api/audio-stream ────────────────────────────────────────
  // Décode les MP3 BirdNET récents en PCM S16LE et les chaîne en continu.
  // Zéro conflit avec BirdNET — on lit des fichiers, pas le micro.
  if (req.method === 'GET' && pathname === '/api/audio-stream') {

    res.setHeader('Content-Type',       'application/octet-stream');
    res.setHeader('X-Audio-Encoding',   'pcm_s16le');
    res.setHeader('X-Audio-SampleRate', String(AUDIO_RATE));
    res.setHeader('X-Audio-Channels',   '1');
    res.setHeader('Cache-Control',      'no-cache, no-store');
    res.setHeader('Transfer-Encoding',  'chunked');
    res.writeHead(200);

    let aborted  = false;
    let currentFf = null;
    req.on('close', () => {
      aborted = true;
      if (currentFf) try { currentFf.kill(); } catch(e) {}
    });

    // Boucle async : enchaîne les fichiers MP3 en PCM
    (async () => {
      const streamed = new Set();

      // Trouver le point de départ : commencer 3 minutes en arrière
      // pour avoir immédiatement du signal à l'affichage
      const startCutoff = Date.now() - 3 * 60 * 1000;

      // Marquer les fichiers trop anciens comme déjà "streamés"
      const allFiles = await getRecentMp3s();
      for (const f of allFiles) {
        if (f.mtime < startCutoff) streamed.add(f.path);
      }
      console.log(`[audio-stream] démarrage — ${streamed.size} fichiers anciens ignorés`);

      while (!aborted) {
        const pending = (await getRecentMp3s()).filter(f => !streamed.has(f.path));

        if (pending.length === 0) {
          // Aucun fichier nouveau — attendre 2s
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const file = pending[0];
        streamed.add(file.path);
        console.log(`[audio-stream] → ${path.basename(file.path)}`);

        // Décoder MP3 → PCM S16LE via ffmpeg
        await new Promise((resolve) => {
          const ff = spawn('ffmpeg', [
            '-loglevel', 'quiet',
            '-i', file.path,
            '-f', 's16le',
            '-ar', String(AUDIO_RATE),
            '-ac', '1',
            'pipe:1',
          ]);
          currentFf = ff;

          ff.stdout.pipe(res, { end: false });
          ff.stdout.on('end', () => { currentFf = null; resolve(); });
          ff.on('error', err => {
            console.error('[ffmpeg]', err.message);
            currentFf = null;
            resolve();
          });
          req.on('close', () => {
            try { ff.kill(); } catch(e) {}
            resolve();
          });
        });
      }

      if (!res.writableEnded) res.end();
      console.log('[audio-stream] connexion fermée');
    })();

    return;
  }

  // Route : POST /api/query
  if (req.method === 'POST' && pathname === '/api/query') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { sql, params = [] } = JSON.parse(body);

        if (!validateQuery(sql)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Requête non autorisée' }));
          return;
        }

        const stmt = db.prepare(sql);
        const rows = stmt.all(...params);

        // Extrait les noms de colonnes depuis la première ligne
        const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
        const data    = rows.map(r => columns.map(c => r[c]));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ columns, rows: data }));

      } catch (err) {
        console.error('[PIBIRD] Erreur SQL :', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Erreur interne lors de l\'exécution de la requête' }));
      }
    });
    return;
  }

  // Route : GET /api/health
  if (req.method === 'GET' && pathname === '/api/health') {
    try {
      const row = db.prepare("SELECT COUNT(*) as total FROM detections").get();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', total_detections: row.total }));
    } catch (err) {
      console.error('[health]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error' }));
    }
    return;
  }

  console.warn(`[PIBIRD] 404 — route inconnue : ${req.method} ${pathname}`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: `Route inconnue : ${req.method} ${pathname}` }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[PIBIRD] API démarrée sur http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT',  () => { db.close(); process.exit(0); });
