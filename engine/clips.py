"""BirdEngine — MP3 clip extraction + matching dashboard-style spectrogram PNG.

Extracted from engine.py during the refactor; behavior unchanged.
"""

import logging
import os
import subprocess

import numpy as np
import soundfile as sf

log = logging.getLogger("birdengine")


def _generate_clip_spectrogram(audio_path, png_path, width=940, height=611):
    """Generate a spectrogram PNG matching the dashboard plasma colormap.

    Uses percentile 5%-99.5% normalization and 0-12 kHz range,
    identical to bird-shared.js renderSpectrogram().
    """
    from matplotlib.colors import LinearSegmentedColormap
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from scipy.signal import stft as scipy_stft

    plasma_stops = [
        (0.00, (0, 0, 0)), (0.10, (20, 0, 50)), (0.25, (80, 0, 100)),
        (0.42, (180, 20, 80)), (0.58, (230, 70, 20)), (0.75, (255, 155, 0)),
        (0.90, (255, 230, 70)), (1.00, (255, 255, 255)),
    ]
    cmap = LinearSegmentedColormap.from_list("birdash_plasma", [
        (pos, (r / 255, g / 255, b / 255)) for pos, (r, g, b) in plasma_stops
    ], N=256)

    sig, sr = sf.read(audio_path, dtype="float32", always_2d=False)
    if sig.ndim > 1:
        sig = sig.mean(axis=1)

    f, t, Zxx = scipy_stft(sig, fs=sr, nperseg=1024, noverlap=768)
    mag_db = 20 * np.log10(np.abs(Zxx) + 1e-10)

    max_hz = 12000
    max_bin = int(max_hz / (sr / 2) * len(f))
    mag_db = mag_db[:max_bin, :]

    flat = mag_db.ravel().copy()
    flat.sort()
    vmin = flat[int(len(flat) * 0.05)]
    vmax = flat[int(len(flat) * 0.995)]
    if vmax <= vmin:
        vmax = vmin + 1

    max_bin = int(max_hz / (sr / 2) * len(f))
    mag_db = mag_db[:max_bin, :]

    dpi = 96
    fig, ax = plt.subplots(1, 1, figsize=(width / dpi, height / dpi), dpi=dpi)
    ax.imshow(mag_db, aspect="auto", origin="lower", cmap=cmap,
              vmin=vmin, vmax=vmax, interpolation="nearest")
    ax.axis("off")
    fig.subplots_adjust(left=0, right=1, top=1, bottom=0)
    fig.savefig(png_path, dpi=dpi, bbox_inches="tight", pad_inches=0)
    plt.close(fig)


def extract_clip(wav_path, det, config):
    """Extract an audio clip for a detection and store locally.

    Uses det["file_name"] as the clip filename (already set by the caller).
    Stored:  ~/BirdSongs/Extracted/By_Date/YYYY-MM-DD/Espece/
    """
    com_name_safe = det["com_name"].replace("'", "").replace(" ", "_")
    clip_name = det["file_name"]
    local_dir = os.path.join(
        os.path.expanduser("~"), "BirdSongs", "Extracted", "By_Date",
        det["date"], com_name_safe)
    os.makedirs(local_dir, exist_ok=True)

    start = max(0, det.get("_start", 0) - 1.5)
    stop = det.get("_stop", start + 3) + 1.5

    mp3_path = os.path.join(local_dir, clip_name)
    png_path = mp3_path + ".png"

    def _cleanup_empty():
        # ffmpeg can leave a 0-byte file behind when it crashes mid-write
        # (OOM killer on Pi 3, SD card I/O contention, broken pipe). Don't
        # leave that around — the dashboard would just show "Erreur de
        # décodage audio" and the entry would never self-heal.
        for p in (mp3_path, png_path):
            try:
                if os.path.exists(p) and os.path.getsize(p) == 0:
                    os.unlink(p)
            except OSError:
                pass

    try:
        # Extract MP3 clip
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", wav_path,
             "-ss", str(start), "-to", str(stop),
             "-ac", "1", "-ar", "24000", "-b:a", "128k",
             "-loglevel", "error", mp3_path],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            log.error("ffmpeg extract failed: %s", result.stderr.strip())
            _cleanup_empty()
            return None
        # Defensive: on slow / contended I/O, ffmpeg sometimes returns 0 but
        # writes nothing measurable. Treat that as a failure too.
        try:
            if os.path.getsize(mp3_path) == 0:
                log.warning("ffmpeg produced empty MP3 for %s — discarding", clip_name)
                _cleanup_empty()
                return None
        except OSError:
            return None

        # Generate spectrogram from the clip (Python, matching dashboard colormap)
        try:
            _generate_clip_spectrogram(mp3_path, png_path)
        except Exception as e:
            log.warning("Spectrogram generation failed: %s", e)

        _cleanup_empty()  # In case the spectrogram step left a 0-byte PNG
        return clip_name
    except subprocess.TimeoutExpired:
        log.error("ffmpeg timeout (>30s) extracting %s — likely SD-card I/O saturation", clip_name)
        _cleanup_empty()
        return None
    except Exception as e:
        log.error("Extract clip error: %s", e)
        _cleanup_empty()
        return None
