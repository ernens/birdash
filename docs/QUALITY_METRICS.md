# Detection Quality Metrics — semantic spec

**Status:** Phase A shipped (read-only DB inferences). Phase B (engine
instrumentation) is gated on this document staying authoritative — any
counter we wire in must match a definition here, or this doc gets
amended first.

This spec exists because "we already log it in journalctl" is not the
same thing as "we measure it correctly". The page surfaces numbers as
facts to the user; ambiguous numbers there are worse than no numbers.

## Provenance taxonomy

Every value in `/api/quality` carries a `source` field:

| `source`           | Meaning                                                                 | Phase A | Phase B |
|--------------------|-------------------------------------------------------------------------|---------|---------|
| `observed`         | Computed from rows the engine actually wrote (DB query).                | ✅      | ✅      |
| `inferred`         | Derived from observed signal + a heuristic (e.g. delta avg before/after).| ✅     | ✅      |
| `not_instrumented` | Currently no measurement at all; UI shows a "Phase B" placeholder.       | ✅      | n/a     |
| `measured`         | Direct counter from a `quality_events` row written by the engine.        | n/a     | ✅      |

The frontend renders the `source` as a coloured badge next to each
card title — green/observed, amber/inferred, grey/not_instrumented,
green/measured. Users always know whether a number reflects a thing
the engine watched happen, or our reconstruction.

## Phase A definitions (currently shipped)

### Review outcomes (`source: observed`)

```
total      = COUNT(detections WHERE Date >= today - days)
confirmed  = COUNT(validations WHERE date >= today - days AND status='confirmed')
doubtful   = COUNT(validations WHERE date >= today - days AND status='doubtful')
rejected   = COUNT(validations WHERE date >= today - days AND status='rejected')
unreviewed = MAX(0, total - confirmed - doubtful - rejected)
```

Notes:
- Excludes `detections_trashed` rows by definition (they're not in
  `detections`).
- A row in `validations` with `status='unreviewed'` is treated as no
  validation at all — `unreviewed` is what's left over after the
  three terminal statuses.

### Cross-model agreement (`source: observed`)

For each Perch detection, count it as "agreed" if there exists at
least one BirdNET detection of the same `Sci_Name` on the same `Date`,
within ±3 seconds (3-second time bins, ±1 bin window).

```
per species:
  perch_count   = number of distinct (date, time-bin) tuples in
                  Perch model rows
  agreed_count  = subset of perch_count where the same (date, sci, bin)
                  also has a BirdNET row
  agreement_pct = round(agreed / perch * 100)
```

Volume guard: species with `perch_count < min_volume` (default 20)
are dropped from the response. This avoids "Bernache du Canada at
38% on 7 hits" dominating the top of the table.

**Caveats — read these before trusting the number:**
- This is **not** the engine's runtime cross-confirm decision. The
  engine looks at chunk-level overlap (BirdNET 3 s chunks ∩ Perch 5 s
  chunks ≥ 1 s overlap), per-model thresholds, and raw scores
  (top-20 pre-threshold). The DB only sees what survived all of that.
- A LOW agreement number can mean: (a) the species is genuinely hard
  for one of the two models, (b) the cross-confirm rule is doing its
  job and rejecting most Perch hits before they reach the DB,
  (c) the chunks don't align (3s vs 5s windows + offset), (d) the
  birdnet/perch label sets don't 1:1 map for that species.
- A HIGH agreement number is more straightforward: both models hear
  the species at roughly the same moments.

### Throttle effect (`source: inferred`)

Only computed when `NOISY_THROTTLE_ENABLED=1` in `birdnet.conf`.

```
For the 5 species with the highest count over the last 7 days:
  recent_per_day = count(last 7 days) / 7
  prior_per_day  = count(days 8 to 37 ago) / 30
  delta_pct      = (recent - prior) / prior * 100   (null if prior == 0)
```

Negative delta = the throttle is damping the species; positive delta
= the species is genuinely more vocal now (e.g. seasonal arrival).

**Caveats:**
- We don't store an "activated_at" timestamp anywhere, so we can't
  do a true before/after comparison. The 7d-vs-30d window is a proxy
  for "is the throttle currently doing something".
- A species that was silent 30 days ago but vocal now will show
  `prior_per_day = 0` → `delta_pct = null`. The UI doesn't claim a
  throttle effect in that case.

### Daily timeline (`source: observed`)

```
For each date in [today - days, today]:
  birdnet = COUNT(detections WHERE Model NOT LIKE 'perch%' AND Date = d)
  perch   = COUNT(detections WHERE Model LIKE 'perch%' AND Date = d)
  total   = birdnet + perch
```

A volume drop on a specific day usually means: engine restart, sound
card issue, threshold change, or genuinely quiet day. The chart is a
"something looks off?" signal, not a verdict.

## Phase B definitions (engine instrumentation, NOT YET WIRED)

The pre-filter card is the obvious gap in Phase A — it shows
`Engine counter wired in Phase B`. To stay honest, here are the
definitions Phase B will implement, locked **before** any code lands:

