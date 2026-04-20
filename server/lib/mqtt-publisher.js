'use strict';
/**
 * MQTT Publisher — publishes new bird detections to an MQTT broker.
 *
 * Mirrors the notification-watcher pattern: polls birds.db for new rows,
 * publishes one JSON message per detection. Targets the Home Assistant
 * domotic crowd (BirdNET-Go's killer integration), but works with any
 * MQTT broker (Mosquitto, EMQX, HiveMQ).
 *
 * Topics (configurable prefix, default `birdash`):
 *   <prefix>/<station>/status            — LWT, retained: "online" / "offline"
 *   <prefix>/<station>/detection          — every detection (JSON, QoS-configurable)
 *   <prefix>/<station>/last_species       — retained: last species (JSON, for HA sensors)
 *
 * Optional Home Assistant MQTT discovery (MQTT_HASS_DISCOVERY=1):
 *   homeassistant/sensor/birdash_<station>/.../config — auto-creates HA entities
 */

const os = require('os');

const POLL_INTERVAL = 15 * 1000;  // 15s — half of notif-watcher; feels real-time enough
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS  = 60_000;

let _mqtt = null;            // mqtt lib (lazy require so install can be missing)
let _client = null;          // active MqttClient
let _db = null;
let _parseBirdnetConf = null;
let _pollTimer = null;
let _lastPollTime = null;    // 'HH:MM:SS' string
let _currentDay = null;      // 'YYYY-MM-DD'
let _currentConf = null;     // last seen MQTT_* settings (for change detection)
let _retryAttempt = 0;
let _stopped = false;
let _stationSlug = '';
let _topicBase = '';
let _hassDiscoverySent = false;

function _slug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'station';
}

async function _readConf() {
  try {
    const conf = await _parseBirdnetConf();
    const minConfRaw = parseFloat(conf.MQTT_MIN_CONFIDENCE);
    const birdnetMin = parseFloat(conf.BIRDNET_CONFIDENCE);
    return {
      enabled:       conf.MQTT_ENABLED === '1',
      broker:        (conf.MQTT_BROKER || '').trim(),
      port:          parseInt(conf.MQTT_PORT || '1883', 10),
      username:      conf.MQTT_USERNAME || '',
      password:      conf.MQTT_PASSWORD || '',
      topicPrefix:   (conf.MQTT_TOPIC_PREFIX || 'birdash').trim().replace(/\/+$/, ''),
      qos:           Math.min(2, Math.max(0, parseInt(conf.MQTT_QOS || '0', 10))),
      retain:        conf.MQTT_RETAIN === '1',
      tls:           conf.MQTT_TLS === '1',
      minConfidence: !isNaN(minConfRaw) ? minConfRaw
                   : !isNaN(birdnetMin)  ? birdnetMin : 0,
      hassDiscovery: conf.MQTT_HASS_DISCOVERY === '1',
      stationName:   conf.SITE_NAME || conf.SITE_BRAND || os.hostname(),
    };
  } catch {
    return { enabled: false };
  }
}

function _confChanged(a, b) {
  if (!a || !b) return true;
  return ['enabled','broker','port','username','password','tls'].some(k => a[k] !== b[k]);
}

function _disconnect() {
  if (_client) {
    try { _client.end(true); } catch {}
    _client = null;
    _hassDiscoverySent = false;
  }
}

