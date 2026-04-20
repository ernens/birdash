'use strict';
/**
 * Auth routes — login / logout / status.
 *
 * Cookie sessions are HMAC-signed (see lib/auth.js). We never store
 * passwords in plaintext anywhere; bcrypt hashes live in birdnet.conf
 * under AUTH_PASSWORD_HASH.
 */

const _auth = require('../lib/auth');

function _readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 8192) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function handle(req, res, pathname, ctx) {
  // ── GET /api/auth/status ────────────────────────────────────────────────
  // Always public — front-end probes this on every page load to decide
  // whether to show the login button, the username, or "anonymous".
  if (req.method === 'GET' && pathname === '/api/auth/status') {
    const conf = _auth.getConfig();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mode: conf.mode,
      configured: !!conf.passwordHash && !!conf.username,
      authenticated: !!req.user,
      user: req.user || null,
      canWrite: req.user != null || conf.mode === 'off',
    }));
    return true;
  }

  // ── POST /api/auth/login ────────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/auth/login') {
    (async () => {
      if (!_auth.checkLoginRate(req)) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
        res.end(JSON.stringify({ error: 'too_many_attempts', retryAfterSeconds: 60 }));
        return;
      }
      let payload;
      try {
        const body = await _readBody(req);
        payload = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_body' }));
        return;
      }
      const { username, password } = payload;
      if (typeof username !== 'string' || typeof password !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'username_password_required' }));
        return;
      }
      const conf = _auth.getConfig();
      if (!conf.username || !conf.passwordHash) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not_configured', message: 'No credentials set in Settings → Station → Security' }));
        return;
      }
      // Constant-time username comparison (avoid leaking whether the user exists)
      const userOk = username.length === conf.username.length &&
                     require('crypto').timingSafeEqual(Buffer.from(username), Buffer.from(conf.username));
      const passOk = await _auth.verifyPassword(password, conf.passwordHash);
      if (!userOk || !passOk) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_credentials' }));
        return;
      }
      _auth.resetLoginRate(req);
      const cookie = _auth.buildSessionCookie(conf.username);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': cookie });
      res.end(JSON.stringify({ ok: true, user: conf.username }));
    })();
    return true;
  }

  // ── POST /api/auth/logout ───────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': _auth.buildLogoutCookie() });
    res.end(JSON.stringify({ ok: true }));
    return true;
  }

  // ── POST /api/auth/set-password ─────────────────────────────────────────
  // Sets username + password. Allowed if (a) no credentials yet (first-time
  // setup) or (b) caller is already authenticated. The current password is
  // required when changing an existing one.
  if (req.method === 'POST' && pathname === '/api/auth/set-password') {
    (async () => {
      let payload;
      try {
        const body = await _readBody(req);
        payload = JSON.parse(body || '{}');
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_body' }));
        return;
      }
      const { username, currentPassword, newPassword } = payload;
      const conf = _auth.getConfig();
      const isFirstSetup = !conf.passwordHash || !conf.username;
      if (!isFirstSetup) {
        // When changing an existing password, require either a valid
        // session or the current password.
        if (!req.user) {
          if (!currentPassword || !(await _auth.verifyPassword(currentPassword, conf.passwordHash))) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'current_password_required' }));
            return;
          }
        }
      }
      if (typeof username !== 'string' || !/^[A-Za-z0-9_.\-]+$/.test(username) || username.length < 1 || username.length > 64) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_username', message: 'Username must be 1-64 chars, letters/digits/_.-' }));
        return;
      }
      let hash;
      try { hash = await _auth.hashPassword(newPassword); }
      catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_password', message: e.message }));
        return;
      }
      const { writeBirdnetConf } = ctx;
      await writeBirdnetConf({ AUTH_USERNAME: username, AUTH_PASSWORD_HASH: hash });
      await _auth.refreshConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    })();
    return true;
  }

  return false;
}

module.exports = { handle };
