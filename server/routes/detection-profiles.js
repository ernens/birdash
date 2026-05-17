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

// Sectioned profile schema (1.55.38+). Each section is applied only when
// the current model topology matches:
//   shared  — always
//   birdnet — only when running in BirdNET-only mode
//   perch   — only when running in Perch-only mode
//   dual    — only when dual-model is enabled with BOTH BirdNET and Perch
//
// Keys may legitimately appear in more than one section (e.g.
// BIRDNET_CONFIDENCE in `birdnet` vs `dual`) because their intent
// differs by topology — a BirdNET-only profile typically wants a
// different threshold than a dual setup where Perch carries half the
// load.
const SECTION_KEYS = {
  shared:  ['SENSITIVITY', 'SF_THRESH'],
  birdnet: ['BIRDNET_CONFIDENCE', 'OVERLAP'],
  perch:   ['PERCH_CONFIDENCE', 'PERCH_MIN_MARGIN'],
  dual:    [
    'BIRDNET_CONFIDENCE', 'PERCH_CONFIDENCE', 'PERCH_MIN_MARGIN',
    'DUAL_CONFIRM_ENABLED', 'PERCH_STANDALONE_CONFIDENCE', 'BIRDNET_ECHO_CONFIDENCE',
  ],
};
const SECTION_NAMES = Object.keys(SECTION_KEYS);

// Flat-shape keys for the back-compat migration (everything that used
// to live at the top of `values` in pre-1.55.38 profiles).
const LEGACY_FLAT_KEYS = [
  'BIRDNET_CONFIDENCE', 'PERCH_CONFIDENCE', 'PERCH_MIN_MARGIN',
  'DUAL_CONFIRM_ENABLED', 'PERCH_STANDALONE_CONFIDENCE', 'BIRDNET_ECHO_CONFIDENCE',
  'SENSITIVITY', 'OVERLAP', 'SF_THRESH',
];

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

// Detect a pre-1.55.38 flat-shape profile so we can migrate on read.
// A sectioned shape has `shared`/`birdnet`/`perch`/`dual` objects at
// the top level; a flat shape has UPPERCASE keys with scalar values.
function isFlatShape(values) {
  if (!values || typeof values !== 'object') return false;
  return Object.keys(values).some(k => LEGACY_FLAT_KEYS.includes(k));
}

// Migrate flat → sectioned. Pre-1.55.38 profiles were applied as a
// monolithic blob regardless of model topology, but in practice they
// were always tuned for a dual setup with the cross-confirm settings
// populated. So:
//   - SENSITIVITY / SF_THRESH → shared
//   - OVERLAP → birdnet (Perch uses fixed chunks)
//   - everything else → dual
// We deliberately do NOT populate `birdnet.BIRDNET_CONFIDENCE` or
// `perch.PERCH_CONFIDENCE` — the user has to re-save the profile in
// single-model mode to capture those, since dual values typically
// don't transfer 1:1.
function migrateFlat(flat) {
  const out = { shared: {}, birdnet: {}, perch: {}, dual: {} };
  const sharedKeys = new Set(SECTION_KEYS.shared);
  for (const [k, v] of Object.entries(flat)) {
    if (sharedKeys.has(k)) out.shared[k] = v;
    else if (k === 'OVERLAP') out.birdnet[k] = v;
    else if (LEGACY_FLAT_KEYS.includes(k)) out.dual[k] = v;
  }
  return out;
}

async function readStore() {
  try {
    const raw = await fsp.readFile(PROFILES_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.profiles) {
      return { active: null, profiles: {} };
    }
    // Migrate legacy flat-shape profiles in memory on every read so the
    // client always sees the sectioned shape. The migration only writes
    // back to disk on the next explicit save.
    for (const id of Object.keys(data.profiles)) {
      const p = data.profiles[id];
      if (p && p.values && isFlatShape(p.values)) {
        p.values = migrateFlat(p.values);
      }
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
          // Accept both shapes on write: flat (legacy clients during the
          // rolling upgrade) is auto-migrated to sectioned before validation
          // so older browsers can keep saving while we ship the new UI.
          const input = isFlatShape(values) ? migrateFlat(values) : values;
          const validated = { shared: {}, birdnet: {}, perch: {}, dual: {} };
          const errors = [];
          for (const section of SECTION_NAMES) {
            if (!(section in input)) continue;
            if (typeof input[section] !== 'object' || input[section] === null) {
              errors.push(`section ${section} must be an object`);
              continue;
            }
            const allowed = new Set(SECTION_KEYS[section]);
            for (const [k, v] of Object.entries(input[section])) {
              if (!allowed.has(k)) {
                errors.push(`${k} not allowed in section ${section}`);
                continue;
              }
              if (!SETTINGS_VALIDATORS[k] || !SETTINGS_VALIDATORS[k](v)) {
                errors.push(`Invalid value for ${section}.${k}: ${v}`);
                continue;
              }
              validated[section][k] = typeof v === 'number' ? v : (isNaN(Number(v)) ? v : Number(v));
            }
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

module.exports = { handle, SECTION_KEYS, isFlatShape, migrateFlat };
