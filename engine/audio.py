"""BirdEngine — audio I/O, monitoring, adaptive gain, filters, chunking.

Extracted from engine.py during the refactor; behavior unchanged.
"""

import json
import logging
import math
import os
import time

import numpy as np
import soundfile as sf

log = logging.getLogger("birdengine")


# ---------------------------------------------------------------------------
# Audio I/O
# ---------------------------------------------------------------------------

def read_audio(path, sample_rate):
    """Read audio file and resample to target rate."""
    data, sr = sf.read(path, dtype="float32", always_2d=False)
    # Convert stereo to mono
    if data.ndim > 1:
        data = data.mean(axis=1)
    # Resample if needed
    if sr != sample_rate:
        import resampy
        data = resampy.resample(data, sr, sample_rate)
    return data


# ---------------------------------------------------------------------------
# Sound-level monitoring (Leq / peak in dBFS)
# ---------------------------------------------------------------------------
# Computed per WAV before adaptive gain or filtering, so values reflect the
# raw microphone signal — useful for spotting wind, traffic, overnight
# silence, or a dead capture chain. Values are dBFS (0 = full scale), not
# SPL — trend-tracking only, not a calibrated sound-level meter.

_SOUND_LEVEL_FLOOR = -120.0  # dB floor for silent frames (avoid -inf)
_SOUND_LEVEL_RING = 120      # keep ~90 min at 45s/chunk


def _sound_level_path():
    home = os.environ.get("HOME", os.path.expanduser("~"))
    primary_dir = os.path.join(home, "birdash", "config")
    if os.path.isdir(primary_dir):
        return os.path.join(primary_dir, "sound_level.json")
    # fallback: relative to engine file
    return os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "config", "sound_level.json")


def compute_sound_level(samples):
    """Return (leq_dbfs, peak_dbfs) for a mono float32 signal in [-1, 1]."""
    if samples is None or samples.size == 0:
        return _SOUND_LEVEL_FLOOR, _SOUND_LEVEL_FLOOR
    # RMS over the whole chunk → dBFS (reference = full scale 1.0)
    rms = float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))
    peak = float(np.max(np.abs(samples)))
    leq = 20.0 * math.log10(rms) if rms > 1e-10 else _SOUND_LEVEL_FLOOR
    pk = 20.0 * math.log10(peak) if peak > 1e-10 else _SOUND_LEVEL_FLOOR
    return max(leq, _SOUND_LEVEL_FLOOR), max(pk, _SOUND_LEVEL_FLOOR)


def record_sound_level(leq_dbfs, peak_dbfs, duration_sec, file_basename=""):
    """Append a reading to config/sound_level.json (rolling buffer)."""
    path = _sound_level_path()
    try:
        state = {}
        if os.path.exists(path):
            try:
                with open(path) as f:
                    state = json.load(f) or {}
            except (OSError, json.JSONDecodeError):
                state = {}
        buf = state.get("buffer") or []
        entry = {
            "ts": time.time(),
            "leq": round(leq_dbfs, 2),
            "peak": round(peak_dbfs, 2),
            "dur": round(duration_sec, 2),
        }
        buf.append(entry)
        if len(buf) > _SOUND_LEVEL_RING:
            buf = buf[-_SOUND_LEVEL_RING:]
        state["current"] = {**entry, "file": file_basename}
        state["buffer"] = buf
        # atomic replace to avoid partial reads by Node
        tmp = path + ".tmp"
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(tmp, "w") as f:
            json.dump(state, f)
        os.replace(tmp, path)
    except Exception as e:
        log.debug("[sound-level] write failed: %s", e)


# ---------------------------------------------------------------------------
# Adaptive gain (queries birdash for current gain decision)
# ---------------------------------------------------------------------------

def apply_adaptive_gain(samples, api_url="http://127.0.0.1:7474"):
    """Apply adaptive gain from birdash server if enabled and not in observer mode.

    Returns (gained_samples, gain_db). If disabled/observer, returns (samples, 0).
    """
    try:
        import urllib.request
        resp = urllib.request.urlopen(f"{api_url}/api/audio/adaptive-gain/state", timeout=2)
        data = json.loads(resp.read())
        state = data.get("state", {})
        config = data.get("config", {})

        if not config.get("enabled", False) or config.get("observer_only", True):
            return samples, 0.0

        gain_db = state.get("current_gain_db", 0.0)
        if gain_db == 0.0:
            return samples, 0.0

        # Apply gain: linear = 10^(dB/20)
        linear_gain = 10.0 ** (gain_db / 20.0)
        gained = samples * linear_gain

        # Soft clip to prevent overdriving (tanh limiter)
        gained = np.tanh(gained)

        return gained.astype(np.float32), gain_db
    except Exception:
        return samples, 0.0


