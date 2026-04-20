'use strict';
/**
 * Authentication — single-user cookie sessions, opt-in.
 *
 * Three modes (set via AUTH_MODE in birdnet.conf):
 *
 *   off          (default) — LAN-trust, no auth, BIRDASH_API_TOKEN still
 *                works for write endpoints (back-compat).
 *
 *   protected    — every API call requires a valid session cookie OR
 *                Bearer token. Static files (login page assets) stay
 *                public; the front-end redirects to /login.html on 401.
 *
 *   public-read  — GET endpoints are public except a small sensitive
 *                allowlist (settings, logs). All POST/DELETE require auth.
 *                This is the "show your station to friends" mode.
 *
 * Why HMAC-signed cookies instead of a sessions table:
 *   - one user, no multi-device session management to do
 *   - no DB migration, no cleanup cron
 *   - revocation is simple — rotate AUTH_SECRET and every cookie dies
 *
 * Cookie format: base64url(JSON({user, exp})) "." base64url(HMAC-SHA256)
 *
 * The gate must be SYNCHRONOUS — putting an `await` between request
 * arrival and route dispatch loses POST body chunks (the top-level
 * body-size listener consumes them before the route handler attaches
 * its own data listener). So we maintain an in-memory cache of the
 * auth config that's refreshed on startup and after every settings POST.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const COOKIE_NAME = 'birdash_session';
const DEFAULT_SESSION_HOURS = 168; // 7 days

// In-memory rate limiter for /api/auth/login (5 attempts / 60s / IP)
const _loginAttempts = new Map();
const LOGIN_WINDOW_MS = 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

let _writeBirdnetConf = null;
let _parseBirdnetConf = null;

// ── Sensitive GET endpoints that stay gated even in public-read mode ──
// Anything that exposes credentials, tokens, system internals or the
// in-app terminal goes here. Audio playback, photos, detection lists,
// timeline, weather etc. stay public — that's the whole point.
const SENSITIVE_GET = new Set([
  '/api/settings',
  '/api/apprise',
  '/api/alert-thresholds',
  '/api/alert-status',
  '/api/logs',
  '/api/system/logs-export',
  '/api/backup',
  '/api/backup-progress',
  '/api/backup-history',
  '/api/backup-status',
  '/api/audio/devices',
  '/api/audio/profiles',
]);

// Auth endpoints that bypass the gate (login is allowed for unauthenticated
// users; status returns the public state).
const ALWAYS_PUBLIC = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/status',
  '/api/auth/set-password', // gated explicitly inside the route handler
]);

// ── Cached config (refreshed on startup + after settings writes) ──────────
let _cachedConfig = { mode: 'off', username: '', passwordHash: '', secret: '', sessionHours: DEFAULT_SESSION_HOURS };
let _cachedReady = false;

async function refreshConfig() {
  try {
    const conf = await _parseBirdnetConf();
    _cachedConfig = {
      mode:         conf.AUTH_MODE || 'off',
      username:     conf.AUTH_USERNAME || '',
      passwordHash: conf.AUTH_PASSWORD_HASH || '',
      secret:       conf.AUTH_SECRET || '',
      sessionHours: parseInt(conf.AUTH_SESSION_HOURS || String(DEFAULT_SESSION_HOURS), 10) || DEFAULT_SESSION_HOURS,
    };
    _cachedReady = true;
  } catch (e) {
    console.warn('[auth] refreshConfig:', e.message);
  }
}

function getConfig() { return { ..._cachedConfig }; }

/** Returns the secret, generating + persisting one on first use. */
async function ensureSecret() {
  if (_cachedConfig.secret && /^[a-f0-9]{32,128}$/.test(_cachedConfig.secret)) return _cachedConfig.secret;
  const fresh = crypto.randomBytes(32).toString('hex');
  try {
    await _writeBirdnetConf({ AUTH_SECRET: fresh });
    _cachedConfig.secret = fresh;
  } catch (e) { console.warn('[auth] Could not persist AUTH_SECRET:', e.message); }
  return fresh;
}

async function init({ parseBirdnetConf, writeBirdnetConf }) {
  _parseBirdnetConf = parseBirdnetConf;
  _writeBirdnetConf = writeBirdnetConf;
  await refreshConfig();
  // Generate a secret eagerly so the first login doesn't have to write
  // birdnet.conf under load.
  if (!_cachedConfig.secret) await ensureSecret();
}

