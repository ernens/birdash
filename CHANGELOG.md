# Changelog

All notable changes to BirdStation are documented here.

## [1.55.6] — 2026-05-13

### Perf — `/api/weather` no longer hits Open-Meteo at request time

Phase 2 of the weather.html cold-start audit. After Phase 1 (1.55.5),
the only remaining 30-second wait was the Open-Meteo daily-aggregate
proxy at first load (cache miss after 6 h, or after a server restart).

New `server/lib/weather-prefetch.js` keeps the 30-day daily aggregate
warm on disk (`data/weather-cache.json`), refreshed every 30 min in the
background. The route reads the file synchronously (~2 ms) and never
awaits the external API at request time — except once, on cold boot,
before the first prefetch tick has run.

The on-disk copy survives server restarts, so a `systemctl restart
birdash` no longer makes the user wait 30+ s on the next weather.html
visit. The in-memory `_weatherCache` is still primed from the disk read
for the fastest possible repeated hits.

Cache-status header now distinguishes `HIT` (memory) /
`HIT-DISK` (fresh disk) / `STALE-DISK` (kicks a background refresh) /
`MISS` (cold boot).

## [1.55.5] — 2026-05-13

### Perf — weather.html cold start: ~150 s → <2 s

Audit on 2026-05-13 showed weather.html locking the server for over
two minutes at first load. Three culprits:

1. **`/api/weather` (Open-Meteo proxy) — 83 s TTFB**. The 1 h cache was
   correct but cold misses bypassed everything. Doubled the cache
   window to 6 h (historical days never change after the fact, the
   2-day forecast still refreshes 4× per day).
2. **`/api/weather/species-heatmap` and `/api/weather/match-summary` —
   60-73 s and 32-67 s respectively**. Both queries did a full JOIN
   over 350 k detections × 23 k weather_hourly rows because no date
   floor was set when the client didn't pass `date_from`. Added an
   implicit 30-day window (matches the chart above on the page).
   Heatmap accepts `?days=N` (or `?days=0` for all-time).
3. **`loadAnalytics()` + `runSearch()` racing with `loadAll()` on
   mount**. better-sqlite3 is synchronous, so "parallel" client calls
   serialise on the server. Deferred the two non-critical loaders
   behind `requestIdleCallback` so the main 30-day chart paints first.

Also bumped `WEATHER_ANALYTICS_TTL` from 5 to 15 min — leaderboards
and heatmap don't shift meaningfully on minute scales.

## [1.55.4] — 2026-05-12

### Fixed — trash/restore roundtrip preserves Audio_Purged_At

Caught in Tier 2 audit. Before this fix: if a detection was
auto-purged (`Audio_Purged_At` set), then trashed via review.html,
then restored, the marker silently disappeared on the way back —
the row claimed audio was on disk while Caddy would 404 because
the MP3 was gone. Once the Phase 2b placeholder ships, this would
have produced a broken player instead of the "deleted" message.

Fix: `Audio_Purged_At INTEGER` added to `detections_trashed` (idempotent
ALTER), trash INSERT carries the value through, restore INSERT copies
it back.

## [1.55.3] — 2026-05-12

### Fixed — 5 residual bugs caught in post-ship audit

1. **`auto-purge.js`** — when `fs.unlinkSync` failed with anything
   other than ENOENT (EACCES, EBUSY, EIO), the row was still marked
   `Audio_Purged_At`. The UI would have hidden the player for a file
   that's still on disk. Fix: track a per-row `mp3Ok` flag and skip
   the row update if the live MP3 unlink errored.
2. **`auto-purge.js`** — `dryRun` was blocked when the toggle was
   off. That defeated the point of the "Simuler" button: the user
   wants to preview blast radius BEFORE opting in. Fix: dryRun
   bypasses the enabled gate.
3. **`auto-purge.js`** — calling `run-now` (real run) while disabled
   returned `{triggered:true}` and wrote misleading `last_run_*`
   timestamps to the state file, even though the background task
   no-op'd a second later. Fix: refuse synchronously with
   `{skipped:true, reason:'disabled'}` before kicking the
   background.
4. **`server/server.js`** — comment claimed `_autoPurge.start`
   "honours FULL_DISK=purge for back-compat", which became false
   in 1.55.2. Fix: doc drift.
5. **`settings/services.html`** — toggle wrapped in `<label
   class="set-switch">`, a class that doesn't exist in the CSS.
   Other settings toggles use a bare checkbox. Fix: match the
   existing pattern.

## [1.55.2] — 2026-05-12

### Fixed — don't auto-enable on FULL_DISK=purge (close-call avoidance)

Previous releases interpreted `FULL_DISK=purge` in birdnet.conf as an
opt-in signal for the new auto-purge. That conflated two different
semantics: `FULL_DISK=purge` historically meant "panic mode when the
disk is saturated", not "apply rolling retention proactively". On a
mature install (916 GB NVMe, 199 GB of BirdSongs going back to
2023-09-18), tonight's 03:00 cron with retention=90 would have
silently deleted ~150 GB of historical recordings.

Auto-purge is now always opt-in: the only enable switch is the UI
toggle (POST /api/settings/auto-purge {enabled:true}). Existing
installs keep `enabled=false` until the user opts in explicitly.

## [1.55.1] — 2026-05-12

### Added — auto-purge UI in Settings → Services (Phase 2)

- New section under "Gestion du disque": toggle, last-run summary
  (timestamp + clip count, with a red "panic" badge when triggered by
  disk pressure), and two buttons — "Simuler" (dry-run preview without
  touching the DB) and "Purger maintenant" (fire-and-forget; status
  auto-refreshes after 3 s).
- i18n strings added to fr, en, nl, de.

Audio-purged player placeholder is deferred to a Phase 2b ship — no
test data yet, and the touch points across 12 templates aren't worth
shipping blind. Bird's 03:00 cron tonight will produce the first real
`Audio_Purged_At` rows; the placeholder ships once we can validate
against them.

## [1.55.0] — 2026-05-12

