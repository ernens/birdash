"""BirdEngine — BirdWeather soundscape + detections upload.

Extracted from engine.py during the refactor; behavior unchanged.
"""

import datetime
import io
import json
import logging
import os
import re
import urllib.request

import soundfile as sf

log = logging.getLogger("birdengine")


def upload_to_birdweather(wav_path, detections, config):
    """Upload soundscape + detections to BirdWeather API."""
    bw = config.get("birdweather", {})
    station_id = bw.get("station_id", "")
    if not station_id or not bw.get("enabled", False) or not detections:
        return

    lat = config["station"]["latitude"]
    lon = config["station"]["longitude"]

    try:
        # Convert WAV to FLAC for upload
        if not os.path.exists(wav_path):
            log.debug("BirdWeather: WAV not found (purged?): %s", wav_path)
            return
        data, sr = sf.read(wav_path, dtype="float32")
        if data.ndim > 1:
            data = data.mean(axis=1)
        buf = io.BytesIO()
        sf.write(buf, data, sr, format="FLAC")
        flac_data = buf.getvalue()

        # Parse timestamp from filename
        basename = os.path.basename(wav_path)
        date_match = re.search(r"(\d{4}-\d{2}-\d{2})", basename)
        time_match = re.search(r"(\d{2}:\d{2}:\d{2})", basename)
        if date_match and time_match:
            file_dt = datetime.datetime.strptime(
                f"{date_match.group(1)}T{time_match.group(1)}", "%Y-%m-%dT%H:%M:%S"
            )
            timestamp = file_dt.astimezone().isoformat()
        else:
            timestamp = datetime.datetime.now().astimezone().isoformat()

        # POST soundscape
        url = f"https://app.birdweather.com/api/v1/stations/{station_id}/soundscapes?timestamp={timestamp}"
        req = urllib.request.Request(url, data=flac_data,
                                     headers={"Content-Type": "audio/flac"}, method="POST")
        resp = urllib.request.urlopen(req, timeout=30)
        result = json.loads(resp.read())

        if not result.get("success"):
            log.warning("BirdWeather soundscape failed: %s", result.get("message"))
            return

        soundscape_id = result["soundscape"]["id"]

        # POST each detection
        det_url = f"https://app.birdweather.com/api/v1/stations/{station_id}/detections"
        model_name = detections[0].get("model", "")
        algorithm = "2p4" if "V2.4" in model_name else "alpha"

        for det in detections:
            det_data = json.dumps({
                "timestamp": timestamp,
                "lat": lat, "lon": lon,
                "soundscapeId": soundscape_id,
                "soundscapeStartTime": det.get("_start", 0),
                "soundscapeEndTime": det.get("_stop", 3),
                "commonName": det["com_name"],
                "scientificName": det["sci_name"],
                "algorithm": algorithm,
                "confidence": det["confidence"],
            }).encode("utf-8")
            req = urllib.request.Request(det_url, data=det_data,
                                         headers={"Content-Type": "application/json"}, method="POST")
            try:
                urllib.request.urlopen(req, timeout=20)
            except Exception as e:
                log.warning("BirdWeather detection POST failed: %s", e)

        log.info("BirdWeather: uploaded %d detections (soundscape %s)", len(detections), soundscape_id)

    except Exception as e:
        log.warning("BirdWeather upload failed: %s", e)
