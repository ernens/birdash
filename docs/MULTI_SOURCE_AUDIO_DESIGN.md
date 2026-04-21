# Multi-Source Audio — Design Doc

**Status:** Deferred — design validated, implementation paused after wizard stabilization (2026-04-21).
**Reference:** Inspired by `Suncuss/BirdNET-PiPy` (multi-source rolled out across 6 months in their 0.4.x → 0.6.x series).
**Resume here:** when ready to start, re-read this doc and confirm the 4 open questions at the bottom haven't changed.

## Use case

> "I want to capture my garden (RØDE), my feeder (USB lavalier), and my nest box (RTSP camera with mic) in parallel, and know which source heard which bird."

Today, birdash records from a single audio device defined in `config/audio_config.json` via a single `arecord` process. This doc captures the design to lift that to N parallel sources.

## Six architectural decisions (validated)

### 1. Database schema → add `Source` column to `detections`

The `Source TEXT` column is added to BirdNET-Pi's `detections` table via `ALTER TABLE detections ADD COLUMN Source TEXT`. Existing detections stay `NULL`, treated as "legacy / single-source" by the UI.

Alternatives rejected:
- **Joined `detection_sources` table** — JOIN penalty on every query, more complex frontend.
- **Suffix in `Model` field** (e.g. `BirdNET_FP16:garden`) — hacky, breaks existing model-based queries.

### 2. Process model → N parallel `arecord` (one per source)

A new Python supervisor (`engine/sources_supervisor.py`) reads `config/audio_sources.json` and launches one capture process per active source. Each source writes to its own incoming directory:

```
~/birdengine/audio/incoming/garden/*.wav
~/birdengine/audio/incoming/feeder/*.wav
~/birdengine/audio/incoming/nestbox/*.wav
```

The supervisor watchdogs each process and restarts on death (5s backoff, max 3 retries before marking the source "errored").

Alternatives rejected:
- **Single multiplexer** — single point of failure.
- **One systemd unit per source** — operationally heavy for the user.

### 3. RTSP support → defer to a later phase

Phase 2 ships USB-only support (covers ~70% of use cases: multiple physical mics on the same Pi). RTSP cameras with audio (Reolink etc.) come in a later phase once the architecture is proven, because they bring additional concerns:
- ffmpeg dependency for stream conversion
- Stream stale detection / auto-reconnect
- Network buffering tuning

### 4. Inference concurrency → ThreadPoolExecutor with max 2 workers

When N sources produce audio in parallel, the engine processes them through a small thread pool:
- **Pi 5** (8 GB RAM): 2 workers — typical use 2-3 sources, no thrashing
- **Pi 4** (4 GB RAM): 2 workers — limit advised to 2 sources
- **Pi 3** (1 GB RAM): 1 worker — limit advised to 1 source (hardware-gated in UI)

The pool keeps inference latency manageable when multiple sources detect simultaneously.

### 5. UI surface

| Element | Location | Notes |
|---|---|---|
| **Audio Sources panel** | Settings → new "Sources" tab | CRUD: add (auto-detect USB), test (3s VU), label, enable/disable, delete |
| **Source badge on each detection** | All 6 detection-list pages + spectrogram modal | Small chip like the existing `Model` badge, with a per-source color (palette of 6) |
| **Source filter dropdown** | `detections.html`, `today.html`, `recordings.html` | Multi-select |
| **Per-source health** | Settings → Sources panel | Live status (recording? errors? last detection?) via SSE |

### 6. Backwards compatibility

- **Single-source installs** stay unchanged: a single `arecord` reads `audio_config.json` exactly like today.
- **Multi-source is opt-in** via the new Settings UI. Migrating = adding a 2nd source in the list.
- The supervisor reads `audio_sources.json` if present; otherwise it falls back to `audio_config.json` (legacy single-source mode).

## Phasing

| Phase | Scope | Estimated effort |
|---|---|---|
| **P1** | DB migration (`ALTER TABLE` adds `Source`) + engine reads from `incoming/<source-key>/` and fills the column. Single-source compat intact | ~3 h |
| **P2** | `sources_supervisor.py` + `audio_sources.json` schema + systemd integration | ~4 h |
| **P3** | Settings UI: "Audio Sources" panel (CRUD + USB auto-detect + test) | ~4 h |
| **P4** | Source badge + filter on the 6 detection pages + i18n (4 languages) | ~3 h |
| **P5** *(separate session)* | RTSP support: ffmpeg-based capture, stream health, reconnect | ~4 h |

**Total P1-P4: ~14 h.**

## Operational guardrails

- **Pi 3** (1 GB RAM): UI limits to 1 source — adding a 2nd surfaces a warning + blocks the form.
- **Pi 4** (4 GB RAM): UI suggests max 2 sources, allows 3 with warning.
- **Pi 5** (8 GB RAM): no UI limit, 3 sources comfortable, 4+ at user's risk.
- **Zero interruption** of running detections during config changes — same pattern as the setup wizard: write config to disk, user manually restarts services when ready.
- **New tests**: backend test for the supervisor (mock arecord), smoke test for the Sources UI.

## Open questions to confirm at resume

When picking this up later, re-confirm these — the answers may have shifted with new constraints or learnings:

1. **DB schema option 1 (column)** — still happy to migrate the BirdNET-Pi `detections` table? If the upstream BirdNET-Pi project is moving away from this DB shape, re-evaluate.
2. **USB-only in P2** (RTSP later) — still the right tradeoff? If a user has been blocked specifically waiting for RTSP, reverse the order.
3. **All-at-once P1→P4** vs **stop after P1** to validate engine stability for a few days before adding UI. P1 alone is internally usable via manual `audio_sources.json` editing.
4. **Hardware gate on Pi 3**: hard limit at 1 source, or warning only? Default proposal: hard limit (UX safer than freeing the user to crash their Pi).

## Reference: where ideas come from

`Suncuss/BirdNET-PiPy` shipped multi-source in 0.6.0 (April 2026), with iterative polishing:
- 0.6.0: multi-mic + RTSP simultaneously, SetupWizard for first-source onboarding
- 0.6.1: hot-apply settings without restart
- 0.6.2: RTSP test on save, opacity for active/inactive sources, label-only-edits skip restart
- 0.6.3: source-label-aware filenames, cleanup query joining the `extra` column

Their full release notes are a good QA checklist when implementing P2-P4.

## Related decisions already in birdash

- **Setup wizard** (v1.35.0) detects USB devices via `/api/setup/hardware-profile` — the same detection helper can power the "auto-detect USB" button in the Sources panel.
- **Per-detection weather** (v1.31-1.34) added a `weather_hourly` table in `birdash.db` joined by `(date, hour)`. The pattern of "side data joined at query time" is the model for any future per-source metadata that doesn't fit in the main detections table.