function _connect(conf) {
  if (!_mqtt) {
    try { _mqtt = require('mqtt'); }
    catch (e) {
      console.error('[mqtt-publisher] mqtt package not installed:', e.message);
      return;
    }
  }
  _disconnect();

  _stationSlug = _slug(conf.stationName);
  _topicBase = `${conf.topicPrefix}/${_stationSlug}`;

  const protocol = conf.tls ? 'mqtts' : 'mqtt';
  const url = `${protocol}://${conf.broker}:${conf.port || (conf.tls ? 8883 : 1883)}`;
  const opts = {
    clientId: `birdash_${_stationSlug}_${process.pid}`,
    reconnectPeriod: 0,    // we manage reconnect ourselves with backoff
    connectTimeout: 10_000,
    will: {
      topic: `${_topicBase}/status`,
      payload: 'offline',
      qos: 1,
      retain: true,
    },
  };
  if (conf.username) { opts.username = conf.username; opts.password = conf.password; }

  console.log(`[mqtt-publisher] Connecting to ${url} as ${opts.clientId}`);
  let client;
  try { client = _mqtt.connect(url, opts); }
  catch (e) { console.error('[mqtt-publisher] connect threw:', e.message); _scheduleReconnect(); return; }

  client.on('connect', () => {
    _retryAttempt = 0;
    console.log(`[mqtt-publisher] Connected to ${conf.broker}, base topic: ${_topicBase}`);
    client.publish(`${_topicBase}/status`, 'online', { qos: 1, retain: true });
    if (conf.hassDiscovery && !_hassDiscoverySent) {
      _publishHassDiscovery(client, conf);
      _hassDiscoverySent = true;
    }
  });
  client.on('error', (err) => {
    console.warn('[mqtt-publisher] Error:', err.message);
  });
  client.on('close', () => {
    if (_stopped) return;
    console.warn('[mqtt-publisher] Connection closed, will retry');
    _scheduleReconnect();
  });

  _client = client;
}

function _scheduleReconnect() {
  if (_stopped) return;
  _retryAttempt += 1;
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, _retryAttempt - 1));
  setTimeout(async () => {
    if (_stopped) return;
    const conf = await _readConf();
    if (conf.enabled && conf.broker) _connect(conf);
  }, delay);
}

function _publishHassDiscovery(client, conf) {
  const stationName = conf.stationName;
  const slug = _stationSlug;
  const device = {
    identifiers: [`birdash_${slug}`],
    name: `BirdStation ${stationName}`,
    model: 'BirdStation',
    manufacturer: 'birdash',
  };
  const sensors = [
    {
      uid: `birdash_${slug}_last_species`,
      cfg: {
        name: 'Last species',
        state_topic: `${_topicBase}/last_species`,
        value_template: '{{ value_json.common_name }}',
        json_attributes_topic: `${_topicBase}/last_species`,
        unique_id: `birdash_${slug}_last_species`,
        icon: 'mdi:bird',
        availability_topic: `${_topicBase}/status`,
        device,
      },
    },
    {
      uid: `birdash_${slug}_last_confidence`,
      cfg: {
        name: 'Last confidence',
        state_topic: `${_topicBase}/last_species`,
        value_template: '{{ (value_json.confidence * 100) | round(0) }}',
        unit_of_measurement: '%',
        unique_id: `birdash_${slug}_last_confidence`,
        icon: 'mdi:percent',
        availability_topic: `${_topicBase}/status`,
        device,
      },
    },
  ];
  for (const s of sensors) {
    const topic = `homeassistant/sensor/${s.uid}/config`;
    client.publish(topic, JSON.stringify(s.cfg), { qos: 1, retain: true });
  }
  console.log(`[mqtt-publisher] HA discovery published (${sensors.length} sensors)`);
}

