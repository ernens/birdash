#!/usr/bin/env node
/**
 * PIBIRD — Backend API
 * Expose birds.db (SQLite) via HTTP POST /api/query
 * Port 7474 — proxifié par Caddy sous /birds/api/
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');

// --- Dépendance : better-sqlite3 (npm install better-sqlite3)
let Database;
try {
  Database = require('better-sqlite3');
} catch (e) {
  console.error('[PIBIRD] better-sqlite3 non trouvé. Exécute : npm install better-sqlite3');
  process.exit(1);
}

// --- Configuration
const PORT    = process.env.PIBIRD_PORT || 7474;
const DB_PATH = process.env.PIBIRD_DB   || path.join(
  process.env.HOME, 'BirdNET-Pi', 'scripts', 'birds.db'
);

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
const FORBIDDEN     = /;\s*(DROP|DELETE|INSERT|UPDATE|CREATE|ALTER|ATTACH)/i;

function validateQuery(sql) {
  if (!sql || typeof sql !== 'string') return false;
  if (!ALLOWED_START.test(sql))        return false;
  if (FORBIDDEN.test(sql))             return false;
  if (sql.length > 8000)               return false;
  return true;
}

// --- Handler HTTP
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Route : POST /api/query
  if (req.method === 'POST' && req.url === '/api/query') {
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
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Route : GET /api/health
  if (req.method === 'GET' && req.url === '/api/health') {
    try {
      const row = db.prepare("SELECT COUNT(*) as total FROM detections").get();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', total_detections: row.total }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', message: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[PIBIRD] API démarrée sur http://127.0.0.1:${PORT}`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT',  () => { db.close(); process.exit(0); });
