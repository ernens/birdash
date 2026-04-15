'use strict';
/**
 * Adaptive gain system — software gain control based on ambient noise.
 *
 * Pure functional module: maintains a sliding window of RMS/peak samples
 * and recommends a gain adjustment based on noise floor analysis.
 *
 * Extracted from server/routes/audio.js for reuse and testability.
 */

const AG_DEFAULTS = {
  enabled: false, mode: 'balanced', observer_only: true,
  min_db: -6, max_db: 9, step_up_db: 0.5, step_down_db: 1.5,
  update_interval_s: 10, history_s: 30, noise_percentile: 20,
  target_floor_dbfs: -42, clip_guard_dbfs: -3, activity_hold_s: 15,
};

const _state = {
  current_gain_db: 0, recommended_gain_db: 0, last_update_ts: 0, hold_until_ts: 0,
  noise_floor_dbfs: null, activity_dbfs: null, peak_dbfs: null,
  reason: 'init', history: [],
};

function _percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p / 100 * s.length)))];
}

function _clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

function pushSample(rms_dbfs, peak_dbfs) {
  _state.history.push({ ts: Date.now(), rms_dbfs, peak_dbfs });
  if (_state.history.length > 2000) _state.history.splice(0, _state.history.length - 1500);
}

function update(cfg) {
  const c = { ...AG_DEFAULTS, ...cfg };
  const now = Date.now();
  if (!c.enabled) { _state.reason = 'disabled'; return _state; }
  const windowMs = c.history_s * 1000;
  _state.history = _state.history.filter(x => now - x.ts <= windowMs);
  if (_state.history.length < 5) { _state.reason = 'not_enough_data'; return _state; }
  const rms = _state.history.map(x => x.rms_dbfs).filter(Number.isFinite);
  const peaks = _state.history.map(x => x.peak_dbfs).filter(Number.isFinite);
  if (!rms.length || !peaks.length) { _state.reason = 'invalid'; return _state; }
  const nf = _percentile(rms, c.noise_percentile);
  const act = _percentile(rms, 80);
  const pk = Math.max(...peaks);
  _state.noise_floor_dbfs = Math.round(nf * 10) / 10;
  _state.activity_dbfs = Math.round(act * 10) / 10;
  _state.peak_dbfs = Math.round(pk * 10) / 10;
  if (pk >= c.clip_guard_dbfs) {
    _state.recommended_gain_db = _clamp(_state.recommended_gain_db - c.step_down_db, c.min_db, c.max_db);
    _state.reason = 'clip_guard';
  } else if ((act - nf) >= 10) {
    _state.hold_until_ts = now + c.activity_hold_s * 1000;
    _state.reason = 'activity_hold';
  } else if (now < _state.hold_until_ts) {
    _state.reason = 'activity_hold';
  } else {
    const desired = _clamp(c.target_floor_dbfs - nf, c.min_db, c.max_db);
    if (desired > _state.recommended_gain_db) {
      _state.recommended_gain_db = Math.min(_state.recommended_gain_db + c.step_up_db, desired);
      _state.reason = 'step_up';
    } else if (desired < _state.recommended_gain_db) {
      _state.recommended_gain_db = Math.max(_state.recommended_gain_db - c.step_down_db, desired);
      _state.reason = 'step_down';
    } else { _state.reason = 'stable'; }
  }
  _state.recommended_gain_db = Math.round(_clamp(_state.recommended_gain_db, c.min_db, c.max_db) * 10) / 10;
  if (!c.observer_only) _state.current_gain_db = _state.recommended_gain_db;
  else _state.reason = 'observer';
  _state.last_update_ts = now;
  return _state;
}

function getState() { return _state; }

module.exports = { AG_DEFAULTS, pushSample, update, getState };
