'use strict';
/**
 * Setup wizard routes — first-run detection, hardware profile, and
 * batch-apply of wizard choices.
 *
 * Endpoints:
 *   GET  /api/setup/status           — { needed, completed_at, gaps }
 *   GET  /api/setup/hardware-profile — { pi, ram, audio_devices, disks,
 *                                        internet, recommendations }
 *   POST /api/setup/complete         — applies the wizard choices in batch
 *                                       and writes config/setup-completed.json
 *
 * Design: the wizard is the orchestrator — it collects all choices in the
 * UI, then POSTs them in one shot. The backend doesn't carry per-step
 * state. This keeps "skip wizard" and "redo wizard" trivial and avoids
 * partial-state cleanup paths.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..', '..');
const SETUP_FLAG = path.join(PROJECT_ROOT, 'config', 'setup-completed.json');

function execCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000, encoding: 'utf8', ...opts }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}

// ── Detection helpers ─────────────────────────────────────────────────────

async function detectPi() {
  let model = '';
  try { model = (await fsp.readFile('/proc/device-tree/model', 'utf8')).replace(/\0/g, '').trim(); } catch {}
  // Normalize to a short tag for downstream recommendation logic
  let tag = 'unknown';
  if (/Raspberry Pi 5/i.test(model)) tag = 'pi5';
  else if (/Raspberry Pi 4/i.test(model)) tag = 'pi4';
  else if (/Raspberry Pi 3/i.test(model)) tag = 'pi3';
  else if (/Raspberry Pi/i.test(model)) tag = 'pi-other';
  return { model, tag };
}

async function detectRam() {
  try {
    const meminfo = await fsp.readFile('/proc/meminfo', 'utf8');
    const m = meminfo.match(/MemTotal:\s*(\d+)/);
    if (m) {
      const bytes = parseInt(m[1]) * 1024;
      return { bytes, gb: Math.round(bytes / (1024 ** 3) * 10) / 10 };
    }
  } catch {}
  return { bytes: 0, gb: 0 };
}

async function detectAudioDevices() {
  // arecord -l lists capture cards; parse to a structured list with
  // a "recommended" flag favoring USB devices over the built-in.
  const out = await execCmd('arecord', ['-l']);
  const devices = [];
  const re = /^card (\d+): (\w+)\s*\[([^\]]+)\],\s*device (\d+):\s*([^\[\n]+)/gm;
  let m;
  while ((m = re.exec(out)) !== null) {
    const card = parseInt(m[1]);
    const id = m[2];
    const longName = m[3].trim();
    const device = parseInt(m[4]);
    const desc = m[5].trim();
    const isUsb = /usb/i.test(longName) || /usb/i.test(desc);
    const isBuiltin = /bcm2835|hdmi|headphones/i.test(longName);
    devices.push({
      card, device, id, name: longName, desc,
      hwId: `hw:${card},${device}`,
      cardId: `hw:CARD=${id},DEV=${device}`,
      kind: isUsb ? 'usb' : isBuiltin ? 'builtin' : 'other',
    });
  }
  // Recommend the first USB device, or the first device if none is USB.
  const recIdx = devices.findIndex(d => d.kind === 'usb');
  return { devices, recommended: recIdx >= 0 ? recIdx : (devices.length ? 0 : -1) };
}

async function detectDisks() {
  const out = await execCmd('lsblk', ['-J', '-b', '-o', 'NAME,SIZE,TYPE,TRAN,MODEL,MOUNTPOINT,FSTYPE']);
  const disks = [];
  try {
    const data = JSON.parse(out);
    for (const d of data.blockdevices || []) {
      if (d.type !== 'disk') continue;
      const mounts = (d.children || []).filter(c => c.mountpoint).map(c => ({
        path: c.mountpoint, fstype: c.fstype || ''
      }));
      const sizeGb = Math.round((parseInt(d.size) || 0) / (1024 ** 3));
      disks.push({
        name: d.name,
        size_gb: sizeGb,
        transport: d.tran || '',
        model: (d.model || '').trim(),
        mounts,
        is_external: d.tran === 'usb',
      });
    }
  } catch {}
  return disks;
}

async function detectInternet() {
  // 3-second probe to Open-Meteo (we use it anyway). Returns true/false.
  return new Promise((resolve) => {
    const req = https.get('https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m', { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// ── Recommendation logic ─────────────────────────────────────────────────

function recommendModels(piTag, ramGb) {
  // Hardware-aware defaults. The wizard surfaces these as the suggested
  // pick, but the user can override with the full advanced list.
  if (piTag === 'pi5' && ramGb >= 4) {
    return {
      primary: 'BirdNET_GLOBAL_6K_V2.4_Model_FP16',
      secondary: 'perch_v2_fp16',
      dual: true,
      reason: 'pi5_dual',
    };
  }
  if (piTag === 'pi4' && ramGb >= 4) {
    return {
      primary: 'BirdNET_GLOBAL_6K_V2.4_Model_FP16',
      secondary: 'perch_v2_int8',
      dual: true,
      reason: 'pi4_int8',
    };
  }
  if (piTag === 'pi3') {
    return {
      primary: 'BirdNET_GLOBAL_6K_V2.4_Model_FP16',
      secondary: null,
      dual: false,
      reason: 'pi3_single',
    };
  }
  return {
    primary: 'BirdNET_GLOBAL_6K_V2.4_Model_FP16',
    secondary: null,
    dual: false,
    reason: 'default',
  };
}

// ── Setup status ─────────────────────────────────────────────────────────

async function readSetupFlag() {
  try {
    const txt = await fsp.readFile(SETUP_FLAG, 'utf8');
    return JSON.parse(txt);
  } catch { return null; }
}

async function detectGaps(parseBirdnetConf) {
  // What's missing for a usable install? Empty/zero lat/lon counts as a
  // gap because solar/lunar/weather/eBird filtering all need it.
  const gaps = { location: false, audio_device: false };
  try {
    const conf = await parseBirdnetConf();
    const lat = parseFloat(conf.LATITUDE || conf.LAT || '0');
    const lon = parseFloat(conf.LONGITUDE || conf.LON || '0');
    if ((lat === 0 && lon === 0) || isNaN(lat) || isNaN(lon)) gaps.location = true;
  } catch { gaps.location = true; }
  try {
    const audioCfgPath = path.join(PROJECT_ROOT, 'config', 'audio_config.json');
    const cfg = JSON.parse(await fsp.readFile(audioCfgPath, 'utf8'));
    if (!cfg || !cfg.device_id) gaps.audio_device = true;
  } catch { gaps.audio_device = true; }
  return gaps;
}

// ── Apply wizard choices ─────────────────────────────────────────────────

async function applyChoices(choices, ctx) {
  const { writeBirdnetConf, parseBirdnetConf } = ctx;
  const results = {};

  // 1. Location → birdnet.conf LATITUDE/LONGITUDE
  if (choices.location && typeof choices.location.latitude === 'number' && typeof choices.location.longitude === 'number') {
    try {
      await writeBirdnetConf({
        LATITUDE: String(choices.location.latitude),
        LONGITUDE: String(choices.location.longitude),
      });
      results.location = 'ok';
    } catch (e) { results.location = 'error: ' + e.message; }
  }

  // 2. Audio device → config/audio_config.json (delegated to existing route via direct file write)
  if (choices.audio && choices.audio.device_id) {
    try {
      const audioCfgPath = path.join(PROJECT_ROOT, 'config', 'audio_config.json');
      let current = {};
      try { current = JSON.parse(await fsp.readFile(audioCfgPath, 'utf8')); } catch {}
      const merged = {
        ...current,
        device_id: choices.audio.device_id,
        device_name: choices.audio.device_name || current.device_name || '',
      };
      await fsp.writeFile(audioCfgPath, JSON.stringify(merged, null, 2));
      results.audio = 'ok';
    } catch (e) { results.audio = 'error: ' + e.message; }
  }

  // 3. Model selection → birdnet.conf MODEL + DUAL_MODEL_ENABLED + SECONDARY_MODEL
  if (choices.model && choices.model.primary) {
    try {
      const updates = {
        MODEL: choices.model.primary,
        DUAL_MODEL_ENABLED: choices.model.dual ? '1' : '0',
      };
      if (choices.model.dual && choices.model.secondary) {
        updates.SECONDARY_MODEL = choices.model.secondary;
      }
      await writeBirdnetConf(updates);
      results.model = 'ok';
    } catch (e) { results.model = 'error: ' + e.message; }
  }

  // 4. Pre-filters → birdnet.conf YAMNET_PRIVACY_FILTER + YAMNET_DOG_FILTER
  if (choices.filters) {
    try {
      const updates = {};
      if ('privacy' in choices.filters) updates.YAMNET_PRIVACY_FILTER = choices.filters.privacy ? '1' : '0';
      if ('dog' in choices.filters)     updates.YAMNET_DOG_FILTER     = choices.filters.dog ? '1' : '0';
      if (Object.keys(updates).length) await writeBirdnetConf(updates);
      results.filters = 'ok';
    } catch (e) { results.filters = 'error: ' + e.message; }
  }

  // 5. Integrations: BirdWeather station ID, Apprise URLs, MQTT — opt-in
  if (choices.integrations) {
    try {
      const updates = {};
      if (choices.integrations.birdweather_station_id) {
        updates.BIRDWEATHER_ID = choices.integrations.birdweather_station_id;
      }
      if (Object.keys(updates).length) await writeBirdnetConf(updates);
      // Apprise URLs go to config/apprise.txt (one URL per line)
      if (Array.isArray(choices.integrations.apprise_urls) && choices.integrations.apprise_urls.length) {
        const apprisePath = path.join(PROJECT_ROOT, 'config', 'apprise.txt');
        await fsp.writeFile(apprisePath, choices.integrations.apprise_urls.join('\n') + '\n');
      }
      results.integrations = 'ok';
    } catch (e) { results.integrations = 'error: ' + e.message; }
  }

  // 6. Mark setup complete (atomic write)
  try {
    const flag = {
      completed_at: new Date().toISOString(),
      version: 1,
      choices: { ...choices },
      results,
    };
    const tmp = SETUP_FLAG + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(flag, null, 2));
    await fsp.rename(tmp, SETUP_FLAG);
  } catch (e) {
    results._flag = 'error: ' + e.message;
  }

  return results;
}

// ── Route handler ────────────────────────────────────────────────────────

function handle(req, res, pathname, ctx) {
  const { parseBirdnetConf, writeBirdnetConf, requireAuth, JSON_CT } = ctx;

  // GET /api/setup/status
  if (req.method === 'GET' && pathname === '/api/setup/status') {
    (async () => {
      const flag = await readSetupFlag();
      const gaps = await detectGaps(parseBirdnetConf);
      const needed = !flag || gaps.location || gaps.audio_device;
      res.writeHead(200, JSON_CT);
      res.end(JSON.stringify({
        needed,
        completed_at: flag?.completed_at || null,
        gaps,
      }));
    })();
    return true;
  }

  // GET /api/setup/hardware-profile
  if (req.method === 'GET' && pathname === '/api/setup/hardware-profile') {
    (async () => {
      try {
        const [pi, ram, audio, disks, internet] = await Promise.all([
          detectPi(),
          detectRam(),
          detectAudioDevices(),
          detectDisks(),
          detectInternet(),
        ]);
        const externalDisks = disks.filter(d => d.is_external && d.size_gb > 1);
        const recommendations = {
          models: recommendModels(pi.tag, ram.gb),
          songs_storage: externalDisks.length ? externalDisks[0].mounts[0]?.path || null : null,
        };
        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ pi, ram, audio, disks, internet, recommendations }));
      } catch (e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: 'detection_failed', message: e.message }));
      }
    })();
    return true;
  }

  // POST /api/setup/complete
  if (req.method === 'POST' && pathname === '/api/setup/complete') {
    if (requireAuth && !requireAuth(req, res)) return true;
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', async () => {
      let choices;
      try { choices = JSON.parse(body || '{}'); }
      catch {
        res.writeHead(400, JSON_CT);
        res.end(JSON.stringify({ error: 'bad_json' }));
        return;
      }
      try {
        const results = await applyChoices(choices, { writeBirdnetConf, parseBirdnetConf });
        res.writeHead(200, JSON_CT);
        res.end(JSON.stringify({ ok: true, results }));
      } catch (e) {
        res.writeHead(500, JSON_CT);
        res.end(JSON.stringify({ error: 'apply_failed', message: e.message }));
      }
    });
    return true;
  }

  return false;
}

module.exports = { handle };
