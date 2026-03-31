/**
 * BIRDASH — Backend tests
 * Run: npm test
 * Requires: Node 20+ (native test runner)
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 17474;
let serverProc = null;

// ── Server start/stop ─────────────────────────────────────────────────────

before(async () => {
  serverProc = spawn('node', [path.join(__dirname, '..', 'server', 'server.js')], {
    env: { ...process.env, BIRDASH_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 8000);
    let stderr = '';
    serverProc.stderr.on('data', c => { stderr += c; });
    serverProc.stdout.on('data', (data) => {
      if (data.toString().includes('API')) { clearTimeout(timeout); resolve(); }
    });
    serverProc.on('error', (err) => { clearTimeout(timeout); reject(err); });
    serverProc.on('exit', (code) => {
      if (code !== null && code !== 0) { clearTimeout(timeout); reject(new Error(`Exit ${code}: ${stderr}`)); }
    });
  });
});

after(() => { if (serverProc) serverProc.kill('SIGTERM'); });

// ── Helpers ───────────────────────────────────────────────────────────────

function request(reqPath, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '127.0.0.1', port: PORT, path: reqPath, method,
      headers: { 'Content-Type': 'application/json', ...headers } };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, data, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// ══════════════════════════════════════════════════════════════════════════
// EXISTING TESTS
// ══════════════════════════════════════════════════════════════════════════

describe('API Health', () => {
  it('GET /api/health returns status ok', async () => {
    const res = await request('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'ok');
    assert.equal(typeof res.json.total_detections, 'number');
  });
});

describe('Security headers', () => {
  it('includes X-Content-Type-Options, X-Frame-Options, Referrer-Policy', async () => {
    const res = await request('/api/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  });

  it('CSP not set on API routes', async () => {
    const res = await request('/api/health');
    assert.equal(res.headers['content-security-policy'], undefined);
  });

  it('CORS not allowed without origin', async () => {
    const res = await request('/api/health');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
});

describe('POST /api/query — SQL validation', () => {
  it('SELECT works', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT COUNT(*) as n FROM detections', params: [] } });
    assert.equal(res.status, 200);
    assert.ok(res.json.columns.includes('n'));
  });

  it('PRAGMA allowed', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'PRAGMA table_info(detections)', params: [] } });
    assert.equal(res.status, 200);
  });

  it('WITH (CTE) allowed', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'WITH t AS (SELECT 1 as v) SELECT * FROM t', params: [] } });
    assert.equal(res.status, 200);
  });

  it('rejects DELETE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'DELETE FROM detections', params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects DROP TABLE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'DROP TABLE detections', params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects INSERT', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: "INSERT INTO detections VALUES ('x','x','x',0,'x')", params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects UPDATE', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: "UPDATE detections SET Com_Name='x'", params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects semicolons (multi-query)', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT 1; DROP TABLE detections', params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects queries > 4000 chars', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT ' + 'x'.repeat(4000), params: [] } });
    assert.equal(res.status, 400);
  });

  it('rejects empty body', async () => {
    const res = await request('/api/query', { method: 'POST', body: {} });
    assert.equal(res.status, 400);
  });

  it('does not leak SQL error details', async () => {
    const res = await request('/api/query', { method: 'POST',
      body: { sql: 'SELECT * FROM nonexistent_table', params: [] } });
    assert.equal(res.status, 500);
    assert.ok(!res.data.includes('nonexistent_table'));
  });
});

describe('GET /api/photo — Validation', () => {
  it('rejects without sci param', async () => {
    const res = await request('/api/photo');
    assert.equal(res.status, 400);
  });

  it('rejects XSS in sci param', async () => {
    const res = await request('/api/photo?sci=Pica%3Cscript%3E');
    assert.equal(res.status, 400);
  });
});

describe('Unknown routes', () => {
  it('returns 404', async () => {
    const res = await request('/api/unknown');
    assert.equal(res.status, 404);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Audio config validation
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/audio/config', () => {
  it('returns audio configuration', async () => {
    const res = await request('/api/audio/config');
    assert.equal(res.status, 200);
    assert.ok(res.json.hasOwnProperty('device_id'));
    assert.ok(res.json.hasOwnProperty('profile_name'));
  });
});

describe('POST /api/audio/config — Validation', () => {
  it('accepts valid audio config keys', async () => {
    const res = await request('/api/audio/config', { method: 'POST',
      body: { highpass_cutoff_hz: 100, rms_normalize: true } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
  });

  it('rejects unknown keys silently (filters them out)', async () => {
    const res = await request('/api/audio/config', { method: 'POST',
      body: { evil_key: 'malicious', __proto__: 'hack' } });
    assert.equal(res.status, 400);
    assert.ok(res.json.error.includes('No valid'));
  });

  it('rejects empty update', async () => {
    const res = await request('/api/audio/config', { method: 'POST', body: {} });
    assert.equal(res.status, 400);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Audio profiles
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/audio/profiles', () => {
  it('returns profiles with builtin entries', async () => {
    const res = await request('/api/audio/profiles');
    assert.equal(res.status, 200);
    assert.ok(res.json.profiles.jardin);
    assert.ok(res.json.profiles.jardin.builtin);
  });
});

describe('POST /api/audio/profiles — Validation', () => {
  it('rejects without profile_name', async () => {
    const res = await request('/api/audio/profiles', { method: 'POST',
      body: { highpass_cutoff_hz: 100 } });
    assert.equal(res.status, 400);
  });

  it('rejects overwriting builtin profile', async () => {
    const res = await request('/api/audio/profiles', { method: 'POST',
      body: { profile_name: 'jardin', highpass_cutoff_hz: 200 } });
    assert.equal(res.status, 400);
    assert.ok(res.json.error.includes('builtin'));
  });

  it('creates custom profile with whitelisted fields only', async () => {
    const res = await request('/api/audio/profiles', { method: 'POST',
      body: { profile_name: '_test_profile', highpass_cutoff_hz: 120, evil_field: 'bad' } });
    assert.equal(res.status, 200);
    // Verify evil_field not persisted
    const check = await request('/api/audio/profiles');
    assert.ok(check.json.profiles._test_profile);
    assert.equal(check.json.profiles._test_profile.evil_field, undefined);
    // Cleanup
    await request('/api/audio/profiles/_test_profile', { method: 'DELETE' });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Detection rules
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/detection-rules', () => {
  it('returns detection rules', async () => {
    const res = await request('/api/detection-rules');
    assert.equal(res.status, 200);
    assert.ok(res.json.hasOwnProperty('auto_flag'));
    assert.ok(res.json.hasOwnProperty('rules'));
  });
});

describe('GET /api/flagged-detections', () => {
  it('returns flagged detections for a date', async () => {
    const today = new Date().toISOString().split('T')[0];
    const res = await request(`/api/flagged-detections?dateFrom=${today}&dateTo=${today}`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.flagged));
    assert.equal(typeof res.json.total, 'number');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Bulk validation
// ══════════════════════════════════════════════════════════════════════════

describe('POST /api/bulk-validate', () => {
  it('rejects without detections array', async () => {
    const res = await request('/api/bulk-validate', { method: 'POST',
      body: { status: 'confirmed' } });
    assert.equal(res.status, 400);
  });

  it('rejects invalid status', async () => {
    const res = await request('/api/bulk-validate', { method: 'POST',
      body: { detections: [{ date: '2026-01-01', time: '12:00:00', sci_name: 'Test' }], status: 'evil' } });
    assert.equal(res.status, 400);
  });

  it('accepts valid bulk validation', async () => {
    const res = await request('/api/bulk-validate', { method: 'POST',
      body: { detections: [{ date: '2026-01-01', time: '00:00:00', sci_name: 'Test test' }], status: 'rejected' } });
    assert.equal(res.status, 200);
    assert.ok(res.json.ok);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Model comparison
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/model-comparison', () => {
  it('returns model comparison data', async () => {
    const res = await request('/api/model-comparison?days=7');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.models));
    assert.ok(res.json.stats);
    assert.ok(res.json.unique);
    assert.ok(Array.isArray(res.json.daily));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Analysis status
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/analysis-status', () => {
  it('returns analysis status with model info', async () => {
    const res = await request('/api/analysis-status');
    assert.equal(res.status, 200);
    assert.ok(res.json.model);
    assert.equal(typeof res.json.backlog, 'number');
    assert.equal(typeof res.json.lagSecs, 'number');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Settings validation
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/settings', () => {
  it('returns settings from birdnet.conf', async () => {
    const res = await request('/api/settings');
    assert.equal(res.status, 200);
    assert.ok(res.json.MODEL || res.json.model);
  });
});

describe('POST /api/settings — Validation', () => {
  it('rejects without updates object', async () => {
    const res = await request('/api/settings', { method: 'POST', body: { bad: 1 } });
    assert.equal(res.status, 400);
  });

  it('rejects unknown setting keys', async () => {
    const res = await request('/api/settings', { method: 'POST',
      body: { updates: { EVIL_KEY: 'hack' } } });
    assert.equal(res.status, 200);
    // Unknown keys should be silently ignored (not persisted)
    const check = await request('/api/settings');
    assert.equal(check.json.EVIL_KEY, undefined);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Services
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/services', () => {
  it('returns list of services', async () => {
    const res = await request('/api/services');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.services));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Validation stats
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/validation-stats', () => {
  it('returns validation counts', async () => {
    const res = await request('/api/validation-stats');
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.confirmed, 'number');
    assert.equal(typeof res.json.rejected, 'number');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Models list
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/models', () => {
  it('returns available models', async () => {
    const res = await request('/api/models');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.models));
  });
});

// ══════════════════════════════════════════════════════════════════════════
// NEW TESTS — Audio devices
// ══════════════════════════════════════════════════════════════════════════

describe('GET /api/audio/devices', () => {
  it('returns devices array', async () => {
    const res = await request('/api/audio/devices');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.devices));
  });
});