Birdash takes over the audio auto-purge policy end-to-end (was a legacy
BirdNET-Pi shell cron that didn't exist on birdash-only installs). The
mickey 2026-05-12 incident — 18 GB of clips filled a 29 GB SD card in
3 weeks, ENOSPC corrupted git mid-fetch — wouldn't have happened with
this feature active.

### Added — `server/lib/auto-purge.js`

- Daily check during the 03:00 local hour (debounced 20 h), opt-in.
- Reads `AUDIO_RETENTION_DAYS` and `PURGE_THRESHOLD` from birdnet.conf
  if present; honours `FULL_DISK=purge` as the legacy opt-in signal so
  bird's existing config keeps working unchanged.
- **Always-on retention** (the real fix vs the legacy cron, which only
  triggered when disk > 95 %): deletes MP3s where `Date < today − N`
  every run.
- **Panic mode** when disk ≥ `PURGE_THRESHOLD`: halves the effective
  retention to claw space back fast.
- **Protected**: detections whose `Com_Name` is in the `favorites` table
  are skipped — user explicitly chose to keep those clips.
- **Stats preserved**: only the MP3 is unlinked; the detection row
  stays. New `Audio_Purged_At` column (unix timestamp) marks the row so
  the UI can show a placeholder instead of a broken player (UI work
  ships in Phase 2).

### Added — `/api/settings/auto-purge`

- `GET` returns merged config (`retention`, `threshold`, `enabled`) and
  last-run status (`last_run_at`, `last_run_count`, `last_run_mode`,
  disk before/after).
- `POST { enabled: boolean }` toggles the local opt-in override.
- `POST /run-now` triggers a one-off purge synchronously (supports
  `?dryRun=1`).

### Added — schema migration

- `detections.Audio_Purged_At INTEGER` (NULL = audio still on disk).
  Idempotent migration in both `server/lib/db.js` and `engine/db.py`.

### Added — `scripts/migrations/012-deprecate-cron-purge.sh`

- Removes the legacy `purge_audio.sh` cron entry on machines that have
  it (bird). The shell script itself stays in the repo for manual use,
  but birdash is now the only scheduler.

## [1.54.3] — 2026-05-12

### Fixed — stability worker conn lifecycle (16 h of dropped detections)

- `engine/stability.py` `worker_loop` opened one SQLite connection at
  startup and reused it across the polling `time.sleep(30)`. In WAL
  mode that pins a read snapshot through the sleep, blocks checkpoints,
  and the WAL grows unbounded. After ~36 h on bird.local the engine's
  own INSERTs started failing with `database is locked`; 16 h of
  detections (2026-05-11 17:32 → 2026-05-12 07:20) were dropped before
  recovery (`systemctl stop birdengine-stability` + `restart birdengine`
  to clear the engine's contaminated read snapshots).
- Fix: per-iteration open/close in a new `_drain_one` helper. Mirrors
  the pattern `enqueue_for_check` already uses on the producer side
  (proven safe). Perch model stays loaded across iterations; only the
  SQLite conn lifecycle changes.

## [1.54.2] — 2026-05-11

Prevention layer for the mickey 404 incident (commit e443422 fixed
migration 011's hardcoded /home/bjorn/ at runtime; this release makes
the regression impossible to reintroduce).

### Fixed — migrations 009 and 010

- 009-caddy-i18n-cache.sh and 010-caddy-vendor-cache.sh had the same
  hardcoded `/home/bjorn/birdash/public` pattern that broke mickey via
  011 v1. They didn't surface as a separate incident because 011 v2
  rewrites the whole Caddyfile from scratch — but on a fresh Pi install
  where 009/010 run before 011, the broken paths would have hit. Both
  now use the `DETECTED_HOME` extraction pattern.

### Added — migration lint in CI

- `scripts/lint-migrations.mjs`: static check that flags any literal
  `/home/<name>/` path in `scripts/migrations/*.sh`. Allowlist:
  comments, `$HOME` / `$DETECTED_HOME` references, regex character
  classes (`[^/]+`). Wired into `npm run lint:migrations` and the CI
  workflow.

### Added — migration sandbox tests

- `tests/migrations.test.js` + `tests/migrations-sandbox.sh`: end-to-end
  test that runs each `caddy-*` migration against a fixture Caddyfile
  with `root * /home/fake_user/birdash/public` and asserts (a) the
  migration substitutes `fake_user` into new file_server blocks, and
  (b) no `/home/bjorn/` leaks into the output. Also verifies the
  idempotency check (`already applied` on second run). Stubs sudo /
  caddy / systemctl onto PATH so the test runs unprivileged in CI.

## [1.54.1] — 2026-05-11

### Added — purge progress overlay

- `/api/purge/trash`, `/api/purge/restore`, `/api/purge/empty-trash` now
  stream per-row progress as Server-Sent Events when the client sends
  `Accept: text/event-stream`. Each frame is `data: {progress, total}\n\n`;
  the final frame is `data: {done: true, ...result}\n\n`. Plain JSON
  responses remain available for clients that don't request the stream
  (back-compat for curl + tests).
- Purge page shows a modal overlay with a progress bar + N/total counter
  for bulk trash / restore / empty-trash. Single-row actions still use
  the plain POST (instant, no overlay).
- Caddy's existing `flush_interval -1` on `/birds/api/*` passes the
  stream through unbuffered — no reverse-proxy changes required.

### Added — review bulk overlay

- review.html shows an indeterminate overlay during bulk-validate /
  reject-by-rule when the request takes more than 200 ms. SSE would
  not help here (server runs one SQL tx, no per-row work), so the
  overlay is a delayed-show spinner with a "{N} detections" caption.

### Removed — dead delete-modal code in review.html

- Deletion was moved to the Purge page in an earlier release but the
  delete-confirm modal, `deleteSelected` / `openDeleteModal` /
  `executeDelete` functions, and 5 i18n keys (`review_purge_title`,
  `review_purge_warning`, `review_deleted_count`, `review_delete_failed`,
  `review_delete_selection`) remained as orphans wired to no UI. Removed.
  review.html: 461 → 388 lines.

## [1.54.0] — 2026-05-11

Performance & perceived-latency pass following the 1.53.0 site-wide
audit. Twenty-one commits, ~10 files touched, no new user-visible
features — focused entirely on cutting the time between "user clicks"
and "useful content visible". Distinct from 1.53.0 (race-condition
fixes) and from 1.52.0 (SQL planner hints + WAL fix): this release is
about request volume, payload size, pre-aggregate adoption, and
loading UX.

Highlights, measured on the production DB (436 k detections):

  - Overview today KPIs:      13 s cold → 2 ms     (~6500×)
  - Rarities all-time KPIs:   515 ms     → 3 ms      (~170×)
  - Biodiversity matrix:      449 ms     → 1 ms      (~449×)
  - Species picker dropdown:  573 ms     → 0.4 ms    (~1400×)
  - favorites/stats endpoint: 2.5 s      → 35 ms     (~70×)
  - Timeline past-date load:  16-28 s    → 31 ms     (~700×)
  - /api/calendar/month JSON: 11.6 KB    → 2 KB      (5.9× via gzip)

### Added — performance infrastructure

- **Web Vitals tracking** (`bird-shared.js`). PerformanceObserver-based
  capture of FCP / LCP / CLS / TBT for every page navigation. Stored on
  `window.BIRDASH_VITALS` for live devtools inspection; final values
  also `console.log`'d on `visibilitychange` so they land in
  `system.html`'s logs view. Zero deps, ~0.5 ms cost at navigation
  start. This is the measurement layer the perf audit was missing —
  from now on every release can be compared against the previous on
  real numbers, not static estimates.

- **`useDelayedLoading` composable** (`bird-vue-core.js`). Wraps any
  loading ref with two thresholds: 300 ms before the spinner becomes
  visible (kills flicker on cache hits — fast paths finish before
  the loader ever appears) and 3 s before flagging the load as
  "slow" so callers can escalate the UI. Adopted on stats,
  biodiversity and analyses.

- **`useAbortableLoader` composable** + AbortController support in
  `birdQuery`. Pair the existing `_loadEpoch` race guards with a real
  AbortController so cancelled requests are torn down at the network
  layer instead of just ignored on arrival. Infrastructure ready;
  adoption deferred until a page with rapid filter changes actually
  needs it.

- **Slow-query log** in `/api/query` route. One-line `console.warn`
  for any SQL execution exceeding 500 ms — captures the SQL (truncated
  to 200 chars), bound params, and wall time. Surfaces hotspots
  empirically even when the SQL is dynamically generated.

### Changed — SQL hotspots migrated to pre-aggregates

- **`overview.html` today KPIs.** Replaced `COUNT/AVG over
  active_detections WHERE Date=today` (13 s cold thanks to the
  NOT EXISTS anti-join) with a sum over `daily_stats` (2 ms). The
  /api/query result cache used to hide the cold cost but every
  mutation cleared it, so the next overview load ate the full scan.
  Model count + lastHour stay as small companion queries on raw
  detections (narrow windows, idx_date_conf, sub-100 ms).

- **`rarities.html` KPIs.** Four queries with the same `SELECT COUNT(*)
  FROM (SELECT Com_Name FROM detections … GROUP BY Com_Name HAVING
  COUNT(*)<=?)` shape collapsed into single-row index lookups against
  `species_stats.count_07`. ~170× faster on the default all-time
  period. Non-default confidences fall through to the legacy query.

- **`biodiversity.html` species×month matrix.** The
  `CAST(SUBSTR(Date,6,2) AS INTEGER)` pattern defeated `idx_date_*` and
  scanned the full table on every refresh. `monthly_stats` already
  aggregates per (year_month, sci_name) with `count_07` — same matrix
  drops from 449 ms to 1 ms.

- **Species picker queries** in `bird-queries.js`
  (`allSpeciesNames`, `allCommonNames`, `speciesWithCounts`). All three
  used to DISTINCT/GROUP BY over raw detections; switched to
  `species_stats` (~150 rows, indexed by PK). The
  `speciesWithCounts(0.7)` fast path reads `count_07` directly. Picker
  dropdown opens in 0.4 ms instead of 573 ms. species.html's inline
  copies of the same query were migrated too.

- **`/api/favorites/stats` endpoint.** Two GROUP BY queries against
  active_detections (the view's anti-join was ~2.3 s of the total
  2.5 s) replaced by reads from species_stats (lifetime per fav) +
  daily_stats (today per fav) + one small detections query for
  last_time (the only field neither aggregate stores). 2.5 s → 35 ms.

- **`/api/timeline`.** Two-stage migration:
  1. Replaced `FROM active_detections` with `FROM detections` in all
     19 sites. The 24 rejected detections that exist across history
     are a negligible cost for editorial event picking, but the view's
     anti-join over 436 k rows was the dominant cost — 71 s cold for
     today and 16-28 s for past dates.
  2. The four heaviest historical scans (rare 365 d, foy YTD, return
     90 d, spike 30 d) further migrated to `daily_stats`. count_07
     means historical comparisons now sit at ≥ 0.7 — actually a
     better noise-vs-signal trade-off for rarity detection.

  Net: past-date timeline navigation is now ~700× faster
  (16-28 s → 31 ms).

### Changed — network: payload and cache headers

- **Caddy compression on `/birds/api/*`.** The reverse-proxy handle
  had no `encode` directive, so JSON payloads went uncompressed.
  Added `zstd gzip`. Measured 11.6 KB → 2 KB (5.9×) on
  /api/calendar/month; benefits every JSON endpoint at once.

- **`/birds/i18n/*` cached 1 hour.** Locale JSON files used to issue
  a conditional GET (304) on every page load — four roundtrips per
  page per session. They change once a release, so
  `Cache-Control: public, max-age=3600` cuts the request count by
  ~99% during a session.

- **Vendor JS libs cached 7 days.** `vue.global.prod.min.js`,
  `chart.umd.min.js`, `echarts.min.js`, `lucide*`, `leaflet*`, etc.
  totalled ~1.3 MB shared the catch-all's `public, no-cache`
  directive. Now served with `max-age=604800`; the SW cache-name
  bump on each release already forces a fresh re-fetch when the
  libs actually change. App JS (bird-shared, bird-vue-core, page
  HTML, app CSS) keeps `no-cache`.

- **Photo endpoint negative cache.** `/api/photo` already cached
  successful resolutions for 7 days, but every miss (species without
  a photo on iNaturalist or Wikipedia) re-ran the 2–5 s external
  cascade. A sibling `<key>.notfound` marker with a 7-day TTL now
  short-circuits subsequent misses to an instant 404 (with
  `Cache-Control: max-age=86400` so browsers cache it too). The
  marker is cleared the moment a photo does become available.

- **Service Worker stale-while-revalidate.** For endpoints whose past
  values are effectively immutable — `/api/species-info`,
  `/api/timeline?date=PAST`, `/api/calendar/month?to=PAST` — the SW
  now serves the cached copy instantly and refreshes the cache in the
  background. Revisits feel local-disk fast; today's data keeps
  network-only. SW cache name bumped to v249.

### Changed — perceived performance / loading UX

- **`system.html` no longer blanks 16 cards on every refresh.** Every
  `loadXxx` function used to start with `xxx.value.loading = true`,
  flipping the template to its spinner branch and removing the data
  block. With 16 cards + a 30 s polling timer, the entire System page
  went blank-then-back every ~30 s. Removed the `loading = true`
  assignment from all 16 load functions: each ref still initialises
  with `loading: true` so the very first mount shows the spinner, but
  subsequent refreshes leave the data visible and replace the ref
  value atomically when the fetch returns.

- **`weather.html` 30-day chart no longer DOM-thrashes on filter
  change.** The `v-if / v-else-if / v-else` chain removed the canvas
  from the DOM during loading and error states, forcing Chart.js to
  destroy and rebuild on every filter flip (~150 ms of flicker each).
  Wrapped the three states in a single `.chart-wrap-tall` with
  `v-show` on the canvas + absolutely-positioned overlays for
  spinner/error.

- **Stats, biodiversity, analyses: 5 bouncing-balls spinners now use
  `useDelayedLoading`.** The 300 ms threshold means fast paths
  (~35-80 ms post-1.54 perf wins) finish before the spinner ever
  appears.

- **Favorites star toggle is now optimistic.** The star flips
  synchronously before the network round-trip instead of after; the
  ~50-200 ms wait the user used to perceive is gone. The underlying
  `toggleFavorite` already has its own localStorage fallback +
  desync banner, so reverting on error would contradict that.

### Migrations

- `008-caddy-api-compression.sh` — adds `encode zstd gzip` on the
  /birds/api/* handle.
- `009-caddy-i18n-cache.sh` — adds a dedicated /birds/i18n/* handle
  with `Cache-Control: public, max-age=3600`.
- `010-caddy-vendor-cache.sh` — adds an `@vendor` matcher with
  `Cache-Control: public, max-age=604800`.

All three are idempotent, validate the Caddyfile before reloading,
and roll back from a `.before-NNN` backup on validation failure.

## [1.53.0] — 2026-05-11

Site-wide stabilization pass over every page in `public/`. Eighteen
audit commits, 42 files touched, ~98 distinct fixes — no new
user-visible features. Continuation of the 1.52.0 senior-auditor
sweep, but this time on the frontend instead of the server/DB.

The dominant pattern was **race-condition protection**: nearly every
page had at least one loader that could be re-entered (filter changes,
keyboard shortcuts, polling intervals, language switches) without any
guard, so a slow response from the previous call could land after a
fresh one and paint stale data into the now-displayed layout. Twenty-
plus pages got an explicit `_loadEpoch` counter that is captured at
the top of the loader and rechecked after each `await` before any ref
is written.

### Fixed — race conditions (the big one)

- **`species.html`** — `loadDetail()` spawned **10+ parallel
  queries** (stats, info, videos, 5 charts, feed, note, weather) and
  could be re-entered by URL param + last-species fallback, the
  picker, prev/next buttons, ←/→ keyboard shortcuts, `watch(lang)`,
  and post-delete reloads. Now every sub-loader takes an epoch and
  bails before writing. The single most impactful race fix of the
  sweep, because the page is the most reachable and the most
  navigated via keyboard.

- **Pages where filter changes raced their own loaders.**
  `today.html`, `overview.html`, `recordings.html`, `detections.html`,
  `timeline.html`, `purge.html`, `system.html` (`loadServices` polling
  vs. manual reload), `settings.html` orchestrator (`loadServices`),
  `rarities.html`, `favorites.html`, `calendar.html` (fast-path +
  legacy fallback), `phenology.html` (`reloadData` and `selectWeek`),
  `stats.html` (`loadAll` 6× + `loadModels`), `biodiversity.html`
  (`loadAll` 3×), `quality.html` (`load()` + Chart.js
  destroy/create), `analyses.html` (`loadAnalysis` 5×),
  `comparison.html`, `compare.html` (4+4 queries + 3 chart renders),
  `review.html`.

- **`calendar.html` `loadDayDetails` object-spread race.** Two
  concurrent calls each snapshotted `dayTopSpecies.value` before the
  spread; whichever resolved last would drop the entry written by the
  other. Replaced with a direct property mutation — Vue 3 deep
  reactivity catches it.

### Fixed — bugs (user-visible)

- **`detections.html` favorites-with-species filter was silently
  ignored.** `buildWhere`'s `favOnly` branch only emitted the
  favorites IN-clause when no other species/taxonomy filter was
  active. So `fGuild=raptors + favOnly` returned every raptor — not
  only the raptors among favorites. Refactored to compute
  `effectiveSpecies` as a true intersection (manual selection ∩
  taxonomy ∩ favorites ∩ new-species) before emitting one
  Com_Name IN clause (or `1=0` when the intersection is empty).

- **`rarities.html` rarity-threshold change did nothing.** The
  "≤ N detections" `<select>` had no `@change` handler and `fMaxDet`
  wasn't in any watch — the UI label changed but data stayed loaded
  with the old threshold until the user clicked Refresh. Added
  `@change="load"`.

- **`recordings.html` "Best recordings" view lied about top-3.** The
  view template iterated `group.dets[*]` as if there were multiple
  recordings per species, but the SQL returned one row per species
  (`GROUP BY Com_Name HAVING MAX(Confidence)`). Realigned to
  `group.best` everywhere and dropped the imaginary array.

- **`overview.html` "last hour" returned 0 across midnight.** The
  query `WHERE Date = today AND Time >= 23:30` excluded the hour
  before midnight when run after 00:30. Split into a two-query branch
  when the one-hour window crosses midnight.

- **`overview.html` listener leak.** A document-level click handler
  added on mount to close the rare-species panel was never removed.
  Capture the function reference and remove it in `onUnmounted`.

- **`timeline.html` popup tag `<span>` was missing its closing `>`.**
  HTML parser swallowed the `{{t('tl_tag_'+tag)}}` interpolation as a
  pseudo-attribute, so the tags never rendered when an event popup
  opened. Fixed.

- **`timeline.html` unreachable cluster modal.** `clusterPopup` ref
  was never assigned a non-null value anywhere; clusters are expanded
  inline into individual markers in `buildMarkers`, so the modal was
  dead code (~20 lines of template plus the ref). Removed.

- **`purge.html` URL species filter wasn't pre-filled.** `species.html`
  links to `purge.html?species=Robin`, but purge ignored
  `location.search` on mount, so the link looked broken. Now reads
  `?species=` and `?date=` and pre-fills the filters.

- **`purge.html` destructive endpoints surfaced no errors.** trash /
  restore / empty-trash called `await fetch(...)` then
  `Promise.all([load(), loadStats()])` without checking
  `response.ok`. A backend rejection (401, 500, …) looked like
  success to the user — particularly bad for `emptyTrash`. Now
  routed through a `postDestructive` helper that surfaces the
  error and refuses to reload.

- **`settings.html` "Notifications" duplicate card.** The
  Services-tab card kept three fields (title template, body template,
  per-species cooldown) that never got moved to the dedicated
  Notifications tab; the migration comment said the move was done
  but it wasn't. Completed the migration: fields moved to
  `settings/notif.html`, duplicate card removed from
  `settings/services.html` (−54 lines net).

- **`favorites.html` extra `loadFavorites` round-trip on every star
  click.** `removeFav` called `toggleFavorite()` followed by an
  explicit `loadFavorites()`, but `toggleFavorite` mutates the shared
  favorites ref which already fires `watch(favorites) →
  loadFavorites()`. So every click hit `/favorites/stats` twice.
  Removed the redundant call.

### Fixed — i18n / a11y / security

- **Hardcoded `'fr-BE'` locale in `system.html` timestamps.** Two
  timestamp formatters (services refreshAt, eBird fetchedAt) used a
  fixed locale instead of the user's UI language. Same fix on
  `audio.html` (noise-profile-recorded date). Now follow `lang`.

- **`system.html` `openUrl` allowed reverse tabnabbing.**
  `window.open(url, '_blank')` without `rel=noopener` leaks
  `window.opener` to the destination. Added `noopener,noreferrer`.

- **`rarities.html` SQL date concatenation.** `buildDateWhere` was
  string-concatenating `fp.dateFrom`/`dateTo` directly into the SQL
  alongside `?` placeholders for other values. Risk was low in
  practice (the dates come from `<input type="date">`) but the mixed
  pattern is wrong for a query layer. Now appends `?` placeholders
  and pushes the values into the caller's params array.

- **`species.html` species link, multiple pages.** Picker-style links
  that did `@click="navigateTo(...)"` instead of using a real `href`
  meant middle-click and keyboard activation didn't work and screen
  readers couldn't see the link target. Real hrefs on
  `today.html`, `overview.html`, `detections.html`, and the
  `<a class="species-link">` in `detections.html`.

- **Native `confirm()` left silently on destructive ops.** `purge.html`
  destructive endpoints still use native dialogs, but now have proper
  ok/error feedback and don't act on failure.

### Fixed — pages with race-relevant Chart.js

Pages that call `chartInstance.destroy()` before mounting a new chart
had a destroy-the-fresh-chart bug: a stale response landing after a
fresh one would invoke `destroy()` on the chart the fresh load just
built, leaving an empty canvas. Affected (and guarded with epochs):
`stats.html` (`loadModels` + Chart.js draw), `quality.html`
(`renderTimeline`), `comparison.html` (`renderChart`), `compare.html`
(three chart renders), `analyses.html` (polar / series / circadian
echarts and Chart.js mix).

### Changed — orchestrator hygiene

- **`settings.html` orchestrator return statement** — the template at
  the top of the file references **14 refs**; the return statement
  previously re-exposed **62**. Every tab sub-component already gets
  its state via `inject('settingsCtx')` provided once in the
  orchestrator, so the return-statement duplicates were inherited
  from the era when the template was monolithic. Trimmed to just
  what the orchestrator template reads. Net: −33 lines and a single
  source of truth.

- **Inline-style → CSS class extraction.** The toggle-on-active card
  pattern was duplicated across `settings/notif.html`,
  `settings/detection.html`, `settings/station.html`, and
  `settings.html` MQTT discovery — 10 sites with the same
  `:style="{borderColor: cond ? var(--accent) : var(--border), …}"`
  block. Now one `.set-toggle-card` + `.is-active` class with a
  proper CSS transition. Similar extractions for `.notif-rule`
  (audio + notif), `.audio-strategy-option`, `.fav-remove-btn`,
  `.ph-suggestion-btn`, `.sp-back-link`, `.sp-personal-note`,
  `.tl-date-input`, `.cmp-date-input`.

- **Inline event handlers → CSS pseudo-classes.** `onmouseover` /
  `onmouseout` / `onfocus` / `onfocusout` on
  `species.html`, `phenology.html` replaced with `:hover` and
  `:focus`. Drops a hostile-content surface (inline JS) and lets
  the browser handle the transition.

- **Dead-destructure cleanup.** The boilerplate
  `const { lang, t, setLang, langs } = useI18n(); const { theme,
  themes, setTheme } = useTheme(); const { navItems, siteName } =
  useNav(…);` returned a lot of refs that no page actually read —
  the shell handles theme/nav via its own provide/inject. Trimmed
  to `const { lang, t } = useI18n(); useTheme(); useNav(…);` on:
  `today`, `overview`, `recordings`, `detections`, `timeline`,
  `system`, `rarities`, `favorites`, `species`, `stats`,
  `biodiversity`, `analyses`, `spectrogram`. The bare calls are kept
  for their shell-side effects.

### Changed — code mort dropped

- `recordings.html`: `onPhotoError` (40 lines, superseded by
  `/api/photo`), `downloadAudio` (never called), `_photoFailed` Set,
  dead `imgSrc: null` field.
- `detections.html`: `deleteDet` stub (no template binding),
  `useAudio` + `playingFile/toggleAudio` (composable destructured
  but never wired).
- `today.html`: dead `quickValidate` function and `viewingDate` ref.
- `timeline.html`: the entire dead `clusterPopup` modal.
- `species.html`: `wikiSummaryAlt` ref (declared "second language
  summary", assigned only `''`, never read), duplicate `shortModel`
  in the setup return, `favorites` ref orphan.
- `favorites.html`: `sortBy` ref + `sortOptions` computed (left over
  from a pre-bucket refactor, no template binding).
- `bird-shared.js`: dead `fmtDate`/`fmtTime` and 9 unused imports of
  `bird-queries.js` across pages.

### Added

- **`.set-toggle-card`, `.notif-rule` (renamed → `.set-toggle-card`),
  `.audio-strategy-option`, `.fav-remove-btn`, `.ph-suggestion-btn`,
  `.sp-back-link`, `.sp-personal-note`, `.tl-date-input`,
  `.cmp-date-input`** — new CSS classes consolidating recurring
  inline-style patterns under settings, favorites, phenology,
  species, timeline, system. All include a proper `:hover` /
  `.is-active` transition where the inline version had none.

- **i18n keys** `purge_err_trash`, `purge_err_restore`,
  `purge_err_empty` in EN / FR / NL / DE for the new error feedback
  on the purge page.

## [1.52.1] — 2026-05-10

Hotfix for a chronic UX bug surfaced today: the spectrogram modal opened
from `recordings.html` ("best recordings" view) showed an empty canvas
for the top species pick. Root cause was a structural drift between DB
and disk that nobody had noticed before.

### Fixed

- **Empty spectrogram modal in the "best recordings" view.** The modal
  did `fetch()` on the audio file, hit a 404, logged a warning to the
  console, and left the canvas blank — the user got no signal anything
  was wrong. BirdNET-Pi prunes audio clips for disk space, but the
  matching `detections` rows persist forever; measured ~30 % orphan
  rate on April-May 2026 data. The `recordings.html` "best" query
  (`GROUP BY Com_Name + MAX(Confidence)`) was statistically guaranteed
  to land on these orphans for low-count species.

  Two-prong fix:
  - **Frontend** (`bird-spectro-modal.js`) — detects the 404 and shows
    a clear "Audio file not found" overlay instead of an empty canvas.
    Reuses the existing `audio_not_found` i18n key (FR/EN/DE/NL).
  - **Lazy backend** (`POST /api/recordings/clear-orphan`) — when the
    modal hits 404, it pings this endpoint so the dangling `File_Name`
    is cleared. Server independently verifies the file is missing on
    disk before mutating (path-traversal-safe via the same regex as
    `purge.js`), so a malicious or buggy client cannot nullify rows
    whose audio still exists. Each user click amortises the cleanup;
    cleared rows drop out of `File_Name != ''` queries on next load.
  - **Eager backend** (`engine._clear_orphan_filenames`) — a daily
    sweep in the engine main loop builds the on-disk filename set per
    date and clears `File_Name` on DB rows whose file is missing,
    catching orphans nobody clicks on. Skips today's date to avoid
    racing with active extraction. Batches `UPDATE`s by 500 to bound
    write-lock hold time under dawn-chorus contention. First pass
    runs ~5 min after engine startup so the historical backlog is
    cleared without waiting a full day.

## [1.52.0] — 2026-05-10

Stability and correctness pass following the 2026-05-09 WAL incident.
Twenty files touched, all targeted at long-standing latent bugs surfaced
during a senior-auditor sweep — no new user-visible features.

### Fixed

- **`birds.db-wal` runaway: 8.6 GB blocked all writes (2026-05-09).**
  Long-lived readers (birdash, the stability worker) prevented WAL
  checkpoints from completing for hours; the journal grew unbounded
  until SQLite returned "database is locked". Three structural changes:
  - `journal_size_limit = 64 MB` on every writer connection (engine,
    birdash, stability worker). Caps the WAL after each checkpoint.
  - `_wal_checkpoint(TRUNCATE)` runs from the engine main loop every
    ~15 min so a stuck reader is observable (`busy=1` logged) instead
    of silently growing the WAL.
  - `busy_timeout=60000` and matching pragmas on the stability worker's
    enqueue connection (was 10 s, lost writes during dawn-chorus
    contention).

- **Date helpers leaked UTC across timezone-sensitive code paths.**
  `Date.toISOString().slice(0, 10)` returns the UTC day; the codebase
  stores Brussels-local dates in `detections.Date`, so 10 callers were
  silently wrong between local midnight and ~02:00 (two hours of "today"
  attributed to yesterday in CEST). New helpers in
  `server/lib/local-date.js` (`localDateStr`, `localDateOffset`,
  `localTimeStr`) centralise the conversion. Updated callers: `metrics`,
  `notification-watcher`, `alerts`, `weekly-digest`, `quality`,
  `audio/_helpers`, `mqtt-publisher`, `telemetry`, `whats-new-worker`.
  Time-of-day variant (`slice(11, 19)`) fixed the same way in the
  notification and MQTT polling cutoffs.

- **Latent shell-injection in trash-directory cleanup.** `purge.js`
  `execSync`-ed an interpolated trash root path. Replaced with
  `spawnSync('find', […])` — argv array, no shell.

### Changed

- **Query planner hints on three hot queries.** Default plans were
  full-scanning a leaf-only index instead of using the date-prefixed
  composite. Measured on a 345k-row prod DB:

  | Query | Before | After | Hint |
  |---|---|---|---|
  | species 30 d (`metrics.js`) | 661 ms | 22 ms (30×) | `INDEXED BY idx_date_sci` |
  | throttle 7 d (`quality.js`) | 871 ms | 6 ms (145×) | `INDEXED BY idx_date_com` |
  | rarity cache (`notification-watcher.js`) | 552 ms | 129 ms (4×) | `INDEXED BY idx_date_sci` |

  Both bootstraps (`engine/db.py`, `server/lib/db.js`) now create the
  required composites; the hints fail loudly on a missing index rather
  than silently regress to the bad plan.

- **Cleaner index set on `detections`.** Three strict-duplicate indexes
  carried over from older BirdNET-Pi schemas (`detections_Sci_Name`,
  `detections_Com_Name`, `idx_date_sciname`) get dropped on engine boot.
  Frees ~50 MB and removes three B-tree updates per insert during
  dawn-chorus.

- **`PRAGMA optimize` runs hourly from the engine.** Keeps planner stats
  fresh without an explicit `ANALYZE`. Pre-fix `sqlite_stat1` was 2× over
  reality (727k rows recorded, 345k actual after purges) — the planner
  was making decisions on stats from indexes that no longer existed.

### Added

- **Timezone regression guard** (`tests/timezone-guard.test.js`). Static
  lint walks `server/` and fails CI on any new
  `toISOString().slice(0,10)`, `toISOString().split('T')[0]`, or
  `toISOString().slice(11,19)` outside the explicit allowlist. Plus
  functional tests under `TZ=Europe/Brussels` verifying the helpers
  cross midnight and DST correctly.

- **ARCHITECTURE.md — "Why two count columns" section.** Documents the
  `count` (≥0.5 noise floor, denominator) vs `count_07` (≥0.7 system
  default, what every UI reads) contract on the four pre-aggregated
  tables, including the threshold-fast-path / slow-path rule for
  consumers and the migration constraint.

- **Canonical-index docblock in `engine/db.py`.** Lists the five engine
  indexes plus the two birdash-side ones with their use cases, so the
  next person doesn't reintroduce a duplicate "just in case".

### Security

- **`ip-address` XSS** (GHSA-v2v4-37r5-5v8g, transitive via
  mqtt → socks). Bumped to 10.2.0 via `npm audit fix`; no API change.

- **`updates.js` `_git()` shell-injection contract.** The helper uses
  `execSync` and was being called with a SHA hundreds of lines from its
  regex validator. Added a comment-contract on the helper so the
  validation requirement is visible at the call site (no behaviour
  change — the SHA is already validated by `/^[0-9a-f]{7,40}$/` at the
  request boundary).

## [1.50.4] — 2026-05-04

### Fixed

- **"Unexpected token '', "" is not valid JSON" in the update modal.**
  When `config/update-progress.json` ended up corrupt or partially written
  (race with `update.sh` shell writes, crash mid-write, etc.),
  `safeConfig.updateConfig()` would `JSON.parse()` the existing body
  before writing the new state, the parse would throw, and the route
  serialised the error message back to the client where it surfaced as
  the modal's failure detail. The mutator was returning a fresh object
  anyway — the parse step was load-bearing for nothing.
  - New `opts.tolerateParseError` option in `server/lib/safe-config.js`:
    when set, a corrupt existing file is treated as missing (mutator runs
    against `defaultValue`, file gets overwritten with a clean state, a
    warning is logged). Strict parsing remains the default for user-data
    files (birdnet.conf, profiles, etc.).
  - `/api/apply-update` and `/api/rollback-update` opt in. The update
    state file is transient — repairing it on the next write is the
    correct behaviour. The user no longer sees an obscure JSON error
    when they just want to install or roll back.

## [1.50.3] — 2026-05-04

### Fixed

- **Setup wizard popping intermittently on already-configured installs.**
  Three reinforcing changes:
  - Ship the `setup-completed.json` backfill that was sitting uncommitted
    on bird.local. Pis without the flag (mickey, biloute, anything set up
    before 1.43) now get auto-marked as completed on the first
    `/api/setup/status` call after pull.
  - Backfill triggers as soon as **location** is set (lat/lon ≠ 0,0). The
    old gate also required audio_config.json with a `device_id`, which
    legacy installs running off `birdnet.conf` REC_CARD don't have, so
    the backfill never fired and the wizard kept popping.
  - `detectGaps()` now treats a non-empty `REC_CARD` in birdnet.conf as a
    valid audio configuration. Modern installs (audio_config.json) and
    legacy installs (REC_CARD only) both register as "audio configured".
  - **Auto-pop rule tightened to `!flag && gaps.location`.** Mere flag
    absence is no longer enough — the install must also have lat/lon=0,0
    (the wizard's primary purpose). Anything else stays `needed: false`,
    so transient config-read hiccups during a service restart no longer
    surface the modal on a healthy install. Settings still surfaces gaps
    as warnings.

## [1.50.2] — 2026-05-04

### Added

- **Bbox technical info bar in the spectrogram modal.** Below the species
  meta row, a discrete chip strip now surfaces the data already stored in
  `detection_bbox_v1` + `detection_stability_v1`: duration of the energy
  window (ms), frequency band (kHz), peak time, estimated SNR, plus
  colored badges for `truncated` (orange — call extends past clip
  boundary), `stable` / `unstable` / `inconclusive` (Phase 2 verdict
  with recentered confidence and ratio). Tooltips on every chip explain
  the metric in plain language. Fully translated (fr/en/de/nl).
- **Truncated + stability badges on `review.html` cards.** Next to the
  existing reasons row, each card now shows an orange `truncated` chip
  when the bbox flag is set, and a green `stable` / grey `inconclusive`
  chip when Phase 2 has decided. The `unstable` badge is intentionally
  not duplicated here — it already appears as the `recentering_unstable`
  reason. Useful when a detection is flagged for one rule but Phase 2
  still confirms it (high signal that the bird is real).

### Changed

- `/api/detections/bbox` now LEFT JOINs `detection_stability_v1` so a
  single fetch from the modal serves both the visual overlay and the
  info bar (no extra round-trip).
- `/api/flagged-detections` rows include `truncated` (0/1) and
  `stability_status` (`stable` / `unstable` / `inconclusive` / `null`)
  so card-level badges can render without follow-up queries.

## [1.50.1] — 2026-05-04

### Fixed

- **`/api/flagged-detections` was silently dropping morning detections
  on busy days.** The endpoint applied `LIMIT ?` (capped at 2000) at SQL
  level *before* running the flagging rules, so on days with > 2000
  detections (most spring days easily clear 4000) any flagged hit from
  the early hours was invisible to `review.html`, `dashboard.html`, and
  the menu badge in `bird-vue-core.js`. Scan now covers the entire date
  range; the user-supplied `limit` applies after JS-side filtering, so
  callers still get ≤ limit results but those results are drawn from
  the full range. Response gains a `returned` field next to `total`
  so the UI can show "showing 500 of 1247 flagged" accurately. Surfaced
  while validating Phase 2 stability checks — two morning unstable
  flags from May 2 weren't appearing despite being in the database.

## [1.50.0] — 2026-05-04

### Added

- **Detection Refinement — Phase 2: stability check worker.** A new
  background service `birdengine-stability.service` that recenters a
  5 s window on the bbox peak from Phase 1 and re-runs Perch to test
  whether the model's confidence holds up. Detections that lose
  > 50 % confidence on recentering get tagged `unstable` — the original
  window probably caught the wrong signal, or the model was leaning on
  context outside the actual vocalization. Disabled by default; opt-in
  via `[stability_check] enabled = true` in `engine/config.toml`.
  Surfaces in the existing flagged-detection paths via a new
  `recentering_unstable` rule in `config/detection_rules.json` —
  zero new client UI. New tables `detection_stability_v1` (results)
  and `stability_queue` (pending work) live alongside `detection_bbox_v1`
  in `birds.db`. CLI mode `python stability.py --once <file>` for
  smoke-testing without DB writes. Inference time on Pi 5: 1.5–9 s
  per check (Perch warmup is the only ~10 s outlier).

## [1.49.1] — 2026-05-04

### Added

- **Detection Refinement — Phase 1.5: per-family bands + quality filters.**
  The bbox heuristic now applies a `FAMILY_BANDS` lookup *before* the
  ORDER fallback — corvids (Corvus, Pica, …) are Passeriformes by
  taxonomy but vocalize at 200–3000 Hz, well below the 1000–8000 Hz
  Passeriformes default, which produced misleading bboxes (Phase 0
  cases 0078, 0120). Two new post-bbox filters reject suspect outputs
  before write: `SNR < 2.0` (case 0045: peak-vs-mean barely above the
  noise floor, bbox is just bruit) and `truncated AND width < 0.3 s`
  (case 0120: clip-edge artifact). Algorithm version bumped to
  `heuristic_v1_1`; both `engine/bbox.py` (live) and the offline
  `scripts/refinement/backfill_bbox.py` switched to UPSERT
  (`ON CONFLICT(file_name) DO UPDATE`) so a re-run of the backfill
  upgrades existing rows in place — no separate migration needed.
  The backfill also now `DELETE`s pre-existing rows when the new
  algorithm rejects, so stale `heuristic_v1` bboxes don't survive
  silently when the new filter says no.

## [1.49.0] — 2026-05-04

### Added

- **Detection Refinement — Phase 1C: live bbox at detection time.**
  The post-process daemon thread now computes a heuristic bbox from
  each just-extracted MP3 and INSERTs into `detection_bbox_v1`, so new
  detections land with a bbox immediately instead of waiting on a
  periodic backfill. Mirrors `scripts/refinement/backfill_bbox.py`
  verbatim (same SciPy peak + half-energy widening, same ORDER → band
  lookup) under `algorithm_version='heuristic_v1'` so live and historical
  rows stay schema-compatible. Errors swallowed at warning level — a
  bbox failure must never poison the inference pipeline.

## [1.48.0] — 2026-05-03

### Added

- **Detection Refinement — Phase 1B: bbox overlay on spectrograms.**
  Every spectrogram in the dashboard (today.html cards, full-screen
  modal opened from any thumbnail, future review.html) now overlays
  an amber dashed rectangle on the area where the heuristic localized
  the detected vocalization. Fetched on demand from
  `/api/detections/bbox?file=<File_Name>`, painted directly on the
  canvas (Vue 3's vdom strips non-Vue siblings, so SVG overlays would
  vanish on every redraw — canvas paint is immune). Toggle button on
  the modal lets the user hide/show; preference persists in
  `localStorage` (`birdash:showBbox`). Service worker cache version
  bumped so clients pick up the new JS without a manual hard reload.
  4-locale i18n (`bbox_on`, `bbox_off`, `bbox_toggle_title` in fr/en/nl/de).

## [1.47.2] — 2026-05-03

### Added

- **BirdWeather upload threshold.** New `BIRDWEATHER_MIN_CONFIDENCE`
  setting (Settings → Station → BirdWeather, only visible once a
  Station ID is configured) — a confidence floor that applies
  *only* to the BirdWeather upload, not to the local database. A
  detection below the threshold is still stored, still notified,
  still shown in the dashboard, but is silently dropped from the
  upload payload (and the soundscape itself is skipped if no
  detection clears the bar). Lets you keep an aggressive Perch
  threshold locally without pushing low-confidence calls to your
  public BirdWeather feed. Default empty/0 = disabled, same
  behaviour as before. Engine reads `birdnet.conf` on every upload
  so the value is hot-reloadable without a restart.

## [1.47.1] — 2026-05-02

### Added

- **Audio cleaning in the spectrogram modal.** The full-screen
  spectrogram (opened from any thumbnail across the app) now exposes
  the same *Nettoyer le son* control that already lives on the inline
  player in `today.html`: highpass + spectral subtraction with a
  0.2→1.0 strength slider, a green "✨ CLEAN" badge on the canvas
  while active, and the cleaned signal feeds both the redrawn
  spectrogram and audio playback (the existing gain/HP/LP filter
  chain keeps applying on top). Reverting the toggle restores the
  untouched PCM without a re-fetch.

## [1.47.0] — 2026-04-29

### Added

- **Detection profiles.** Named bundles of the nine detection-tuning
  parameters — BirdNET / Perch confidence + margin, dual-confirm
  thresholds, sensitivity, overlap, sf_thresh — selectable from a
  dropdown at the top of Settings → Detection. Three built-ins ship
  out of the box (*Permissif*, *Balancé*, *Rigoureux*); save the
  current form as a custom profile via "Sauvegarder l'actuel sous…",
  delete custom profiles, builtins are protected. Loading a profile
  fills the form in memory, the user still clicks Save to persist
  into `birdnet.conf` (same staged-edit pattern as the existing
  Reset-defaults button — protects against accidental writes during
  exploratory tweaking). The "active profile" label tracks dirty
  state and shows "(modifié)" as soon as any of the nine fields
  drifts from the loaded values, so it's obvious when the saved
  profile no longer reflects what's in the form.

  - Storage: `config/detection-profiles.json`, atomic writes via
    `safe-config.writeRaw`. Server reuses `SETTINGS_VALIDATORS` so
    invalid values are rejected at the same boundary as direct
    settings POSTs.
  - Endpoints: `GET /api/detection-profiles`,
    `POST /api/detection-profiles` (create/overwrite custom),
    `POST /api/detection-profiles/apply` (mark active),
    `DELETE /api/detection-profiles/:id` (custom only — 409 on builtin).
  - i18n: 14 new `set_profile_*` keys symmetric across fr/en/nl/de.
  - Tests: `tests/e2e/detection-profiles.spec.js` covers list, save,
    apply, delete, builtin-protection, invalid-value rejection, and
    a UI flow loading the *Rigoureux* preset.

  Why: after extended manual calibration the sweet-spot settings
  were a single Reset-defaults click away from being lost, with no
  named alternative for A/B comparison. Profiles let the user keep
  their tuned config safe and switch presets to evaluate trade-offs
  without re-typing nine numbers.

## [1.46.4] — 2026-04-28

### Fixed

- **Backup DB step was silently no-oping for weeks.** `scripts/backup.sh`
  iterated over hardcoded paths under `$HOME/birdash/engine/scripts/`
  (`birds.db`, `detections.db`, `flickr.db`) — none of which exist
  on a current install. The for-loop's `[ -f "$db" ]` filter quietly
  produced an empty `DB_LIST`, the script logged "Databases OK" in
  one second, and no actual `.backup` ever ran. On the affected
  station the on-NFS `birds.db` was a month stale before the audit
  caught it. The DB step now targets the real paths
  (`$HOME/BirdNET-Pi/scripts/birds.db`, `$BIRDASH_DIR/birdash.db`,
  `$BIRDASH_DIR/config/taxonomy.db`), warns when any expected DB
  is missing, and aborts the step (not the run) if `DB_LIST` ends
  up empty — so the silent failure mode can never come back.

- **Backup projects step had no rsync excludes**, so it would
  faithfully sync `node_modules/`, `photo-cache/`, `data/cleanup-backup/`,
  `test-results/`, log files, and SQLite WAL/journal sidecars to
  the backup destination. On one station an old `data/cleanup-backup/`
  dump had grown to 243 GB and turned each "projects" step into a
  multi-day rsync — the daily cron then cascaded into flock-blocked
  runs. Added a curated exclude list so the projects step transfers
  only the source code and config that actually need backing up.

### Added

- **Optional nightly window mode** for slow uplinks. New
  `scripts/backup-window-start.sh` (SIGCONT a paused backup or
  launch a fresh one) and `scripts/backup-window-stop.sh` (SIGSTOP
  the running rsync, mark status as `paused`). Pair them in cron
  (e.g. `0 22` start / `0 5` stop) when the first full sync over
  a slow link would otherwise exceed 24 h and cascade into
  flock-blocked daily runs. `rsync --partial` (already in the
  script) plus SIGSTOP/SIGCONT preserve in-flight state so the
  same first sync can span multiple nights without re-scanning.
  Set `backup.json` `schedule` to `"manual"` so the UI cron
  manager doesn't compete with the window crons (the window
  crons use a distinct `# BIRDASH_BACKUP_WINDOW` tag).

## [1.46.3] — 2026-04-27

### Improved

- Service modal start/stop/restart now show visible feedback during
  the operation. While the action runs, the three buttons are
  disabled and a status banner with a mini spinner appears below
  ("Démarrage en cours…", "Redémarrage en cours…"). On success, the
  banner switches to a green "✓ Service redémarré" toast that
  fades after 3 seconds. Previously the buttons fired silently and
  there was no way to tell whether anything had happened.

  For birdash self-restart, the deferred response (1.46.2) now
  triggers a polling loop on `/services/birdash/status` that waits
  up to 30s for the service to come back active before declaring
  success. This means the UI accurately reflects when birdash has
  actually finished restarting, not just when systemctl was kicked
  off.

i18n FR/EN/DE/NL · SW v238 → v239

## [1.46.2] — 2026-04-27

### Fixed

- Birdash self-restart actually works now. 1.46.1 fixed the route
  regex but the deeper bug remained: `await execCmd('sudo
  systemctl restart birdash')` killed the running birdash process
  before the HTTP response could flush — the client saw a
  connection drop on every restart attempt, and stop+start was
  unreachable because nothing was alive to receive the start.
  When the target is birdash itself (restart or stop), respond
  200 immediately, then spawn `systemctl` detached after a 200ms
  delay so the child outlives the parent. Other services keep
  the synchronous behavior.

## [1.46.1] — 2026-04-27

### Fixed

- Service restart from system.html now works. The UI was sending
  `POST /api/services/{name}/restart` but the server route regex
  only matched `start|stop` — the request fell through to "Route
  inconnue". Added `restart` to the regex; systemctl already
  accepts the verb so no other change was needed. The legacy
  `POST /api/services/restart` endpoint stays in place because
  settings.html still uses it for config-change reloads.

## [1.46.0] — 2026-04-27

### Species videos — Wikimedia Commons integration

A new "Vidéos" mini-thumb appears alongside the photo thumbnails on
species.html when Wikimedia Commons has matching footage. Click opens
a modal with up to 4 videos in a 2×2 grid, click-to-play (poster
first, then native player), with attribution and license per clip.

POC measured 99% coverage on the top-100 detected species, with ~3.6
videos available per species on average — solid enough to ship.

**Server** — new `/api/species-videos?sci=X` endpoint proxying
Wikimedia Commons (search + imageinfo). Metadata-only disk cache
with 30-day TTL, mirroring the photos cache pattern. No video
blobs cached server-side; everything streams from Commons CDN at
playback time. Click-to-play means the page costs nothing in
bandwidth until a user actually opens the modal.

**UI** — bouton-miniature 56×56 integrated in `.sp-thumbs` row
(only renders when videos exist; row also renders for single-photo
species so the button has a home). Modal capped at 4 videos, no
"Voir plus" — bonus content, not primary content.

**i18n** — 3 new keys × 4 languages (FR/EN/DE/NL).

**Internal** — `public/video-poc.html` retained as a coverage-scan
tool: select an espèce to preview the modal in isolation, or run a
batch scan over the top-N species to measure Wikimedia coverage
after taxonomy changes.

## [1.45.0] — 2026-04-26

### UX refactor pass — phased multi-page orchestration

Eight pages went through the same workflow: diagnostic → A→D
cadrage → ship phase → "let it rest, observe usage" closure.
The discipline was to ship narrow, high-leverage gestures rather
than open broad refactors, and to recognize when a page no longer
needed work. Phases tagged "optional" stayed dormant when phase 1
already cleared the friction.

No data, query, or schema changes — pure HTML/CSS/JS reorganization
plus a few targeted i18n cleanups for orphan keys.

**today.html** — workspace breathing, lighter sidebar, compact left
list with index hierarchy by glance (count = scan signal). Filter
pills + per-row badges + density level 2. Final polish: row
micro-detail (tiered count, hover-only ★, quieter time), workspace
breathing + active-detection row distinct.

**dashboard.html** — Phase 1 live cœur (pipeline transit + IA states
+ mic respiration). Phase 2 événementialisation (last det + events +
KPI). Phase 3 strict reduced-motion accord. Pipeline pulse +
analyzing presence calmed to "presence, not spectacle".

**calendar.html** — Phase 1 hierarchy + clean borders + intensity
legend. Phase 2 mini-panneau jour sélectionné persistant. Phase 3
hover/transitions/navigation polish + reduced-motion. Anti-flicker
fix on day transitions.

**timeline.html** — Phase 1 density layer in main frise (vérité
visuelle). Phase 2 rename list to "Moments marquants" + counter X/Y.
Phase 3 toggle Moments marquants / Toutes détections. Phase 4
suppression of the redundant density bar above the frise (drag-to-zoom
already lives on `.tp-scroll`). Density floor calibration. Raw points
gated by zoom (24h view = synthesis, zoom = inspection).

**detections.html** — Phase 1 filter panel hierarchy (3 groups +
clean Apply/Reset). Phase 2 chips de filtres actifs au-dessus du
tableau. Phase 2.5 (pivot during review) auto-apply everywhere,
suppression of the Apply button + sync watcher pattern with
suppression flag. Phase 3 row signals (★ favoris, ✨ nouvelles,
pastille modèle).

**species.html** — Phase 1 hiérarchie visuelle des graphes. Activity
by hour promoted to full-width hero (`chart-wrap-hero` 360px) as
premier rôle. Heatmap day×hour reads as natural extension. Monthly
/ 30d / Confidence collapse into a `.grid-3` secondary row. Phases
2–3 dormant — Phase 1 cleared the friction.

**rarities.html** — Phase 1 supprimer le card "Vues une seule fois"
du haut (duplication fonctionnelle avec `tableFilter='once'`).
"Dernières détections rares" full-width premier rôle. KPI 'once'
rebrancher pour piloter la table. Bonus : harmonisation des handlers
KPI (corrige un bug latent où le KPI 'new' highlightait 'rare').

**comparison.html** — Phase 1 évolution inter-annuelle promue en
premier rôle (full-width 320px) — c'est elle qui répond à "comment
cette saison se situe sur la durée". Arrivées/Départs reste en
grid-2 (binôme YoY). Best days sorti du récit principal en bande
inline discrète (label uppercase + chips), forme-fonction enfin
alignées avec sa nature de raccourci de navigation.

### Cleanups

- `i18n` orphan keys removed (4 langs each):
  - `tl_density_label`, `tl_drag_hint` (timeline density bar suppr.)
  - `rarity_show_all` (rarities once-card suppr.)
- Service worker bumped 8× through the series (v208 → v216).
- New CSS utilities: `.grid-3`, `.chart-wrap-hero`.
- Dead code removed: `buildDensityBar` inline (timeline),
  `loadOnce` + `once` ref + `onceSection` (rarities). Note:
  `bird-timeline.js` still exports a `buildDensityBar` that is
  unused anywhere — left for a future cleanup pass, out of scope.

## [1.44.0] — 2026-04-23

### Feat: Quality page Phase B — engine instrumentation

Engine now persists 5 quality counters into a new `quality_events`
table (date+hour bucketed). The Quality page's pre-filter card flips
from "not instrumented" placeholder to real numbers, with the green
`measured` badge.

Counters wired in `engine/engine.py` (definitions in
`docs/QUALITY_METRICS.md`):

- `privacy_dropped` — files skipped because YAMNet voice ≥ threshold
- `dog_dropped` — files skipped because YAMNet bark ≥ threshold
- `dog_cooldown_skipped` — files skipped because we're inside a
  bark-cooldown window from a prior file
- `throttle_dropped` — detections suppressed by the noisy-species
  throttle (was already an in-memory `_throttle_dropped` counter,
  now persisted)
- `files_processed` — successful `process_file()` completions, used
  as the denominator for filter rates

Persistence pattern: in-memory `defaultdict(int)` accumulator with a
threading lock; flushed every 5 min from the existing periodic loop
in `run()` AND once more on shutdown. UPSERT with addition merges
flushes that land in the same hour bucket — survives restarts at
hour boundaries cleanly.

### ⚠ Known gap surfaced: cross-confirm rule documented but not implemented

While wiring Phase B, found that the cross-confirm rule advertised
in v1.38.0 (`DUAL_CONFIRM_ENABLED`, `PERCH_STANDALONE_CONFIDENCE`,
`BIRDNET_ECHO_CONFIDENCE`) has docs, settings UI, config validators,
i18n — but **the engine never reads those keys and never runs the
rule**. Commit e79e909 shipped the documentation/UI half without the
matching `engine.py` change.

Rather than fake a counter for a rule that doesn't run, the Quality
page's pre-filter card surfaces this honestly: `cross_confirm_rejected`
stays `null` and the row says "Known gap — cross-confirm logic
documented but never wired into the engine inference loop". Fixing
the rule itself is its own backlog item.

### Schema

- New `quality_events` table:
  ```sql
  CREATE TABLE quality_events (
    Date TEXT, Hour INTEGER,
    cross_confirm_rejected INTEGER DEFAULT 0,
    privacy_dropped INTEGER DEFAULT 0,
    dog_dropped INTEGER DEFAULT 0,
    dog_cooldown_skipped INTEGER DEFAULT 0,
    throttle_dropped INTEGER DEFAULT 0,
    files_processed INTEGER DEFAULT 0,
    PRIMARY KEY (Date, Hour)
  );
  ```
- Idempotent migration in both `engine/db.py` (engine boot) and
  `server/lib/db.js` (birdash boot, deferred-retry pattern). Either
  can create the table, the other no-ops.
- New `upsert_quality_events()` helper in `engine/db.py` that adds
  to existing counts on conflict.

### Frontend

- Pre-filter card now shows real numbers when `quality_events` has
  data, with per-counter rate as a percentage of total file decisions
  (processed + privacy + dog).
- Throttle card gets a `measured` badge with the engine's exact
  count when available, alongside the existing inferred 7d-vs-30d
  delta. Both surfaces cohabit so the user can compare.
- New `quality_source_measured` badge style (deeper green than
  `observed`) so the user reads "measured" as "ground truth" vs
  "computed-from-DB-rows".

i18n: 10 new keys × 4 langs.

## [1.43.0] — 2026-04-23

### Feat: Detection Quality page (Phase A)

New `Indicators → Quality` section that surfaces the reliability of
the inference chain. **Phase A**: read-only, computed from what's
already in the DB. **Phase B** (engine instrumentation, see
`docs/QUALITY_METRICS.md`) is gated on the spec staying authoritative.

The deliberate design call here is that there is **no single composite
"trust score"**. A 0-100 number gives the appearance of mastery
without informing decisions; 5 well-chosen cards each tell a
mechanism-specific story instead.

Page layout (top to bottom, ordered by actionability):

1. **Human review** (observed) — confirmed / doubtful / rejected /
   unreviewed split as a stacked bar, with a `→ Open Review page`
   link when the unreviewed count > 0. The page that turns the
   highest-leverage signal into an action.
2. **Cross-model agreement** (observed) — for each species, the
   share of Perch detections that also have a BirdNET detection of
   the same `Sci_Name` within ±3 s. Volume guard at 20 Perch hits
   minimum so low-sample species don't dominate. Mini-bar + sample
   size shown alongside every percentage.
3. **Pre-analysis filter impact** — placeholder card with a
   "not instrumented" badge. The structure is locked so Phase B
   drops in real numbers without changing the UI.
4. **Throttle effect** (inferred) — when `NOISY_THROTTLE_ENABLED=1`,
   shows the 5 noisiest species' last-7d rate vs prior-30d rate.
   Negative delta = damping ; positive = species genuinely more
   vocal.
5. **Daily volume by model** (observed) — stacked bar chart of
   detections per day, BirdNET vs Perch.

Honest labelling: every card carries a coloured `source` badge —
green/observed, amber/inferred, grey/not_instrumented (and Phase B
will add green/measured). The user always knows whether a number
reflects something the engine watched happen, or our reconstruction
after the fact.

`docs/QUALITY_METRICS.md` is the semantic spec for every counter
(when it increments, what it counts, what it doesn't, restart
behaviour). Phase B can't ship until any new counter has an entry
there.

i18n: 22 keys × 4 languages. Backend: new
`GET /api/quality?days=N&min_volume=N` route in `server/routes/quality.js`.

## [1.42.0] — 2026-04-23

### Feat: Purge page — single safe place to delete detections

`Réglages → Purge` (new entry under the System nav section) is now the
**only** UI for deleting detections + their MP3/spectrogram files. The
previous scattered delete buttons (per-row trash on `detections.html`,
bulk delete on `review.html`, delete-mode on `species.html`) have been
removed and replaced with `Manage in Purge →` shortcuts that pre-filter
the species.

Soft-delete with 90 d safety net:
- Trash action moves the row from `detections` to `detections_trashed`
  (same shape + `trashed_at` + `original_path`) AND mv's mp3/.png from
  `~/BirdSongs/Extracted/By_Date/<date>/<sp>/` to
  `~/BirdSongs/Trashed/By_Date/<date>/<sp>/` — same filesystem so it's
  an instant rename, no extra disk used during the move.
- Restore is the symmetric operation.
- A nightly cron hard-purges entries older than
  `BIRDASH_TRASH_RETENTION_DAYS` (default 90 d) + rm files. Idempotent.
- Each trash row shows a `⏰ Permanent removal in N d` countdown.

UI highlights (`public/purge.html`):
- Sticky filter bar: species autocomplete (matches active + trash
  combined), date range, confidence min/max, model substring,
  pagination size (10/50/100).
- Tabs: **Active** vs **Trash** with live counts in the badges.
- Each row: checkbox + 240×80 inline spectrogram PNG (Caddy-served for
  active rows, birdash-served for trash via `/api/purge/file`) + click
  → opens the existing `<spectro-modal>` with audio + filters/gain.
- Bulk actions: select-all-visible toggle, "Move to trash (N)" /
  "Restore (N)", "Empty trash" (requires typing `EMPTY` to confirm).
- Per-row trash/restore buttons for one-off cleanups.

Backend:
- `server/routes/purge.js` ships 6 endpoints: `GET /stats`, `GET /list`
  (filterable + paginated), `GET /species` (autocomplete), `GET /file`
  (serves trashed mp3/png — Caddy doesn't know about `Trashed/`),
  `POST /trash`, `POST /restore`, `POST /empty-trash`.
- New `detections_trashed` table created via deferred-retry on boot
  (CREATE TABLE wants an EXCLUSIVE lock — during dawn chorus the
  Python engine writes detections continuously and the 30 s
  busy_timeout was expiring before a free window opened, crashing
  birdash boot. The migration now retries every 30 s for up to
  30 min in the background after the server is listening).
- Daily retention cron wired into `server.js` startup with a 1 min
  initial delay.

Other pages:
- `detections.html`: per-row trash button removed; `deleteDet()`
  shortcut handler now redirects to `purge.html?species=<comName>`.
- `review.html`: kept the validation workflow (confirm / doubtful /
  reject + reject-by-rule), removed the bulk-delete + purge-rejected
  buttons. Replaced with a `Manage in Purge ({rejectedCount}) →`
  link that surfaces only when there's something to act on.
- `species.html`: removed the `Manage` modal trigger + delete-mode
  toggle. Kept the species notes + per-detection notes (those aren't
  destructive). Manage button now links to the species-filtered Purge
  page.

i18n: 27 new keys × 4 langs (fr/en/de/nl), all in parity.

## [1.41.0] — 2026-04-23

### Feat: multi-source audio P1 — Source column + recursive incoming watcher

Foundation for the upcoming multi-source feature (capture from multiple
mics in parallel, e.g. garden + feeder + nestbox). P1 ships the
infrastructure only — no UI yet, no supervisor — so existing single-mic
installs see zero behaviour change while the engine is ready to accept
per-source captures.

What changed:

- **Schema**: `detections.Source TEXT` column added. Idempotent
  migration runs in both `engine/db.py` (`init_db`) and
  `server/lib/db.js` (boot-time check via `PRAGMA table_info`). Existing
  rows stay `NULL`, treated as "legacy / single-source".
- **Engine**: `process_file()` now derives a source key from the
  recording's path relative to the incoming root —
  `incoming/foo.wav` → `None`, `incoming/garden/foo.wav` → `'garden'`.
  Source is passed through `_analyze_with_model` into each detection
  dict and lands in the new column.
- **Watcher** is now recursive (`recursive=True`). Per-source subdirs
  (`incoming/garden/`, `incoming/feeder/`) are picked up automatically
  the moment they exist. Files dropped directly in `incoming/` keep
  working unchanged.
- **Processed dir** mirrors the source: `processed/garden/foo.wav`
  instead of `processed/foo.wav` when source is set. Avoids basename
  collisions when two sources happen to rotate at the same second.
- **Startup file scan** + `_purge_processed` now use `os.walk` so
  per-source subdirs are handled identically to the legacy flat layout.
- **Secondary worker** queue items are 6-tuples now (added trailing
  source key). 5-tuple items from the rolling restart are still
  tolerated for one cycle.

Tests: 12/12 (added `test_source_persisted` + idempotent-migration test
that builds an old schema by hand and verifies init_db ALTERs it
without losing data).

To use multi-source manually right now: `mkdir incoming/garden`, point a
second `arecord` at it, restart the engine. P2 will ship a supervisor
that does this from a config file; P3-P4 will add the Settings UI and
filter widgets.

## [1.40.0] — 2026-04-22

### Refactor: engine.py split into focused modules

`engine/engine.py` had grown to **1631 lines** mixing audio I/O, model wrappers, SQLite, the watcher, BirdWeather upload, clip extraction, and the actual BirdEngine orchestrator. Hard to navigate, hard to review, hard to test in isolation.

Split into seven files (behaviour byte-identical, code moved not modified):

| File | Lines | Concern |
|---|---|---|
| `engine/engine.py` | 850 | `BirdEngine` class + `main()` + re-exports |
| `engine/audio.py` | 266 | `read_audio` · sound-level monitor · adaptive gain · audio_config + filter pipeline · `split_signal` |
| `engine/models.py` | 281 | TFLite wrappers (`MDataModel`, `BirdNETv1Model`, `BirdNETModel`, `PerchModel`) + `load_labels` / `load_language` / `get_model` factory |
| `engine/clips.py` | 137 | `_generate_clip_spectrogram` + `extract_clip` |
| `engine/birdweather.py` | 93 | `upload_to_birdweather` (FLAC + per-detection POST) |
| `engine/db.py` | 63 | `init_db` + `write_detection` |
| `engine/watcher.py` | 45 | `WavHandler` (rotates one-behind to avoid races) |

Backwards compat: `engine.py` re-imports each public symbol so `from engine import X` keeps working for `test_engine.py` and any external tooling.

### Feat: alert lifecycle log + UI history panel

Alerting was opaque before this — once an alert fired (or didn't), the only trace was a `console.log` line that journalctl rotated out within days. No way to answer "does this alert keep flapping?" or "which threshold needs tuning?".

- `recordAlertEvent(type, action, fields)` writes JSONL to `config/alerts.log` on every state transition. Actions captured: **sent**, **cooldown_blocked**, **streak_inc**, **streak_reset**, **send_failed**, **no_apprise_config**.
- Rotation: amortized trim every ~5 % of writes, keep last 1 000 lines.
- Writes serialized on a single promise chain so concurrent calls can't interleave.
- `GET /api/alerts/history?limit=N&type=X&action=Y` returns `{ events (newest first), total, types[], actions[] }`.
- New card in **Réglages → Notifications → Historique des alertes** with refresh + 2 filter dropdowns (auto-populated from the log) and a colour-coded sticky-header table — sent (red), streak_inc (amber), streak_reset (green), cooldown_blocked (grey), send_failed (dark red). Auto-loads when the user switches to the notif tab.
- 9 i18n keys × 4 languages.

### Fix: false "engine stopped" Apprise alerts on systemctl flakes

Three bugs in `server/lib/alerts.js` were producing spurious "service down" pages, the most recent at 06:01 during dawn-chorus inference burst when the engine was actually fine:

1. `execCmd` rejects on non-zero exit, but `systemctl is-active` exits 3 for inactive/failed/activating/deactivating/reloading and prints the actual state to stdout. The existing `if (state === 'failed' || ...)` branch was dead code — the promise rejected before reaching it.
2. The `catch` block treated every non-zero exit as "service down" and fired immediately, with no way to tell apart actually-down vs transient (`activating` during a normal restart) vs dbus/systemd glitches under load.
3. No debounce — a single bad read triggered the alert.

Fix:
- New `serviceState(svc)` helper uses `spawn` directly and **always resolves** with the state string (or `'error'` if systemctl can't be invoked at all), with a 5 s hard timeout.
- 2-strike debounce (`SVC_DOWN_REQUIRED_STREAK = 2`): only alert after two consecutive `inactive`/`failed` reads. Transient states reset the streak.
- Streak resets are logged (`[ALERT] svc streak reset`) so future false-positives can be diagnosed from the journal.

### Feat: ZRAM auto-tune for low-RAM Pis + UI panel

On Pi 3 (1 GB) and Pi 4 (2-4 GB), simultaneous BirdNET + Perch + Node + arecord + browser can OOM-kill the engine silently. Modern RPi OS does ship `systemd-zram-generator`, but defaults aren't tuned for our workload.

- New `scripts/configure_zram.sh` (idempotent): detects `/proc/device-tree/model` + `MemTotal`, picks **50 % of RAM on ≤2 GB**, **25 % on 3-4 GB**, **skip on ≥6 GB** (`--force` overrides). Auto-detects backend: `systemd-zram-generator` (preferred) writes `/etc/systemd/zram-generator.conf` with `compression-algorithm = zstd` + `swap-priority = 100`; `zram-tools` (legacy) writes `/etc/default/zramswap`. Reloads the right service. `--status` for inspection.
- Auto-called as a sub-step of `install.sh` step 6, non-fatal so it never blocks the install.
- New backend endpoints `GET /api/zram/status` + `POST /api/zram/configure`.
- New card in **Réglages → Services → ZRAM (swap compressé)**: host info, state badge, backend, device line (name · algo · disk size), live usage (data → compressed [ratio× ratio]), swap priority, host-specific recommendation, raw config in a `<details>` block, "Apply recommended config" button + "force" checkbox + result message, disable hint footer.
- 18 i18n keys × 4 languages.

### UI: dashboard right card +30 % visual comfort

The species photo + name on the live dashboard was the natural focal point but felt cramped at 170×170 next to the wider engine zone, and long species names ("Rougequeue à front blanc", "Mésange charbonnière", compound German/Dutch names) clipped at 1.3 rem.

- Card width 320 → 416 px (steals from `.bf-zone-engine` which is `flex:1`)
- Photo 170 → 220 px + radius 16 → 18
- Name font 1.3 → 1.7 rem with `overflow-wrap: break-word`
- Sci name 0.78 → 0.95, confidence circle 46 → 60 px, gap 1.1 → 1.4 rem
- Recent species strip now shows **7 thumbnails** (was 6) — fits cleanly in the new width

Mobile breakpoint untouched (collapses to a column with photo at 120 px regardless).

## [1.39.0] — 2026-04-22

### Feat: noisy-species throttle to stop dominant species flooding the DB

Common feeder species (Moineau domestique, Merle noir, Pouillot véloce on bird.local) were producing 10K+ detections/day each — burst-firing every few seconds, blowing past the 10K row limit on `/api/query`, filling 800 MB of birds.db, and burying interesting species in the leaderboards. Other implementations have a per-species cooldown for exactly this; we didn't.

Engine adds a non-invasive throttle in the inference loop (engine/engine.py):

- After a detection passes confidence + dual-confirm, check `_should_throttle(com_name, confidence)`:
  - **Bypass-confidence** (default **0.95**) — high-confidence calls always pass, never throttled
  - **Cooldown** (default **120 s**) — for sub-bypass calls, drop if the same species was kept less than `cooldown` seconds ago
- State lives in two in-memory dicts on the engine (`_throttle_last`, `_throttle_dropped`); no DB writes for dropped rows; bypass calls don't reset the cooldown
- Config hot-reloaded from `birdnet.conf` (~5 min cycle), no restart needed

Settings → Détection exposes a new card **Limite par espèce (throttle)** with enable checkbox + cooldown number input + bypass slider + (i) info button. Detailed help modal explains the mechanism, recommended values (60s/120s/300s for cooldown, 0.95/0.99/0.80 for bypass), and observability — full FR/EN/DE/NL i18n.

New keys in `/etc/birdnet/birdnet.conf`:

```ini
NOISY_THROTTLE_ENABLED=0          # off by default — opt-in
THROTTLE_COOLDOWN_SECONDS=120
THROTTLE_BYPASS_CONFIDENCE=0.95
```

### Tooling: retroactive cleanup script

`scripts/cleanup_throttle.py` applies the same rule to historical rows for users who already have a bloated DB. It walks detections chronologically, identifies what would have been throttled, and:

- Backs up `birds.db` via the SQLite online `.backup` API
- **Moves** (not deletes) matching mp3 + .mp3.png to a quarantine directory preserving the `By_Date/Species/` layout — same filesystem so it's an instant rename, no extra space needed during the operation
- Deletes the rows from `birds.db` in batches
- Prints exact restore commands

Flags: `--dry-run` (default), `--apply`, `--cooldown`, `--bypass`, `--from`, `--to`, `--species`, `--vacuum`. `--to` defaults to *yesterday* — never touches today's incoming detections.

Dry-run on bird.local (1.05M rows, all-time, defaults): would purge **689 799 rows** (~65 %) and quarantine **~256 GB** of audio. Per-species top: Pouillot véloce 115K, Mésange charbonnière 90K, Moineau domestique 78K, Merle noir 77K. Recommended workflow: `--from <30d ago> --apply` first, verify, then expand the window.

### Perf: weather page from timeout to instant

The `/birds/api/external/weather/*` endpoints were hitting the Caddy 30 s upstream timeout on bird.local — `weather-species-heatmap` alone took 43 s. EXPLAIN QUERY PLAN showed `idx_date_conf` covered (Date, Confidence) but the JOIN with `weather_hourly` required SCAN on 22K weather rows × SEARCH detections by date+confidence + per-row `CAST(SUBSTR(Time,1,2) AS INT)`.

Two-stage fix:

- **Expression index** `idx_date_hour_conf ON detections(Date, CAST(SUBSTR(Time,1,2) AS INT), Confidence)` — heatmap drops from 43 s → 12 s
- **5-min result cache** wrapping the 5 weather analytics endpoints (`condition-summary`, `species-by-condition`, `species-heatmap`, `match-summary`, `species-profile`) — warm requests now serve in <10 ms

Page audit also dropped the legacy "Top species by weather" card (redundant with the heatmap), reordered for clearer flow, and added a `corrHasSignal` guard that hides the correlation block when all three correlations are below the noise floor (|r|<0.2).

### Fix: spectrogram + dashboard-kiosk hitting query row limit

Both pages used `ORDER BY Time DESC` on a daily-detection query without a LIMIT. On a 11K-detection day this tripped the 10K cap on `/api/query`, producing HTTP 400. Capped to `LIMIT 5000` (more than enough for an interactive view) with `rows.reverse()` to keep chronological order.

## [1.38.0] — 2026-04-21

### Feat: dual-model cross-confirmation kills Perch false positives

Perch V2's softmax over 10,340 species produces characteristic false positives when the audio is dominated by low-frequency noise (wind, vehicle rumble, HVAC) — the model maps the energy to the "big bird" classes (Canada Goose, Grey Heron, Common Raven) at 0.5-0.85 confidence. A spot audit over ~500 nocturnal detections on bird.local showed these accounted for the bulk of overnight FPs on an otherwise quiet station.

Mitigation lands in the engine as a cross-confirmation rule:

- Perch detection with score **≥ `perch_standalone_confidence`** (default **0.85**) → accepted alone
- Perch detection with score in **[`perch_confidence`, 0.85)** → requires BirdNET to have scored the **same species** ≥ **`birdnet_echo_confidence`** (default **0.15**) on any 3 s chunk overlapping the Perch 5 s chunk by ≥ 1 s

The echo uses BirdNET's **raw per-chunk predictions** (top-20, pre-threshold) — so a weak 0.15 echo is enough to confirm a mid-range Perch hit. BirdNET itself is the reference model and is never filtered by this rule.

Engine implementation: `_analyze_with_model` now returns `(detections, raw_preds)` where `raw_preds` is `[(start_s, end_s, {sci: score, ...}), ...]`. Primary (BirdNET) `raw_preds` ride the secondary queue and feed the Perch call as `primary_raw_preds=`. The overlap match is computed on chunk timestamps (BirdNET chunks = 3 s, Perch = 5 s, boundaries don't align).

Settings → Detection exposes a new card **Confirmation bi-modèle** with a toggle + two sliders + three (i) tooltips explaining each rule (FR/EN/DE/NL). Defaults ship enabled.

Other hardening in the same push:
- **`PERCH_CONFIDENCE` default raised from 0.20 → 0.50** — the old value was pre-dual-confirm and let too much through even before the cross-check
- **Fixed a config file bug** — `/etc/birdnet/birdnet.conf` had `RANGE_FILTER_PERCH_EBIRD=0PRIVACY_FILTER_ENABLED=1` collapsed onto one line, silently breaking both parsers. Lines are now split; the eBird range filter also ships enabled by default since the infrastructure was already there
- **New cleanup script** (`scripts/cleanup_perch_fp.py`) for retroactively purging Perch false positives from `birds.db` + the associated MP3/PNG clips. Supports `--dry-run`, three rule flags (R1 threshold, R2 no-echo, R3 out-of-range eBird), and a `--skip-r2` conservative mode (recommended — retroactive R2 is stricter than the live rule because historical BirdNET rows only exist above its own 0.6 threshold)

On bird.local the conservative cleanup (`R1 + R3`) removed **9 770 rows** (~20% of Perch detections) and **19 452 MP3+PNG files** — all below the new 0.50 threshold or outside the local eBird species list. Live filtering confirmed active within 2 min of restart with 1-3 FPs rejected per 45 s cycle.

New keys in `/etc/birdnet/birdnet.conf` (all hot-reloaded by the engine within ~5 min, no restart needed):

```ini
DUAL_CONFIRM_ENABLED=1
PERCH_STANDALONE_CONFIDENCE=0.85
BIRDNET_ECHO_CONFIDENCE=0.15
```

## [1.37.0] — 2026-04-21

### Perf: centralized SQLite PRAGMA tuning adapted to host RAM

Audited the PRAGMAs birdash applies to its SQLite connections. The defaults from `better-sqlite3` already gave us `synchronous=NORMAL` and `cache_size=16 MB`, but `mmap_size` was disabled and `temp_store` spilled to disk — both leave performance on the table on Pi 4/5.

New `server/lib/db-pragmas.js` helper applies a consistent tuning to every connection (read, write, `birdash.db`, `taxonomy.db`, and the worker thread) and adapts to host RAM:

- **Pi 4/5 (≥3 GB)**: `cache_size = 64 MB`, `mmap_size = 256 MB`, `temp_store = MEMORY`, `busy_timeout = 30 s`
- **Pi 3 (<3 GB)**: `cache_size = 16 MB` (kept), `mmap_size = 0` (skipped — RAM too tight next to arecord), `temp_store = MEMORY`, `busy_timeout = 30 s`

Why these values:
- `synchronous = NORMAL` (no change, kept) — SQLite docs explicitly recommend it in WAL mode; 2-5× faster writes, only risk is losing the last ~1 s of transactions on power cut (acceptable — engine recreates within 45 s)
- `cache_size = 64 MB` — hot pages stay across queries; huge win on repeated aggregates over the same date window
- `mmap_size = 256 MB` — lets the OS page cache back the most-read portion of birds.db (currently ~750 MB on bird.local); sequential reads much faster
- `temp_store = MEMORY` — ORDER BY / GROUP BY / DISTINCT temp B-trees don't spill to disk
- `busy_timeout = 30 s` — aligned with Python engine (30 s) so Node reads tolerate long Python writes instead of raising "database is locked"

Bench (bird.local, Pi 5, birds.db ~750 MB, new `scripts/bench-sqlite.mjs`):

| Query | Baseline median | Tuned median | Δ |
|---|---|---|---|
| timeline-today | 59 ms | 58 ms | -3 % |
| top-species-30d | 1090 ms | **858 ms** | **-21 %** |
| species-detail-history | 324 ms | 308 ms | -5 % |
| hourly-activity-today | 55 ms | 54 ms | -2 % |
| distinct-species-30d | 1036 ms | 976 ms | -6 % |
| rare-species-1y | 2712 ms | **2317 ms** | **-15 %** |
| weather-cold-tolerance | 774 ms | 962 ms | +24 % * |
| weather-species-heatmap-top30 | 17323 ms | 20805 ms | +20 % * |
| first-last-by-species-1y | 2521 ms | 2395 ms | -5 % |

`* = noisy full-scan queries on the attached weather_hourly join. These analytics endpoints run once per user visit vs 25× in the bench; the variance is real (baseline max 20 s, tuned max 27 s — bird.local captures detections in parallel which contends for I/O).` The gain on the common read path (timeline, species detail, top species, rarities) is worth the occasional noisier analytics.

New `scripts/bench-sqlite.mjs` supports `--baseline` (conservative defaults, for before/after comparisons) and `--json` (for scripted diffs). Each query runs 25 times with 3 warmup runs discarded; reports min/median/p95/max.

## [1.36.0] — 2026-04-21

### Refactor: split server/routes/audio.js into 8 cohesive modules

`server/routes/audio.js` had grown to 1094 lines mixing 8 unrelated concerns (streaming, devices, profiles, calibration, monitoring, adaptive-gain, noise-profile, hardware boost). New contributors had to scroll through ~1000 lines to find where to add or fix anything audio-related.

Split into one thin dispatcher + 7 single-concern modules under `server/routes/audio/`:

| File | Lines | Responsibility |
|---|---|---|
| `audio.js` | 45 | Dispatcher — try each module in order, first match wins |
| `audio/_helpers.js` | 160 | Shared utilities (jsonConfigGet/Post, paths, whitelists, getRecentMp3s, readBoost) |
| `audio/streaming.js` | 193 | `/api/audio-info`, `/api/audio-stream`, `/api/live-stream`, `/api/live-pcm` |
| `audio/devices.js` | 218 | `/api/audio/devices`, `/api/audio/test`, `/api/audio/config` GET/POST, `/api/audio/boost` GET/POST |
| `audio/profiles.js` | 134 | `/api/audio/profiles` CRUD + activate |
| `audio/calibration.js` | 120 | `/api/audio/calibration/start` + apply |
| `audio/monitoring.js` | 147 | `/api/audio/monitor` SSE + `/api/audio/filter-preview` |
| `audio/adaptive_gain.js` | 142 | `/api/audio/adaptive-gain/state`, config GET/POST + background collector |
| `audio/noise_profile.js` | 109 | `/api/audio/noise-profile/record`, `/status`, DELETE |

Each module exports `handle(req, res, pathname, ctx)` — same signature as the old monolithic file. `adaptive_gain` also exports `shutdown()` (forwarded by the dispatcher) for the `setInterval`/arecord-child cleanup.

Pure code movement, zero behavior change:
- All endpoint URLs unchanged
- Auth logic unchanged
- Side effects (ALSA dsnoop generation on device change, recording-service restart) unchanged
- Tests 155/155 still pass
- Smoke 34/35 (only the unrelated overview MP3 404 we've been seeing for days)

Total: 1094 → 1268 lines (+16% — the overhead is per-module imports and module headers; each individual file is ~120-220 lines, navigable in one screen).

Why this matters: the project is open-source and aims to attract contributors. A 1000-line file with 8 mixed concerns is dissuasive — splitting by responsibility makes "where do I put this fix?" obvious.

`engine.py` (1573 lines) is the next refactor candidate — same approach, separate session.

## [1.35.0] — 2026-04-21

### Setup wizard — first-run onboarding modal

A 7-step modal guides new users (and existing ones via Settings → Station) through the essential configuration without forcing them to read pages of doc. Fully hardware-aware — detects the Pi model, RAM, sound cards, disks, and internet connectivity, then proposes adapted defaults the user can override.

**Backend** (`server/routes/setup.js`):
- `GET /api/setup/status` — `{ needed, completed_at, gaps }`. Setup is considered "needed" when no `config/setup-completed.json` flag exists, or `lat/lon=0/0`, or no audio device is configured.
- `GET /api/setup/hardware-profile` — Pi model + tag (pi3/pi4/pi5/other), total RAM, detected sound cards (USB-flagged for recommendation), block devices (external USB drives flagged), live Open-Meteo probe for internet status, plus computed model recommendations (Pi 5 + ≥4 GB → BirdNET FP16 + Perch FP16 dual; Pi 4 + ≥4 GB → + Perch INT8 dual; Pi 3 → BirdNET FP16 single).
- `POST /api/setup/complete` — applies all 5 categories of choices (location, audio, model, filters, integrations) in batch, writes `config/setup-completed.json` atomically. **Does not restart any service** — config goes to disk, the engine picks up changes at the user's next manual restart. Ongoing detections are not interrupted.

**Frontend** (`public/js/bird-setup-wizard.js`):
- 7 steps: Welcome → Location → Audio source → Detection model → Pre-filters → Integrations → Recap.
- Hardware-aware defaults seeded into every step from `/api/setup/hardware-profile` + current `birdnet.conf` values pre-loaded so re-runs aren't destructive.
- Per-step "Pourquoi ce réglage ?" expandable explanations educate new users.
- Audio step lists detected devices with USB/built-in badges and a "Recommended" pill on the auto-pick.
- Model step offers two simple choices (Single BirdNET vs Dual BirdNET+Perch) with hardware recommendation surfaced + "Advanced choices" expander revealing the full model picker.
- Pre-filters step exposes YAMNet privacy + dog-bark filters with GDPR-friendly defaults.
- Integrations step covers BirdWeather station ID + Apprise URLs (one per line), MQTT skipped (too complex for a wizard).
- Recap step shows all configured choices + clear note that nothing restarts automatically.
- Auto-trigger on overview.html mount when status is "needed" and not dismissed in this browser session.
- Re-run from Settings → Station → "Lancer l'assistant" — pre-loads current values, can be closed without applying.

**i18n**: ~80 new keys × 4 languages (fr, en, de, nl).

**Smoke**: bumped `scripts/smoke.mjs` `page.goto` timeout from 20 s to 45 s — pages now load more JS (weather chips, wizard) and the old timeout was tripping on `recordings.html`.

**SW v140**. Tests 155/155, smoke 35/35 green.

## [1.34.0] — 2026-04-21

### Custom weather search on weather.html (Phase B reimagined)

Phase B was originally planned as filters in detections.html, but the bird-vs-weather questions surface naturally on the weather page itself. New "Recherche par conditions" card lets ornithologists answer ad-hoc questions in seconds — no need to leave to a separate filter panel.

Backend:
- Extended `/api/weather/species-by-condition` with `hour_min`, `hour_max`, `date_from`, `date_to` (added to the existing temp/precip/wind/codes/conf params). All filters AND'd together, all optional.
- New `/api/weather/match-summary` endpoint — returns just `{detections, species}` totals for the live header counter, avoiding a row transfer just to count. Same filter shape as species-by-condition, parsed via a shared `parseWeatherFilters()` helper.

Frontend (weather.html):
- New card with 6 filter rows: temperature, precipitation, wind (range sliders), hour of day, date range, and conditions (8-checkbox WMO buckets). Each row has its own on/off toggle so an empty filter means "no constraint" rather than relying on default magic numbers.
- 4 quick presets at the top: **Grand froid** (-15…0°C), **Pluie soutenue** (≥2mm/h), **Aube dégagée** (5-9h, clear sky), **Pluie/Orage** (rain or storm codes). Click → form auto-fills.
- Live update with 300ms debounce + sequence-number race protection (older queries discarded if a newer one starts).
- Results: top 20 matching species with rank, common name, sci name, detection count, avg confidence. Click row → species page.
- Live header: `12,348 detections · 47 species` updates as you slide.
- URL params persistence via `history.replaceState` — every filter change updates the URL so links stay shareable. **Lien** button copies the current URL to clipboard.
- **CSV** export of matching species.
- 12 new i18n labels × 4 languages.

Architecture: shared `parseWeatherFilters()` keeps backend filter parsing in one place. Frontend `buildQuery()` mirrors it for URL/API serialization. Adding a new filter dimension means changing one place on each side.

This obsoletes the originally-planned phase B (filters in detections.html) — both would solve the same use cases but with a worse focus (per-detection rather than per-species).

## [1.33.0] — 2026-04-21

### Weather analytics: leaderboards, heatmap, per-species profile (Phase C)

Now that every detection has weather context, you can answer ornithological questions like "which species are still active when it's sub-zero?" or "what sings during heavy rain?" directly from the dashboard.

**4 new backend endpoints** (all JOIN active_detections × weather_hourly):

- `GET /api/weather/condition-summary?conf=0.7` — global counts of detections + distinct species per WMO category (clear, partly_cloudy, cloudy, fog, drizzle, rain, snow, storm).
- `GET /api/weather/species-by-condition?temp_min=&temp_max=&codes=&precip_min=&wind_min=&conf=&limit=` — top species matching arbitrary AND-combined weather predicates.
- `GET /api/weather/species-heatmap?top=30&bin_size=5&bin_min=-15&bin_max=35` — dense matrix: top-N species × temperature bins, suitable for heatmap rendering.
- `GET /api/weather/species-profile?species=` — per-species distribution across weather conditions + temp histogram + summary stats (avg/min/max temp, avg wind, % during precip).

**weather.html — 2 new sections:**

- **Activité par conditions météo** — 4 leaderboards in a responsive grid: cold tolerance (<0°C), storm singers (codes 95-99), heavy rain (≥5mm/h), strong wind (≥30km/h). Each shows top 10 species with click-through to species page.
- **Heatmap espèce × température** — top 30 species × temp bins from -15°C to +35°C in 5°C steps. Color gradient pale-green → green → amber → red-orange shows activity intensity. Sticky first column for horizontal scroll.

**species.html — new "Profil météo" panel:**

- 4 KPI cards: avg temperature, temp range (min…max), avg wind, % of detections during precipitation.
- Horizontal bar distribution across weather conditions (clear/cloudy/rain/etc.).
- Temperature histogram (10 bins from -15°C to +35°C).
- Hidden when the species has no detections with weather data.

13 new i18n labels per language (fr, en, de, nl). Backend queries use the existing `vdb` ATTACH (no schema changes). Architecture validated: lookup at query time over the `(date, hour)` PK index keeps queries under 1s on the Pi 5 even on 1M+ detections.

Phase C of three (badges → analytics → filters); next will be filterable views in detections.html.

## [1.32.0] — 2026-04-21

### Weather chips on detection lists (Phase A of weather audit)

The weather context that landed in 1.31.x is now visible everywhere a detection appears, not just inside the spectrogram modal.

New pieces:
- `GET /api/weather/range?from=YYYY-MM-DD&to=YYYY-MM-DD` returns all hourly snapshots in the range as a single response — a page with N detections gets weather for all of them in 1 round-trip instead of N.
- `BIRDASH.weatherCache` (Map) + `BIRDASH.loadWeatherRange(from, to)` — global in-memory cache with 5-minute TTL per range key, request deduplication for parallel callers, and silent degradation on network failures.
- New `<weather-chip :date :time :detailed>` Vue component, registered globally via the patched `BIRDASH.registerComponents`. Reads from the cache, renders nothing if the lookup misses. The `detailed` prop adds precip and wind when meaningful.
- Loaded into 23 pages via the same script-tag pattern as the spectro modal.

Pages now showing weather chips:
- `today.html` — chip next to the player meta
- `overview.html` — detailed chip (with precip + wind) on the featured-detection card
- `recordings.html` — chip on each recording row
- `rarities.html` — chip on each recent-rare-detection card
- `review.html` — chip on each flagged-detection meta line
- `favorites.html` — chip showing weather at the last detection of each favorite species

Pages still using their own fetch (no change): the spectro modal continues to fetch via `/api/weather/at` since it has no range context.

Phase A of three: badges everywhere → analytics → filters (per the ornithology roadmap).

## [1.31.1] — 2026-04-21

### Weather backfill via Open-Meteo archive API

The initial 1.31.0 release only backfilled 7 days, so detections older than a week showed no weather chip. The watcher now also runs a one-shot historical backfill via `archive-api.open-meteo.com` from the oldest detection in the DB up to ~6 days ago (the archive cutoff), chunked 1 year per request to keep responses sane. Hourly polling continues to cover the recent past.

On bird.local: 22,728 snapshots backfilled spanning Sept 2023 → April 2026 (~2.5 years of detection history) in three archive calls + one polite 500ms pause between chunks.

## [1.31.0] — 2026-04-21

### Per-detection weather context

Each new detection is now tagged with the weather conditions it was recorded in (temperature, humidity, wind, precipitation, cloud cover, pressure, weather code). Click any detection to open the spectrogram modal and see a compact weather chip next to the date/time — at a glance you know if the bird was singing in clear morning sun or under steady rain.

How it works:
- New `weather_hourly` table in `birdash.db` stores hourly snapshots indexed by `(date, hour)`.
- Background worker (`server/lib/weather-watcher.js`) backfills the past 7 days on startup, then polls Open-Meteo every hour for the last 24h. Free tier, no API key needed (~24 requests/day vs the 10K daily quota).
- New endpoint `GET /api/weather/at?date=YYYY-MM-DD&time=HH:MM:SS` resolves the timestamp to its hour and returns the snapshot, or 404 if the moment isn't yet covered (typical for very recent detections before the next hourly poll).
- Spectrogram modal: weather chip with WMO-code icon (☀ ⛅ ☁ 🌫 🌧 ❄ ⚡), temp in °C, plus precip and wind shown only when meaningful (precip > 0, wind ≥ 5 km/h).
- 8 new i18n labels per language (clear, partly cloudy, overcast, fog, drizzle, rain, snow, storm).

Idea inspired by audit of competitor projects in the Pi-based BirdNET dashboard space — first of three feature catch-ups (weather → setup wizard → multi-source audio).

## [1.30.1] — 2026-04-21

### Quality pass: CI, smoke filters, service-worker fixes

Round of housekeeping — no user-visible behaviour change, but the test harness, smoke tool, and offline cache are all tighter.

- **GitHub Actions CI** (`.github/workflows/ci.yml`) — `npm ci && npm test` on every push + PR to `main`. Catches silent regressions before they reach a Pi.
- **Test harness** — `npm test` now runs every `tests/*.test.js` file, not just `server.test.js`. The `safe-config` concurrency suite was never running before. Added `describe.skip` gates so integration suites that need Pi-only state (real `birdnet.conf`, `~/birdengine/models`, ALSA, etc.) self-skip on CI runners — the same `npm test` command works in both environments. Removed 4 zombie tests that referenced endpoints deleted in earlier refactors (`/api/detection-rules` GET/POST, `/api/detections-by-taxonomy`, `/api/photo-cache-stats`) — 155/155 green on Pi, ~140 green on CI (rest auto-skipped with reason).
- **`scripts/smoke.mjs`** — added `HTTP 502` / `HTTP 504` to console-error ignore list. These wrapper strings come from `birdQuery` when Caddy cancels the upstream during a navigation, not from actual backend failures. Smoke now reports 35/35 pages clean.
- **`public/sw.js`** — two real bugs fixed in the service worker:
  - Species photo cache was **unreachable**: the `/birds/api/photo` cache-first branch sat *after* a blanket `/birds/api/` early-return, so it never executed. Moved the photo check above the early-return — bird photos now genuinely cache in the service worker.
  - Removed unused `staleWhileRevalidate` helper (dead code).
  - Cache bumped to `v130`.

## [1.30.0] — 2026-04-20

### Bundled real BirdNET FP16 model — FP16 selection is no longer a lie

`download_birdnet.sh` only ever downloaded the FP32 model and created a `BirdNET_GLOBAL_6K_V2.4_Model_FP16.tflite → FP32.tflite` symlink for engine name compatibility. So users picking "FP16" in the Settings model picker were silently running FP32 inference (50 MB binary instead of 26 MB, no smaller-RAM / faster-load benefit).

Now:
- The real FP16 model (~26 MB) is bundled in `engine/models/` (gitignore exception, same pattern as `yamnet.tflite`)
- `download_birdnet.sh` prefers the bundled binary, falls back to the symlink only if the file is missing (older clones)
- `update.sh` syncs the FP16 to legacy `~/birdengine/models/` install layouts on every update — replaces an existing symlink properly via `cp --remove-destination` (without it, `cp -f` would follow the symlink and overwrite FP32)
- mickey, biloute, and any future install pick this up automatically through the in-app update flow — no SSH push, no model re-download

Real-world impact: FP16 is ~50 % smaller on disk and loads faster, with identical inference accuracy. The speed gain on inference itself is modest on Pi 3 / 4 ARM (XNNPACK still upcasts internally) but the smaller RAM footprint matters when several models share a 1 GB Pi 3.

## [1.29.3] — 2026-04-20

### Fix: 0-byte MP3 clips left behind by ffmpeg crashes (esp. Pi 3 / SD card)

The dashboard would show "Erreur de décodage audio" for some detections forever. Root cause: `extract_clip` runs ffmpeg as a subprocess, and on resource-constrained hosts (Pi 3 + SD card, OOM killer, broken pipe) ffmpeg can crash *after* opening the output file but *before* writing any data — leaving a 0-byte MP3 (and sometimes a 0-byte spectrogram PNG) on disk. The error was logged but the empty file persisted: every dashboard click on that detection then re-tried the decode and failed.

Surfaced on mickey.local (Pi 3, SD-card-only): `Content-Length: 0` on the served MP3.

Two-part fix in `engine.py`:
- `extract_clip` now (a) deletes any 0-byte output on ffmpeg failure, (b) verifies a non-zero file size after a "successful" return — some failure modes return 0 but write nothing, (c) cleans up after `subprocess.TimeoutExpired` too (logged as likely SD-card I/O saturation).
- New `_sweep_empty_clips()` runs once at engine startup, walking `~/BirdSongs/Extracted/By_Date/` and removing any 0-byte `*.mp3` / `*.png` files. Bird discovered 24 historical leftovers on first deploy.

mickey will pick this up on its next in-app update — no SSH push.

## [1.29.2] — 2026-04-20

### Bug-hunt sweep across today's work

Two regressions surfaced when auditing today's changes end-to-end:

- **`sqlite3.OperationalError: database is locked`** in the Perch worker. Cause: Python's default `sqlite3.connect` uses a 5 s timeout, same as Node's `busy_timeout`. When birdash's writer (aggregates rebuild, alert queries) holds the lock for >5 s during a Perch insert, the engine raises and the in-flight detections lose their MP3 clips. Fix: `sqlite3.connect(timeout=30)` + `PRAGMA busy_timeout=30000` so the engine is the patient party.

- **`birdengine-recording` restarts on every Save click.** The 1.29.1 hook fired whenever `RECORDING_LENGTH` was in the validated payload — but the settings UI re-sends the full key set on every save. Each click caused a 5–7 s gap in audio capture even when the value hadn't changed. Fix: snapshot the previous value via `parseBirdnetConf()` before writing, only restart if `prev !== new`.

Both fixes verified live: 0 DB locks since deployment, sound-level monitor still flowing, settings save no longer interrupts recording.

## [1.29.1] — 2026-04-20

### YAMNet pre-filter UX polish + recording length actually configurable

- **Privacy filter description** no longer hard-codes "30 s" — it now correctly says "the audio clip" without claiming a fixed duration. The chunk length is whatever the user has set for `RECORDING_LENGTH` (default 45 s).
- **(i) help buttons** on the Privacy and Dog filter cards in Settings → Detection → Filtres de pré-analyse. Each opens the standard help modal with full explanation of: what the filter does, how the threshold works (with 0.30 / 0.50 / 0.70 examples), what the cooldown / delete-WAV options imply, and recommended values.
- **`RECORDING_LENGTH` is now actually applied**. The setting and validator existed since forever, but `record.sh` hard-coded `RECORDING_LENGTH=45` and ignored `birdnet.conf`. Now `record.sh` reads the conf value (with fallback to 45 s), and changing it via the UI restarts `birdengine-recording` automatically so the new chunk length takes effect on the next recording cycle.
- `update.sh` extended to sync `record.sh` to `$HOME/birdengine/` for legacy install layouts (preserves executable bit).
- 4-language i18n (FR/EN/DE/NL) for the help modal content.

## [1.29.0] — 2026-04-20

### Sound-level alerts (mic dead / clipping)

Closes the loop on the Leq monitor added in 1.28.0 — the station now notifies via Apprise when the audio input goes abnormal.

- **Silent microphone**: energy-average Leq ≤ `-90 dBFS` (default) sustained for 15 min (default) → Apprise notification. Catches an unplugged USB mic, a muted card, a failed cable, or a boom stand that fell into a foam pad overnight.
- **Clipping / overdriven**: energy-average Leq ≥ `-5 dBFS` (default) sustained for 15 min → Apprise notification. Catches overdriven input: wrong gain after a calibration, mic moved next to a fan, electrical interference.
- All three values are configurable in Settings → Notifications → Alertes système.
- Skips when no recent data (< 60 % of window covered or last reading > window old) — avoids a false "silent" spam at engine restart. The existing `svc_birdengine` alert already covers engine-down.
- Uses the standard 10 min same-type cooldown; Apprise config / tags shared with all other system alerts.
- i18n for all 4 message strings (titles + bodies) in EN / FR / DE / NL.

Also fixed an import bug in `alerts.js` that silently broke *every* system alert: `fs`, `fsp`, and `BIRDNET_CONF` were referenced but never required. Every check threw a caught ReferenceError and returned. Adding explicit imports at the top of the file brings back temperature, disk, RAM, backlog, and no-detection alerts.

New config keys in `birdnet.conf`:
- `BIRDASH_ALERT_ON_SOUND` (0/1, default 1)
- `BIRDASH_ALERT_SOUND_LOW_DBFS` (default -90)
- `BIRDASH_ALERT_SOUND_HIGH_DBFS` (default -5)
- `BIRDASH_ALERT_SOUND_SUSTAINED_MIN` (default 15)

## [1.28.2] — 2026-04-20

### Fix: missing MP3 clips for Perch detections after engine restart

"Erreur de décodage audio" on the spectrogram modal. Cause: post-processing for the secondary model (Perch) was spawned as a daemon thread but — unlike the primary model — was not tracked in `self._post_threads`. So when the engine received SIGTERM (update, restart, settings reload), the shutdown handler only waited for primary-model post-processing and exited while Perch's `extract_clip` was still running, killing the daemon thread mid-ffmpeg. Perch detections were already written to the DB, but the MP3 clips were never produced → the dashboard showed the detection but the spectrogram modal reported a decode error.

Fix: track secondary post-threads in `_post_threads` as well (guarded by a new `_post_lock` since primary and secondary workers both append). Shutdown join timeout bumped from 10 s to 30 s to give room for ffmpeg + spectrogram generation on files with many detections.

Existing orphan references (detections in the DB whose MP3 was lost to this bug before the fix) remain. They're rare — expect a sprinkle per engine restart prior to 1.28.2. The dashboard degrades gracefully (error overlay in the modal), no other functional impact.

## [1.28.1] — 2026-04-20

### Fix: engine was analyzing only ~2 s out of every 45 s recording

The Sound-level monitor added in 1.28.0 surfaced a long-standing bug. `WavHandler.on_created` fired the moment arecord opened a new WAV file — *while it was still being written*. The "wait for stable size" loop in `process_file` (5 × 0.3 s = 1.5 s of waiting) gave up before the file was complete, so `sf.read()` only saw the first ~2 seconds. BirdNET / Perch then ran inference on that 2-second slice and shutil.move'd the (still being written by arecord) file to processed/ — where it grew to its full 45 s after the move, but inference had already happened.

Effect: ~95 % of every 45 s recording was never analyzed. Bird calls in seconds 2-45 of any file were silently dropped before they ever reached the model.

Fix: rotate-on-rotation. When on_created fires for file N+1, file N is *guaranteed* complete (arecord just closed it before opening N+1). `WavHandler` now keeps one "pending" path and processes the *previous* file on every rotation. Startup scan defers the most recent file if its mtime is < 3 s old (probably mid-write).

The wait-for-stable-size loop in `process_file` is simplified to a single 0.5 s sanity check (for the rsync multi-Pi case where atomicity isn't guaranteed).

You should see more detections per file going forward, especially for sparse-but-loud events that were falling in the dropped 43 seconds. No setting to change.

## [1.28.0] — 2026-04-20

### Live sound-level monitor (Leq / peak in dBFS)

Adds per-chunk acoustic health telemetry so you can spot wind, traffic, a dead mic, or silent overnight hours at a glance.

- New `compute_sound_level()` + `record_sound_level()` helpers in `engine.py` — RMS and peak in dBFS, computed on the raw signal before adaptive gain or filters (reflects what the microphone actually captured)
- Rolling ring buffer written to `config/sound_level.json` (last 120 readings ≈ 90 min at 45 s/chunk), atomic replace to avoid partial reads
- New Prometheus gauges in `server/lib/metrics.js`: `birdash_sound_leq_dbfs`, `_peak_dbfs`, `_leq_1h_avg_dbfs` (energy-average), `_last_reading_age_seconds`
- New `GET /api/sound-level` route serving `current + avg_1h + buffer` for the UI
- New "Niveau sonore (en direct)" card at the top of Settings → Audio: big Leq readout, peak, 1 h average, live sparkline (60 last points), auto-refresh every 5 s while the tab is open
- i18n keys in 4 languages, note about dBFS being uncalibrated (trend-tracking, not SPL)

Overhead: a few µs per WAV (numpy vectorized RMS on ~2 M samples). Runs unconditionally — no setting to toggle, no measurable cost.

## [1.27.0] — 2026-04-20

### Privacy filter + dog bark filter (YAMNet pre-analysis)

Two new opt-in filters that run BEFORE BirdNET / Perch inference, powered by Google's YAMNet (AudioSet, 521 audio classes, 4 MB TFLite). One model, two use cases:

- **Privacy filter (RGPD-friendly)**: human voice in the recording → drop the entire detection pass. By default the WAV file is also deleted from disk so no recording of the human ever leaves the station. Toggle in Settings → Detection → "Filtres de pré-analyse" with adjustable threshold.
- **Dog bark filter**: bark / howl / growl detected → drop the recording AND start a configurable cooldown (default 15 s) during which no detections are recorded. Stops the cascade of false positives that dogs trigger across consecutive recording windows.

Implementation:
- New `engine/yamnet_filter.py` wrapper — loads the TFLite model once, exposes `analyze(samples, sr)` returning `(voice_score, dog_score, top_label, top_score)` over 3 non-overlapping 0.975 s windows (max-aggregation per class)
- New `engine/models/yamnet.tflite` (4 MB, Apache 2.0, sourced from Google's MediaPipe public bucket) and `yamnet_class_map.csv` (521 labels)
- `engine.py` runs YAMNet on the raw audio BEFORE adaptive gain / filters / inference, so we classify what the user actually recorded
- ~30 ms added latency per file on Pi 5 — negligible vs the ~1.5 s BirdNET inference
- New validators in `config.js`: `PRIVACY_FILTER_{ENABLED,THRESHOLD,DELETE_AUDIO}`, `DOG_FILTER_{ENABLED,THRESHOLD,COOLDOWN_SEC}`
- New "Filtres de pré-analyse" card in Settings → Detection — sliders, toggles, RGPD warning, latency hint, all in 4 languages
- `update.sh` syncs `yamnet_filter.py` + the model files to `$HOME/birdengine/` for legacy install layouts

## [1.26.0] — 2026-04-20

### Range Filter — visibility for BirdNET, new eBird filter for Perch

The BirdNET MData range filter was already there (engine.py uses `species_list` from the MData TFLite to drop out-of-region predictions, configurable via `SF_THRESH`), but the user couldn't see what it was doing. Perch had no equivalent at all.

**Part A — visibility (BirdNET MData)**:
- New `engine/range_filter_cli.py` — standalone Python that loads MData TFLite for given lat/lon/week/threshold and prints the expected species list as JSON
- New `GET /api/range-filter/preview?week=N&threshold=T` route — runs the CLI, caches 5 min by (lat, lon, week, threshold, lang)
- Settings → Detection → **Range Filter** card: live count "✓ 156 species expected here in week 16" + collapsible full list (sci + com names), refreshes when you move the SF_THRESH slider (debounced 500ms)
- Existing `SF_THRESH` slider preserved with the same range/step — UI just got a brain

**Part B — eBird filter for Perch**:
- New opt-in flag `RANGE_FILTER_PERCH_EBIRD=0/1` in `birdnet.conf`. When enabled, engine.py loads `config/ebird-frequency.json` (already maintained by birdash) at startup and drops Perch predictions whose `sci_name` isn't in the local eBird "recent observations" set. Stops Perch from reporting tropical species in Belgium.
- mtime-based reload of the eBird map so engine picks up daily refreshes without restart
- Fail-open: no eBird data → no filtering (better than silently dropping every Perch detection)
- New "Filtre eBird pour Perch" card in Settings → Detection with the toggle and a warning when no eBird API key is set
- New validator `RANGE_FILTER_PERCH_EBIRD` in config.js

**Update.sh fix**:
- Engine `.py` files are now rsynced to `$HOME/birdengine/` on update if the systemd service points there (legacy install layout). Prevents the "git pull but the engine still runs the old code" trap.

## [1.25.1] — 2026-04-20

### Auth fixes — no more lockout, login page text resolved
- **Fail-safe**: if `AUTH_MODE` is set to `protected` or `public-read` but no credentials are configured (no username + password hash), the gate now degrades to `off` and logs a warning. Picking a protected mode without setting a password used to be an instant permanent lockout — you couldn't reach Settings to unset it. Fixed.
- **Login page i18n**: the page used `BIRDASH.t` and `BIRDASH.i18nReady` which don't exist. Switched to `useI18n()` (the proper composable) and `BIRDASH.ready` (the actual promise name), so labels render translated instead of showing raw `auth_login_title` / `auth_username` keys.
- Service worker bumped to `birdash-v123` to flush the broken cached `login.html`.

## [1.25.0] — 2026-04-20

### Auth & access control (opt-in, single-user, three modes)

The killer feature for actually exposing your station to the internet — show your birds to friends without giving them admin rights.

- **Three access modes** in Settings → Station → Security:
  - `off` (default, unchanged) — LAN-trust, no auth, current behavior
  - `protected` — login required for everything
  - **`public-read`** — visitors can browse detections, species, stats and audio anonymously; login required only to change settings or access sensitive data (`/api/settings`, `/api/logs`, `/api/backup*`, `/api/audio/devices`, `/api/audio/profiles`)
- New **sober login page** (`/birds/login.html`) — fully integrated with the active theme, shows station name + brand, rotating-key icons, redirect-back parameter
- **Header indicator** on every page (when AUTH_MODE != off): green pill with username + logout button when signed in, gray "visitor (read-only)" pill + login button otherwise
- **HMAC-signed session cookies** (no DB session table to manage). Secret auto-generated on first use into `AUTH_SECRET`, rotate it to invalidate every cookie. Configurable session duration via `AUTH_SESSION_HOURS` (default 7 days)
- **bcrypt** password hashing (10 rounds) via the pure-JS `bcryptjs` (no native build dance on Pi 3)
- **Login attempts rate-limited** 5/min/IP with constant-time username comparison so a wrong username can't be distinguished from a wrong password
- **`BIRDASH_API_TOKEN` (Bearer) still works** in parallel for cron / scripted automation — useful when you want both browser auth and machine auth on the same station
- **Global fetch interceptor** in `bird-vue-core.js` — any 401 from a non-auth endpoint triggers an automatic redirect to `/login.html?redirect=<current>`, so users land on the form instead of an empty page
- **Settings card** in Station tab: 3-mode picker with descriptions, username + password (set/change with current-password verification), link to the Cloudflare Tunnel mini-guide in the README
- New `/api/auth/{login,logout,status,set-password}` endpoints
- Cloudflare Tunnel mini-guide in the README — the no-port-forward, free-TLS path to a public station

## [1.24.0] — 2026-04-20

### Prometheus metrics endpoint
- New `GET /metrics` (and `/api/metrics`) serves Prometheus exposition format — point Grafana / Prometheus / VictoriaMetrics at `http://your-pi.local/birds/metrics` and you have a scrape target
- Custom gauges: `birdash_detections_total`, `birdash_detections_today`, `birdash_detections_last_hour`, `birdash_species_today`, `birdash_species_30d`, `birdash_last_detection_age_seconds`, `birdash_db_size_bytes`
- System gauges: `birdash_cpu_temp_celsius`, `birdash_cpu_usage_percent`, `birdash_memory_{used,total}_bytes`, `birdash_disk_{used,total}_bytes`, `birdash_fan_rpm`, `birdash_system_uptime_seconds`
- Feature toggles: `birdash_feature_enabled{feature="mqtt|notifications|dual_model|birdweather|weekly_digest"}`
- Standard Node.js process metrics (`birdash_node_process_*`, `birdash_node_nodejs_eventloop_lag_seconds`, GC, heap) under the `birdash_node_` prefix
- All gauges refreshed lazily on each scrape (sub-millisecond) — no background timer
- `birdash_version_info{version="x.y.z"}` always 1, useful for `count(birdash_version_info) by (version)` style queries
- New `prom-client` npm dependency (~50 KB)

## [1.23.0] — 2026-04-20

### MQTT publisher (Home Assistant ready)
- New **MQTT card** in Settings → Notifications: broker host, port, optional username/password, topic prefix, QoS (0/1/2), retain flag, TLS toggle, minimum confidence slider, Home Assistant auto-discovery toggle, and a one-click Test button
- New backend module `server/lib/mqtt-publisher.js` polls the detections DB every 15 s and publishes one JSON message per detection to `<prefix>/<station>/detection`
- Retained `<prefix>/<station>/last_species` topic gives Home Assistant a ready-to-use sensor for the most recent bird without any template work
- Last Will & Testament publishes `<prefix>/<station>/status` = `online`/`offline` so HA shows the station as unavailable when birdash is down
- Optional **HA MQTT discovery** auto-creates two sensor entities (`Last species` + `Last confidence %`) under a `BirdStation <name>` device — drag-and-drop into any dashboard
- Reconnect with exponential backoff (2 s → 60 s) and clean disconnect on settings change
- New `POST /api/mqtt/test` endpoint connects, publishes a synthetic message to `<prefix>/<station>/test`, disconnects, returns the broker result
- `mqtt` npm dependency added — installer picks it up automatically on update via `npm install`
- Service worker bumped to `birdash-v121` so the new i18n keys load on first reload

## [1.22.2] — 2026-04-19

### Station tab layout polish
- Location card becomes a flex column — the map grows vertically to fill the remaining space instead of staying fixed at 240 px, eliminating the empty gap between the coordinate row and the card bottom
- Right column card gap reduced from 1 rem to .6 rem so Language / BirdWeather / eBird sit closer together

## [1.22.1] — 2026-04-19

### Fixes to the Region & units card
- Prefs now reach the Station tab: the refs (`unitsPref`, `timeFormatPref`, `dateFormatPref`, `weekStartPref` + matching `eff*` computeds) were added to the root `settingsCtx` provide, not just the root return — the async child component renders `settings/station.html` via `inject('settingsCtx')`, so the selectors were binding to `undefined` and appeared empty
- Labels wrap above each selector instead of inline — `.set-label` is a `<span>` inline by default; added `display:block;margin-bottom:.3rem` so the four selects stack vertically like the rest of the form
- New hint under the card title clarifies that region prefs apply immediately (they persist to `localStorage`, not `birdnet.conf`, so Save stays inactive) — new i18n key `set_region_instant` in fr/en/de/nl

### Station tab layout
- eBird card moved from a separate row below the grid into the right column beneath BirdWeather
- eBird uses `flex:1` + `margin-top:auto` on the "Get API key" link so its bottom aligns with the Location card on the left (map grows to match the taller right column)

## [1.22.0] — 2026-04-18

### Locale-aware units & formats
- New **"Région & unités"** card in Settings → Station with four preferences:
  - **Unit system** (auto / metric / imperial) — auto-detected from `navigator.language` (US / LR / MM → imperial, rest → metric)
  - **Time format** (auto / 24h / 12h)
  - **Date format** (auto / DD/MM/YYYY / MM/DD/YYYY / ISO)
  - **First day of week** (auto / Monday / Sunday) — drives the calendar grid and the weekly aggregation in `bird-queries.js`
- Prefs persist in `localStorage` (client-side, per-viewer) like `theme` / `lang`; `auto` clears the key
- Reactive: changing a preference updates every template that calls `fmtTemp()` / `fmtWind()` / `fmtSize()` / `fmtDate()` / `fmtTime()` without a reload
- New `useFormat()` composable (inlined in `bird-vue-core.js`) exposes: `fmtTemp`, `fmtWind`, `fmtPressure`, `fmtSize`, `fmtDate`, `fmtTime`, `fmtDateTime`, `fmtNumber`, `fmtPercent`, `firstDayOfWeek`, `unitLabel`
- `registerComponents(app)` now injects all formatters into `app.config.globalProperties` — pages can `{{fmtTemp(x)}}` directly without touching their `setup()`
- `fmtDate` / `fmtTime` backward-compatible with the previous string signatures from `bird-shared.js` (the re-exports on `BIRDASH.*` now point at the locale-aware versions)
- Weather (°C / km/h), overview kiosk strip, liveboard, dashboard-kiosk, system health temp, file-size displays in Settings & System, and the Calendar week layout all migrated
- Weather `weather_best` / `weather_best_full` i18n keys de-unitized — callers pass pre-formatted strings via `fmtTemp` / `fmtWind`
- Imperial unit deductions in weather chart convert `°C → °F` and `km/h → mph` at render; axis titles + tooltip labels follow `unitLabel('temp')` / `unitLabel('wind')`

### Header
- "Nom du site" (`SITE_NAME`) now drives the sub-line instead of the hardcoded `Heinsch (BE)` (replacement of brand-name → site-name after user correction)

### Deferred
- Notification threshold inputs in `settings/notif.html` still hardcode `°C` for the value label — threshold is always stored in Celsius, the display unit mismatch is minor and the conversion needs a round-trip proxy that's out of scope for this pass
- `recordings.html`, `settings/audio.html`, `spectro-test.html` keep their local `KB / MB` math (low traffic, self-contained)

## [1.21.4] — 2026-04-18

### Header station identity
- Richer identity line in the header: `Poste bioacoustique · Heinsch (BE) · 49.6700° N / 5.8267° E · Alt. 280 m · v1.21.4`
- Altitude rendered dynamically from new `ELEVATION` setting (hidden when unset)

### New setting: `ELEVATION`
- New field in **Settings → Station** next to latitude/longitude
- Stored in `birdnet.conf` (validated server-side, range −500 to 9000 m)
- i18n in fr/en/de/nl (`set_elevation`) + help-text with link to topographic-map.com
- Not used by the detection engine — display-only; mirrors the lat/lon sync pattern minus the `config.toml` side

### Colonial theme (1.21.0 → 1.21.3)
- New `data-theme="colonial"` — 1930 field-notebook carnet aesthetic (IM Fell English typography, paper-grain cards, moss/ochre/rust/berry accents)
- Theme-dot swatch in the picker uses 3 earth bands + a tiny red stamp dot so the preview reflects the palette
- Body background: aged parchment (not dark wood) — legible contrast preserved
- Nav / header / button contrast: `--bg-deep` raised to paper-3 and primary-button text forced to paper so button labels stay readable on moss

### Kiosk (1.20.8)
- `dashboard-kiosk.html` widens the "Dernières observations" pool from 80 → 500 rows so confidence-filtered dedupe reliably surfaces ~10+ species

### Config sync (1.20.7)
- `writeBirdnetConf` now mirrors `LATITUDE` / `LONGITUDE` to `engine/config.toml` alongside the existing `MODEL` / `CONFIDENCE` sync, keeping the detection engine aligned with the dashboard settings

## [1.5.50] — 2026-04-12

### One-line install
- `curl -sSL .../bootstrap.sh | bash` — fully automated, zero-touch installation
- GeoIP auto-detection of latitude, longitude, and language (via ipapi.co)
- BirdNET V2.4 auto-downloaded during install (CC-BY-NC-SA 4.0 license shown)
- Perch V2 model variant auto-selected per Pi hardware (INT8/FP16/FP32)
- ALSA dsnoop for shared microphone access (recording + dashboard preview simultaneously)

### In-app updates
- Red banner with version number when updates are available (e.g. v1.5.30 → v1.5.48)
- One-click **Install now** with live progress and categorized release notes
- **Later (24h)** / **Skip** snooze options (server-side, persistent across browsers)
- `scripts/update.sh` with auto-migrations, selective service restarts, conflict resolution

### Species sharing
- Share modal with photo + pre-formatted message (🐦 + stats + Birdash promo)
- 7 targets: clipboard (text + image), native share API (with photo on mobile), SMS, WhatsApp, X, Mastodon, Email
- Localized share text in FR/EN/DE/NL with hashtags

### Data integrity (4-round QA audit)
- **safe-config.js** — centralized per-file mutex + atomic write for all 13 config files
- **active_detections VIEW** — rejected detections excluded from all statistics via SQLite ATTACH + TEMP VIEW
- **Confidence filter** applied uniformly to all 70+ queries (was missing in 7 species/overview queries)
- **Aggregates count_07** column — per-detection filtered count replaces the flawed avg_conf proxy (closed 28% gap)
- **UTC→local date fix** — `server/lib/local-date.js` canonical helper replaces 8 toISOString() bugs
- **Cache invalidation** after every mutation (delete, validate, favorite toggle)
- **160 automated tests** including 5 cross-page coherence invariants

### Rarity (eBird-based)
- Species rarity from eBird regional observations (30 days, 25 km radius)
- Conservative fallback: local heuristic only after 30+ days of data
- Fresh installs show 0 rare species (not every species flagged as rare)

### Metric honesty
- Weather correlation: weak r values (|r| < 0.2) hidden, permanent "association ≠ causation" caveat, minimum n≥10
- Confidence: tooltip warning that BirdNET (sigmoid) and Perch (softmax) scores are not directly comparable
- Tooltips on "Rare" (eBird contextual), "Activity" (detection count, not diversity), "Top species" (by volume)

### i18n consolidation
- Single source of truth: inline FR dict moved to `fr.json` (loaded at runtime like en/de/nl)
- `scripts/check-i18n.js` — drift prevention tool (coverage gaps + orphaned t() calls)
- 1155 keys × 4 languages, all aligned
- Legacy `bird-i18n.js` deleted

### Phenology picker
- Custom dropdown with search filter, detection count per species, sorted by frequency
- Species below confidence threshold excluded from picker

### Moon phase
- Standard 8-emoji Unicode set (🌑→🌘) on timeline canvas + header badge

### Model names
- Migration 003: normalized `Perch_v2` → `perch_v2_original`, `Perch_v2_int8` → `perch_v2_dynint8`
- `BirdNET_GLOBAL_6K_V2.4_Model_FP32` added to MODEL_LABELS
- Auto-swap secondary model when it collides with the changed primary

### Settings reliability
- Model badge refreshes on save (no page reload needed)
- `config/adaptive_gain.json` untracked (runtime state, was blocking git pull)

## [1.2.0] — 2026-04-07

### New Pages
- **Phenology calendar** (`phenology.html`) — observed phenology per species
  - 3 view modes: Presence / Abundance / Hourly activity
  - 53-week ribbon visualization filling card width
  - Inferred phases from local detections only:
    - Active period (first → last week with detections)
    - Peak abundance (top quartile weeks)
    - Dawn chorus dominance (>70% detections in 4-8h)
    - First / last observation dates
    - Migrant probability (continuous absence > 4 weeks)
    - Resident probability (≥40 active weeks)
  - Honest disclaimer: phases inferred from station data, not biological reference
  - Accessible via Indicators nav section + species page action card
  - URL parameter `?species=X` for direct linking
  - 5 new SQL queries in `bird-queries.js`

### Lucide Icon System
- New `bird-icons.js` (98 Lucide SVG icons, ISC license)
- New `<bird-icon name="..." :size="18">` Vue component
  - Inline SVG via template ref + onMounted innerHTML (proper SVG namespace)
  - Color via `currentColor`, size via prop
- Migrated 280+ emoji icons to Lucide across all 23 pages:
  - Main navigation (6 sections, 24 items)
  - Mobile bottom nav + drawer
  - Settings tabs (10) + System tabs (6) + backup destinations (5)
  - Dashboard Bird Flow (KPIs, quick nav, zones)
  - Action cards (Phenology + Deep Analysis on species.html)
  - Phenology phase cards
- Kept as emoji intentionally:
  - Unicode symbols ✓ ✕ ✗ ★ ☆ ⚠ ⚙
  - Moon phases 🌕🌑🌒…🌘 (timeline astronomical)
  - Weather emojis ☀🌦🌧💨🌬 (color-coded, semantic)
  - 🍓 Raspberry Pi indicator

### Unified Notification Bell
- Single notification center grouped by severity (replaces separate update button)
  - 🔴 **Critical**: GitHub update available, pipeline blocked (backlog > 20 + lag > 5 min)
  - 🟠 **Warning**: review queue pending, pipeline slow (backlog > 5 or lag > 60s)
  - 🟢 **Birds**: existing /api/whats-new alerts (out_of_season, activity_spike,
    species_return, first_of_year, species_streak, seasonal_peak)
- Bell badge color reflects highest severity present
- Number = total unseen across all categories
- "Seen" state tracked per category in localStorage
- Auto-refresh: critical/warning every 5 min, birds every 10 min
- Items grouped in 3 collapsible sections with colored left border

### Update Notification System
- New `/api/version-check` route — polls GitHub Releases once per 24h
- Server-side cache (1 GitHub call per Pi per day, no rate limit issues)
- Update modal in header with formatted release notes (markdown → HTML)
- "How to update" guide with manual git pull commands
- Dismissed version stored in localStorage

### Action Cards (species page)
- 🔬 Deep Analysis and 📅 Phenology buttons promoted from ext-link list to
  prominent action cards inside the species info panel
- Card layout: large icon, title, sub-text, hover lift, arrow indicator
- Distinct visual identity from external links (Wikipedia, eBird, etc.)

### SQL Query Library Expansion
- 5 new phenology queries: `phenologyYears`, `phenologyWeekly`,
  `phenologyHourlyByWeek`, `phenologyFirstLast`, `phenologyMultiYear`
- Total: 56 centralized queries (was 51)
- All apply `BIRD_CONFIG.defaultConfidence` automatically

### Bug Fixes
- **Critical**: `<bird-icon />` self-closing broke text rendering — Vue 3 only
  supports self-closing in pre-compiled SFC templates, not DOM templates parsed
  by the browser. Following content was eaten as a child of the component.
  Fixed 152 occurrences across 31 files.
- Latest detection now picks max confidence across both AI models (BirdNET +
  Perch) using SQLite bare-column MAX trick
- Bell + nav badge undercount: `flagged-detections` was queried with limit=1
  which only processed 1 detection. Now uses last 7 days + limit=2000 (matches
  review.html default)
- eBird notable observations broken after server modularization: `EBIRD_API_KEY`
  / `EBIRD_REGION` / `BW_STATION_ID` weren't in route context
- BirdWeather events now show species name + confidence (tracked from SSE
  species lines that were filtered out before reaching the parser)
- Settings save: `birdnet.conf` cache (60s TTL) wasn't invalidated after write
- CSS variable `--card-bg` doesn't exist (correct name is `--bg-card`) — bell
  panel and dashboard zones were transparent
- Per-model species in dashboard: regex was matching timestamp brackets
  (`[11:50:35]`) instead of model name brackets (`[perch_v2_original]`)
- Phenology calendar now fills full card width (CSS grid + aspect-ratio)
- Inline phenology calendar removed from species.html (replaced by dedicated
  phenology.html page)
- Detection card photo enlarged (120 → 170px) with confidence ring (38 → 46px)
- Inference time `⚡` icon centered in dual AI cards
- Pipeline + Dual AI: removed BN/P2 text icons, replaced with top accent bar
  + colored model name (BirdNET blue / Perch teal)
- Removed all biloute references (old Pi4 retired) — engine.py, config.toml,
  backup.js: -209 lines of dead code
- Dashboard model labels now use shared `BIRDASH.MODEL_LABELS` (consistent
  variant names: Perch V2 FP32, FP16, INT8)
- Pipeline progress bar centered on dot row instead of crossing through dots
- Connector arrows between Mic/Engine/Detection removed (zones now share
  continuous borders)

### i18n
- 28+ new keys per language (FR/EN/DE/NL) for phenology, bell, update modal,
  action cards

## [1.1.0] — 2026-04-06

### Bird Flow — Live Pipeline Dashboard
- **New landing page** (`dashboard.html`) showing the detection pipeline in real-time
- Flow corridor layout: Mic → Engine → Detection with animated pulse connectors
- **Live audio levels** via SSE `/api/audio/monitor` with breathing glow
- **Dual AI cores** — BirdNET (blue) + Perch V2 (teal) with distinct visual identity
  - Per-model species name + confidence updated live from SSE logs
  - Consensus/divergence indicator when both models detect
- **Pipeline stages** — 4-stage animated flow (Listen → Record → Analyze → Store)
  with progress bar driven by real backend events
- **Latest detection card** with 130px photo, confidence ring, entrance animation
- **Recent species strip** — today's top 8 species with thumbnails
- **Key events feed** — curated from SSE logs, humanized messages
  - BirdWeather events show species + confidence
  - Technical log messages translated to readable French/English
- **KPIs** — detections today, unique species, review queue, system health
- **System status panel** — backlog, lag, sensitivity, recording length
- index.html now redirects to dashboard.html

### UX/UI Audit & Navigation Overhaul
- **6 navigation sections** (was 5): Home, Live, History, Species, Indicators, Station
- **22 pages in nav** (was 18): reintegrated recent, models, recordings (were orphaned)
- **Mobile drawer** — hamburger button opens bottom sheet with all sections/pages
- **Fixed 5 missing NAV_KEYS** — overview, calendar, favorites, weather, log were showing raw key names
- **Fixed mobile nav labels** — weather.html was labeled "Analyses" instead of "Météo"
- **Differentiated nav_timeline/nav_calendar** — were both "Calendrier" in French
- **Homogenized 9 page titles** — 9 English `<title>` tags translated to French
- **Cross-navigation** between settings and system pages (link tabs)

### SQL Query Library
- **`bird-queries.js`** — 51 centralized SQL queries covering all pages
  - Automatic confidence filtering via `BIRD_CONFIG.defaultConfidence`
  - `Q.buildWhere()` helper for parameterized WHERE clauses (replaces inline SQL string building)
  - Fixes SQL injection risk in stats.html (dates were inlined in SQL)
  - 27 queries migrated across 10 pages; 16 pages include the script
  - Organized by domain: general, dashboard, species, detections, temporal, overview, stats, biodiversity, analyses, gallery, rarities
- **Confidence filter harmonized** — dashboard was counting all detections (27 species) while other pages filtered at 70% (16 species); now consistent
- **Settings save fix** — birdnet.conf cache (60s TTL) was not invalidated after write; settings appeared to not save

### Bug Fixes
- **Rate limiting** — reduced dashboard polling from ~18 to ~8 req/min, debounced SSE-triggered refreshes
- **Perch V2 inference time** — regex was case-sensitive, never matched lowercase `perch_v2`
- **SSE log categorization** — API messages (`GET /api/flagged-detections`) were miscategorized as "detection"
- **Vue reactivity** — `Object.assign` instead of full ref replacement prevents data flickering
- **Species persistence** — model cards keep last detected species (dimmed) instead of clearing every 45s

### i18n
- 60+ new translation keys across FR/EN/DE/NL for dashboard, events, model status, navigation

## [1.0.1] — 2026-04-05

### Architecture
- **Server modularization** — server.js split from 5759 to 208 lines (-96%)
  - 11 route modules in `server/routes/` (audio, backup, data, detections, external, photos, settings, system, timeline, whats-new)
  - 3 library modules in `server/lib/` (alerts, config, db)
  - Route modules use `handle(req, res, pathname, ctx)` pattern with dependency injection
- All 141 tests pass unchanged

### Performance
- **i18n extraction** — translations moved from inline JS to `/i18n/*.json` (4 files, loaded async)
  - `bird-vue-core.js`: 218 KB → 62 KB (-72%)
  - Pages await `BIRDASH.ready` before mounting
- **SW cache v100** — precache updated with i18n files

### Code quality
- **`useAudioPlayer()` composable** — shared audio player with rAF progress, seeking, optional Web Audio filters
  - Migrated calendar, recent, today pages — removes ~150 lines of duplicated code
- **Lazy-loaded settings tabs** — settings.html split into 9 tab fragments (2872→1594 lines, -45%)
  - Tabs loaded on first activation via `defineAsyncComponent` + fetch
  - `provide`/`inject` shares reactive state, `keep-alive` caches DOM
- **SEC-05** — Service Worker registration errors now logged instead of silently swallowed

## [1.0.0] — 2026-04-04

First public release. Complete bird detection dashboard for Raspberry Pi.

### Dashboard (15 pages)

**New pages**
- **Calendar** — unified day-by-day view merging timeline + species list + audio player
- **Weather** — dedicated weather/activity correlation page with Pearson r, tomorrow's forecast, species by conditions
- **Log live** — real-time streaming log dashboard (SSE) with color-coded categories, filters, KPIs
- **Favorites** — dedicated page with KPIs, search, sort; heart toggle on all species lists

**Timeline (full-page)**
- Drag-to-zoom on density bar and sky canvas (infinite zoom, min 15 minutes)
- Unified bird density slider (0-100%) replacing separate controls
- SVG sunrise/sunset icons, emoji moon phases with illumination %
- Filter badges with count + blink highlight (10 pulses, opacity only)
- Clusters always expanded into individual markers (no more three-dot bubbles)
- Labels repositioned for high-confidence birds near top
- Zoom preserved when changing density slider
- No flash/spinner when changing slider

**Review**
- Full spectrogram modal with gain/highpass/lowpass filters and loop selection
- Select + delete permanently (DB + audio files) with preview modal and result report
- Purge all rejected with preview
- Badge counter in nav showing pending review count

**Species**
- Favorites system (SQLite-backed with API)
- Personal notes per species and per detection (SQLite)
- Phenology calendar (12-month dot map)
- Year-over-year monthly comparison chart
- Chart PNG export on all 5 charts
- Web Share API with HTTP fallback
- "Deep analysis" link to analyses page
- Swipe gestures on photo carousel

**Today**
- Gain/highpass/lowpass audio filters on spectrogram
- New species filter (clickable KPI + badge)
- URL parameter support (?species=X)

**Detections**
- Per-detection delete button
- New species and favorites filters

**Gallery**
- Tabs: Best catches + Audio library (absorbs recordings)
- New species badge and favorites toggle
- Improved card header (count + max confidence)

### Navigation restructured
- 5 intent-based sections: Live, History, Species, Insights, Station
- Mobile bottom nav bar (< 768px)
- Quick links bar on homepage with weather widget
- Global search supports dates ("3 avril", "03/04", "merle 3 avril")
- Notification bell with unseen count from /api/whats-new
- Review badge counter

### Architecture
- DSP code consolidated into bird-shared.js (-765 lines from 6 HTML files)
- Timeline rendering extracted to bird-timeline.js
- index.html reduced from 72KB to 56KB
- Favorites and notes migrated from localStorage to SQLite with API
- localStorage keys normalized to underscore format with auto-migration
- Service worker cache versioning (v1 → v92)

### Bug fixes
- SRI integrity on Vue CDN (index/timeline)
- authHeaders() in BirdImg (was ReferenceError)
- buildAudioUrl: encode all path segments (accents caused 404s)
- UTC→localDateStr for timeline dates
- Review page: apiBase→apiUrl (was undefined, page completely broken)
- Review badge: total now counts flagged items, not pre-filter rows
- firstday/nocturnal/best/firstyear events no longer absorbed by clusters (priority 1)
- "See this day" routes to calendar for past dates, today for current
- Share button works on HTTP (fallback to execCommand/prompt)
- sessionStorage cleanup: no more mutation during iteration
- onclick removed from safeHtml whitelist (XSS prevention)
- BIRDWEATHER_ID redacted from /api/settings response
- loadFavorites race condition fixed with promise lock
- navSectionClick no longer auto-navigates to first page

### i18n
- All new features translated in FR/EN/DE/NL
- Timeline density labels, filter types, log dashboard labels
- Settings tabs, backup steps, review workflow labels

### API
- `GET/POST /api/favorites` — list/add/remove favorites
- `GET/POST/DELETE /api/notes` — species and per-detection notes
- `GET /api/logs` — SSE stream from journalctl (3 services)
- `GET /api/timeline` — accepts `minConf` and `maxEvents` parameters
- `GET /api/weather` — now includes 2-day forecast
- `DELETE /api/detections` — returns deletion report with file list
- OG meta tags on all 18 HTML pages

### Documentation
- README.md (EN), README.fr.md (FR), README.de.md (DE), README.nl.md (NL) updated
- All screenshots section restructured by navigation sections

---

## [0.1.0] — 2026-03-19

Initial commit. Dashboard with basic detection display, species pages, recordings, statistics, biodiversity analysis, live spectrogram, model comparison, settings, system health.