# ---------------------------------------------------------------------------
# Audio config + filter pipeline
# ---------------------------------------------------------------------------

def load_audio_config():
    """Load audio_config.json from the birdash config directory."""
    home = os.environ.get("HOME", os.path.expanduser("~"))
    candidates = [
        os.path.join(home, "birdash", "config", "audio_config.json"),
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "config", "audio_config.json"),
    ]
    for path in candidates:
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            continue
    return {}


def apply_filters(samples, sr, audio_config):
    """Apply audio filters (highpass, lowpass, spectral gating) based on audio_config.

    Returns filtered samples as float32.
    """
    sig = samples

    # ── Highpass filter ──────────────────────────────────────────────────
    if audio_config.get("highpass_enabled", False):
        cutoff = audio_config.get("highpass_cutoff_hz", 100)
        try:
            from scipy.signal import butter, sosfilt
            sos = butter(4, cutoff, btype="high", fs=sr, output="sos")
            sig = sosfilt(sos, sig).astype(np.float32)
            log.debug("Highpass filter applied: %d Hz", cutoff)
        except ImportError:
            log.warning("scipy not installed — highpass filter skipped")

    # ── Lowpass filter ───────────────────────────────────────────────────
    if audio_config.get("lowpass_enabled", False):
        cutoff = audio_config.get("lowpass_cutoff_hz", 10000)
        try:
            from scipy.signal import butter, sosfilt
            sos = butter(4, cutoff, btype="low", fs=sr, output="sos")
            sig = sosfilt(sos, sig).astype(np.float32)
            log.debug("Lowpass filter applied: %d Hz", cutoff)
        except ImportError:
            log.warning("scipy not installed — lowpass filter skipped")

    # ── Noise profile subtraction (recorded ambient noise) ─────────────
    if audio_config.get("noise_profile_enabled", False):
        profile_path = audio_config.get("noise_profile_path", "")
        strength = audio_config.get("denoise_strength", 0.5)
        try:
            import noisereduce as nr
            noise, noise_sr = sf.read(profile_path, dtype="float32", always_2d=False)
            if noise.ndim > 1:
                noise = noise.mean(axis=1)
            if noise_sr != sr:
                import resampy
                noise = resampy.resample(noise, noise_sr, sr).astype(np.float32)
            sig = nr.reduce_noise(
                y=sig, sr=sr,
                y_noise=noise,
                prop_decrease=strength,
                stationary=True,
                n_fft=1024,
                hop_length=256,
            ).astype(np.float32)
            log.debug("Noise profile subtraction applied: %s (strength=%.2f)", profile_path, strength)
        except Exception as e:
            log.warning("Noise profile error: %s — falling back to auto denoise", e)
            # Fallback to stationary auto-denoise
            try:
                import noisereduce as nr
                sig = nr.reduce_noise(
                    y=sig, sr=sr, prop_decrease=strength,
                    stationary=True, n_fft=1024, hop_length=256,
                ).astype(np.float32)
            except ImportError:
                pass

    # ── Spectral gating (auto noise reduction) ──────────────────────────
    elif audio_config.get("denoise_enabled", False):
        strength = audio_config.get("denoise_strength", 0.5)
        try:
            import noisereduce as nr
            sig = nr.reduce_noise(
                y=sig, sr=sr,
                prop_decrease=strength,
                stationary=True,
                n_fft=1024,
                hop_length=256,
            ).astype(np.float32)
            log.debug("Spectral gating applied: strength=%.2f", strength)
        except ImportError:
            log.warning("noisereduce not installed — spectral gating skipped")

    # ── RMS normalization ────────────────────────────────────────────────
    if audio_config.get("rms_normalize", False):
        target = audio_config.get("rms_target", 0.05)
        rms = np.sqrt(np.mean(sig ** 2))
        if rms > 1e-6:
            sig = (sig * (target / rms)).astype(np.float32)
            log.debug("RMS normalized: %.4f → %.4f", rms, target)

    return sig


# ---------------------------------------------------------------------------
# Chunk splitter
# ---------------------------------------------------------------------------

def split_signal(sig, rate, overlap, seconds=3.0, minlen=1.5):
    """Split audio signal into overlapping chunks."""
    chunks = []
    step = int((seconds - overlap) * rate)
    chunk_len = int(seconds * rate)
    min_samples = int(minlen * rate)

    for i in range(0, len(sig), step):
        chunk = sig[i:i + chunk_len]
        if len(chunk) < min_samples:
            break
        if len(chunk) < chunk_len:
            padded = np.zeros(chunk_len, dtype=np.float32)
            padded[:len(chunk)] = chunk
            chunk = padded
        chunks.append(chunk)
    return chunks