// ── Password hashing ──────────────────────────────────────────────────────

async function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  if (plain.length > 200) throw new Error('Password too long');
  return bcrypt.hash(plain, 10);
}

async function verifyPassword(plain, hash) {
  if (!plain || !hash) return false;
  try { return await bcrypt.compare(plain, hash); }
  catch { return false; }
}

// ── Cookie session signing ────────────────────────────────────────────────

function _b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function _b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString();
}

function signSessionSync(user) {
  if (!_cachedConfig.secret) throw new Error('AUTH_SECRET not initialised — call init() first');
  const payload = JSON.stringify({
    user,
    exp: Date.now() + _cachedConfig.sessionHours * 3600 * 1000,
  });
  const data = _b64urlEncode(payload);
  const sig = _b64urlEncode(
    crypto.createHmac('sha256', _cachedConfig.secret).update(data).digest()
  );
  return `${data}.${sig}`;
}

function verifySessionSync(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  if (!_cachedConfig.secret) return null;
  const dot = cookieValue.indexOf('.');
  if (dot < 1) return null;
  const data = cookieValue.slice(0, dot);
  const sig  = cookieValue.slice(dot + 1);
  const expected = _b64urlEncode(
    crypto.createHmac('sha256', _cachedConfig.secret).update(data).digest()
  );
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(_b64urlDecode(data)); } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.user || !payload.exp) return null;
  if (Date.now() > payload.exp) return null;
  return payload;
}

// ── Cookie parsing & header construction ─────────────────────────────────

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function buildSessionCookie(user) {
  const value = signSessionSync(user);
  const maxAge = _cachedConfig.sessionHours * 3600;
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}

function buildLogoutCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

// ── Login attempt rate limiter ────────────────────────────────────────────

function _clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
         req.socket.remoteAddress || 'unknown';
}

function checkLoginRate(req) {
  const ip = _clientIp(req);
  const now = Date.now();
  const bucket = _loginAttempts.get(ip) || { count: 0, ts: now };
  if (now - bucket.ts > LOGIN_WINDOW_MS) { bucket.count = 0; bucket.ts = now; }
  bucket.count += 1;
  _loginAttempts.set(ip, bucket);
  if (_loginAttempts.size > 5000) {
    for (const [k, b] of _loginAttempts) {
      if (now - b.ts > LOGIN_WINDOW_MS * 5) _loginAttempts.delete(k);
    }
  }
  return bucket.count <= LOGIN_MAX_ATTEMPTS;
}

function resetLoginRate(req) {
  _loginAttempts.delete(_clientIp(req));
}

// ── Synchronous request gate ──────────────────────────────────────────────
// Called from server.js BEFORE route delegation. Attaches req.user when a
// valid session is present. Returns true if the request should proceed,
// false if it has been answered with 401.

function gate(req, res, pathname) {
  // Always parse cookie so req.user is available downstream
  const cookies = parseCookies(req);
  const raw = cookies[COOKIE_NAME];
  if (raw) {
    const session = verifySessionSync(raw);
    if (session) req.user = session.user;
  }
  // Bearer token (BIRDASH_API_TOKEN) — kept for cron / scripted automation
  // even when AUTH_MODE is on. Treated as a privileged "machine user".
  if (!req.user) {
    const apiToken = process.env.BIRDASH_API_TOKEN || '';
    const auth = req.headers['authorization'] || '';
    if (apiToken && auth === `Bearer ${apiToken}`) req.user = '__bearer__';
  }

  const mode = _cachedConfig.mode;
  if (mode === 'off') return true;
  if (ALWAYS_PUBLIC.has(pathname)) return true;
  if (!pathname.startsWith('/api/')) return true;

  const isWrite = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  const isSensitiveGet = !isWrite && SENSITIVE_GET.has(pathname);

  if (mode === 'public-read' && !isWrite && !isSensitiveGet) return true;
  if (req.user) return true;

  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'unauthenticated',
    code: 'AUTH_REQUIRED',
    mode,
  }));
  return false;
}

module.exports = {
  init,
  refreshConfig,
  getConfig,
  ensureSecret,
  hashPassword,
  verifyPassword,
  parseCookies,
  buildSessionCookie,
  buildLogoutCookie,
  checkLoginRate,
  resetLoginRate,
  gate,
  COOKIE_NAME,
};
