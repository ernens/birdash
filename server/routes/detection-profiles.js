'use strict';
/**
 * Detection profiles — named bundles of the 9 detection-tuning settings.
 *
 * Storage: config/detection-profiles.json. Seeded with 3 builtins
 * (permissif / balance / rigoureux). Custom profiles live in the same
 * file. Loading a profile only fills the form in the UI — the user
 * still has to click Save to persist into birdnet.conf, mirroring the
 * existing resetDefaults() pattern.
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const safeConfig = require('../lib/safe-config');

const PROFILES_FILE = path.join(__dirname, '..', '..', 'config', 'detection-profiles.json');

const PROFILE_KEYS = [
  'BIRDNET_CONFIDENCE',
  'PERCH_CONFIDENCE',
  'PERCH_MIN_MARGIN',
  'DUAL_CONFIRM_ENABLED',
  'PERCH_STANDALONE_CONFIDENCE',
  'BIRDNET_ECHO_CONFIDENCE',
  'SENSITIVITY',
  'OVERLAP',
  'SF_THRESH',
];

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

async function readStore() {
  try {
    const raw = await fsp.readFile(PROFILES_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.profiles) {
      return { active: null, profiles: {} };
    }
    return data;
  } catch (e) {
    if (e.code === 'ENOENT') return { active: null, profiles: {} };
    throw e;
  }
}

async function writeStore(data) {
  await safeConfig.writeRaw(PROFILES_FILE, JSON.stringify(data, null, 2) + '\n', { label: 'detection-profiles' });
}

function handle(req, res, pathname, ctx) {
  const { requireAuth, SETTINGS_VALIDATORS } = ctx;

  if (req.method === 'GET' && pathname === '/api/detection-profiles') {
    (async () => {
      try {
        const store = await readStore();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(store));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  // Save / overwrite a profile. Body: { id, label, values }
  if (req.method === 'POST' && pathname === '/api/detection-profiles') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      (async () => {
        try {
          const { id, label, values } = JSON.parse(body || '{}');
          if (!id || !ID_RE.test(id)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid id (lowercase, digits, _ or -, max 32)' }));
            return;
          }
          if (!label || typeof label !== 'string' || label.length > 60) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'label required (max 60 chars)' }));
            return;
          }
          if (!values || typeof values !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'values object required' }));
            return;
          }
          const validated = {};
          const errors = [];
          for (const k of PROFILE_KEYS) {
            if (!(k in values)) continue;
            const v = values[k];
            if (!SETTINGS_VALIDATORS[k] || !SETTINGS_VALIDATORS[k](v)) {
              errors.push(`Invalid value for ${k}: ${v}`);
              continue;
            }
            validated[k] = typeof v === 'number' ? v : (isNaN(Number(v)) ? v : Number(v));
          }
          if (errors.length) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errors.join('; ') }));
            return;
          }
          const store = await readStore();
          const existing = store.profiles[id];
          if (existing && existing.builtin) {
            res.writeHead(409, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'cannot overwrite a built-in profile' }));
            return;
          }
          store.profiles[id] = { label, builtin: false, values: validated };
          await writeStore(store);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, id, profile: store.profiles[id] }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return true;
  }

  // Mark a profile as active (informational only — the form must still
  // be saved separately to write birdnet.conf). Body: { id }
  if (req.method === 'POST' && pathname === '/api/detection-profiles/apply') {
    if (!requireAuth(req, res)) return true;
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      (async () => {
        try {
          const { id } = JSON.parse(body || '{}');
          const store = await readStore();
          if (!store.profiles[id]) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'profile not found' }));
            return;
          }
          store.active = id;
          await writeStore(store);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, active: id, values: store.profiles[id].values }));
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      })();
    });
    return true;
  }

  // DELETE /api/detection-profiles/:id
  const m = pathname.match(/^\/api\/detection-profiles\/([a-z0-9_-]+)$/);
  if (req.method === 'DELETE' && m) {
    if (!requireAuth(req, res)) return true;
    (async () => {
      try {
        const id = m[1];
        const store = await readStore();
        const p = store.profiles[id];
        if (!p) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'profile not found' }));
          return;
        }
        if (p.builtin) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'cannot delete a built-in profile' }));
          return;
        }
        delete store.profiles[id];
        if (store.active === id) store.active = null;
        await writeStore(store);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, deleted: id }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return true;
  }

  return false;
}

module.exports = { handle, PROFILE_KEYS };