### ⚠ `cross_confirm_rejected` — DEFERRED

**Status:** the cross-confirm rule is documented + has a Settings UI +
3 birdnet.conf keys (`DUAL_CONFIRM_ENABLED`, `PERCH_STANDALONE_CONFIDENCE`,
`BIRDNET_ECHO_CONFIDENCE`), but **the engine never reads them and the
inference loop never runs the rule**. Commit e79e909 added the
documentation/UI half but the matching `engine.py` change was never
shipped. Until the rule actually runs, there's nothing to count.

The Quality page's pre-filter card surfaces this as a "known gap"
note with `cross_confirm_rejected: null`, rather than a fake zero.
Implementing the rule + this counter is its own backlog item.

Definition (kept here for when the rule lands):



```
Increment when:
  - A Perch chunk produced a detection with confidence in
    [PERCH_CONFIDENCE, PERCH_STANDALONE_CONFIDENCE)
  - AND no BirdNET raw prediction (top-20 pre-threshold) for the same
    sci_name reached BIRDNET_ECHO_CONFIDENCE on any 3 s chunk
    overlapping the Perch 5 s chunk by ≥ 1 s
  - AND the engine therefore did NOT call write_detection() for it

Counts: chunks (one chunk = one increment).
NOT counts: chunks that fell below PERCH_CONFIDENCE entirely (those are
  filtered earlier and aren't a cross-confirm decision).

Restart: counter resets to 0; the per-hour flush below makes daily
  totals robust to single restarts.
```

### `privacy_dropped`

```
Increment when:
  - YAMNet voice probability >= PRIVACY_FILTER_THRESHOLD on a WAV
  - AND PRIVACY_FILTER_ENABLED == 1
  - AND the engine therefore skipped that WAV entirely

Counts: files (one WAV = one increment), regardless of how many
  detections would otherwise have come out of it.

Independent of `dog_dropped` — both can fire on the same file in
principle, but the engine returns after the first match, so in
practice they're mutually exclusive.
```

### `dog_dropped`

```
Increment when:
  - YAMNet bark/howl/growl probability >= DOG_FILTER_THRESHOLD
  - AND DOG_FILTER_ENABLED == 1
  - AND the engine therefore skipped that WAV (also opens the
    DOG_FILTER_COOLDOWN_SEC window)

Counts: files. Files skipped DURING the cooldown window from a
  previous bark count under `dog_cooldown_skipped` (separate
  counter, also defined below) — not under `dog_dropped`.
```

### `dog_cooldown_skipped`

```
Increment when:
  - The engine skips a WAV because time.time() < self._dog_silence_until
  - (i.e. we're inside the cooldown window opened by a previous bark)

Counts: files. Decoupled from dog_dropped so the UI can tell the user
  "1 bark + 4 cooldown skips" instead of conflating them.
```

### `throttle_dropped`

```
Increment when:
  - NOISY_THROTTLE_ENABLED == 1
  - AND a candidate detection's confidence < THROTTLE_BYPASS_CONFIDENCE
  - AND its species was already inserted within THROTTLE_COOLDOWN_SECONDS
  - AND the engine therefore did NOT call write_detection() for it

Counts: detections (each candidate that the throttle drops = one
  increment), so this is a count of DB writes avoided.
NOT counts: bypass-confidence calls (those are inserted regardless).
```

### `files_processed`

```
Increment when:
  - The engine successfully completes process_file() on a WAV (no
    early-out via privacy/dog/cooldown).

Used as the denominator for filter rates ("X% of files dropped to
privacy") so the page can show ratios, not just absolute counts.
```

### Persistence shape

```sql
CREATE TABLE quality_events (
  Date TEXT,
  Hour INTEGER,
  cross_confirm_rejected INTEGER DEFAULT 0,
  privacy_dropped        INTEGER DEFAULT 0,
  dog_dropped            INTEGER DEFAULT 0,
  dog_cooldown_skipped   INTEGER DEFAULT 0,
  throttle_dropped       INTEGER DEFAULT 0,
  files_processed        INTEGER DEFAULT 0,
  PRIMARY KEY (Date, Hour)
);
```

Engine accumulates in-memory dicts during the hour. A timer at the
top of each hour does an `INSERT … ON CONFLICT DO UPDATE` to merge
the partial counts in. On clean shutdown, the accumulator flushes
once more so the in-flight hour isn't lost. **On crash, the
in-memory counters since the last hourly flush are lost** — that's
acceptable, the granularity is hourly, not per-detection.

## Out of scope (deliberately)

- A composite "trust score" rolling everything into a single 0-100
  number. The 5-card layout is the answer to "is my station healthy"
  — a score adds noise without adding decisions. Revisit if the
  community-network feature surfaces, where comparing stations
  needs a one-shot ranking.
- Real-time SSE for these counters. They're hourly summaries, not
  live data; an HTTP poll on page open is fine.
- Per-species pre-filter breakdown ("which species got dropped to
  dog filter?"). The filters operate on whole files before
  inference, so we don't have a species attribution.
