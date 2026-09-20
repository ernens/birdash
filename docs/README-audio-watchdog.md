# Audio capture watchdog

`alerts.js` flags a mic that is too quiet or too loud, but it deliberately
abstains once the sound readings go stale. Its own comment explains why:

> If the engine hasn't written a reading in 2× the sustained window, we skip —
> the service-down alert already covers engine offline, no need to double-notify.

It doesn't cover it. `birdengine-recording.service` can sit `active` while
`arecord` produces nothing: a re-enumerated USB mic, a vanished ALSA device
(this host already logs `cannot get freq at ep 0x82` for the RØDE). systemd
sees a live process, so service-down never fires. The readings are stale, so
the sound alert abstains. **Nobody is told**, and the station records silence
until a human happens to look.

That is the same shape of failure as the July 2026 outage: a station that
looks fine to everything watching it.

## What it watches

The mtime of the newest `*.wav` in the engine's incoming directory — what
`arecord` actually produces, rather than anything downstream of it. With
`RECORDING_LENGTH=45`, a healthy station always has a file younger than about
90 seconds.

## Escalation

| Level | Action |
|---|---|
| 1 | restart the recording service |
| 2 | restart the recording service **and** the engine |
| 3+ | stop restarting, notify once, wait for a human |

After each restart the watchdog waits `restart_grace_sec` before judging
again — a fresh `arecord` needs a full recording length to produce its first
file. Restarts are capped at `max_restarts_per_hour`, so a dead mic is never
restarted in a loop. Recovery resets the level and sends an all-clear.

Notifications go through the same Apprise config as `alerts.js`
(`config/apprise.txt`).

## Options (`config/audio-watchdog.json`)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `incoming_dir` | *(empty = auto-detect)* | Tries `~/birdengine/audio/incoming`, then `engine/audio/incoming`. |
| `stall_sec` | `300` | No new WAV for this long ⇒ stalled. Keep well above `RECORDING_LENGTH`. |
| `restart_grace_sec` | `180` | Quiet period after a restart before judging again. |
| `max_restarts_per_hour` | `3` | Then back off and wait for a human. |
| `recording_service` | `birdengine-recording` | Restarted at level 1. |
| `engine_service` | `birdengine` | Also restarted from level 2. |
| `notify` | `true` | Send Apprise notifications. |

State lives in `config/audio-watchdog.state.json`; deleting it resets the
escalation level.

## Scope

This watches **liveness** — is audio arriving at all. Sound *quality* (too
quiet, too loud) stays with `alerts.js` and its `BIRDASH_ALERT_SOUND_*`
thresholds. The two do not overlap.