async function _poll() {
  const conf = await _readConf();

  // Reconnect / disconnect when transport-affecting settings change
  if (_confChanged(_currentConf, conf)) {
    _currentConf = conf;
    _retryAttempt = 0;
    if (!conf.enabled || !conf.broker) { _disconnect(); return; }
    _connect(conf);
    return; // first message will be picked up next poll
  }
  if (!conf.enabled || !conf.broker) return;
  if (!_client || !_client.connected) return;

  const today = new Date().toISOString().slice(0, 10);
  if (_currentDay !== today) {
    _currentDay = today;
    _lastPollTime = null;
  }
  const since = _lastPollTime || new Date(Date.now() - POLL_INTERVAL).toISOString().slice(11, 19);

  let rows;
  try {
    rows = _db.prepare(
      'SELECT Date, Time, Com_Name, Sci_Name, Confidence, Model, File_Name FROM detections WHERE Date = ? AND Time > ? ORDER BY Time ASC'
    ).all(today, since);
  } catch (e) {
    console.error('[mqtt-publisher] Query error:', e.message);
    return;
  }
  if (rows.length) _lastPollTime = rows[rows.length - 1].Time;

  for (const det of rows) {
    if (conf.minConfidence > 0 && det.Confidence < conf.minConfidence) continue;
    const payload = {
      station:         conf.stationName,
      timestamp:       `${det.Date}T${det.Time}`,
      common_name:     det.Com_Name,
      scientific_name: det.Sci_Name,
      confidence:      Number((det.Confidence || 0).toFixed(4)),
      model:           det.Model || null,
      file:            det.File_Name || null,
    };
    const json = JSON.stringify(payload);
    const opts = { qos: conf.qos, retain: conf.retain };
    try {
      _client.publish(`${_topicBase}/detection`, json, opts);
      // last_species is always retained — that's what gives HA a useful sensor
      _client.publish(`${_topicBase}/last_species`, json, { qos: conf.qos, retain: true });
    } catch (e) {
      console.warn('[mqtt-publisher] Publish failed:', e.message);
    }
  }
}

// ── Test publish (used by /api/mqtt/test) ─────────────────────────────────
async function publishTest() {
  const conf = await _readConf();
  if (!conf.broker) throw new Error('MQTT_BROKER is empty — set it in Settings → Notifications');
  const lib = _mqtt || (_mqtt = require('mqtt'));
  const protocol = conf.tls ? 'mqtts' : 'mqtt';
  const url = `${protocol}://${conf.broker}:${conf.port || (conf.tls ? 8883 : 1883)}`;
  const opts = {
    clientId: `birdash_test_${process.pid}_${Date.now()}`,
    reconnectPeriod: 0,
    connectTimeout: 8000,
  };
  if (conf.username) { opts.username = conf.username; opts.password = conf.password; }

  const slug = _slug(conf.stationName);
  const topicBase = `${(conf.topicPrefix || 'birdash')}/${slug}`;

  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, info) => { if (done) return; done = true; try { client.end(true); } catch {} err ? reject(err) : resolve(info); };
    const client = lib.connect(url, opts);
    const timeout = setTimeout(() => finish(new Error('timeout connecting to broker')), 9000);
    client.on('connect', () => {
      clearTimeout(timeout);
      const payload = JSON.stringify({
        station: conf.stationName,
        timestamp: new Date().toISOString(),
        common_name: 'Test',
        scientific_name: 'Birdash test',
        confidence: 1.0,
        test: true,
      });
      client.publish(`${topicBase}/test`, payload, { qos: 0, retain: false }, (err) => {
        finish(err, { topic: `${topicBase}/test`, payload });
      });
    });
    client.on('error', (err) => { clearTimeout(timeout); finish(err); });
  });
}

// ── Public API ────────────────────────────────────────────────────────────
function start(db, parseBirdnetConf) {
  _db = db;
  _parseBirdnetConf = parseBirdnetConf;
  _stopped = false;
  setTimeout(() => _poll().catch(e => console.error('[mqtt-publisher]', e.message)), 12_000);
  _pollTimer = setInterval(() => _poll().catch(e => console.error('[mqtt-publisher]', e.message)), POLL_INTERVAL);
  console.log('[mqtt-publisher] Started (poll every 15s)');
}

function stop() {
  _stopped = true;
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  if (_client && _client.connected) {
    try { _client.publish(`${_topicBase}/status`, 'offline', { qos: 1, retain: true }); } catch {}
  }
  _disconnect();
}

module.exports = { start, stop, publishTest };
