# Dead-man switch

`alerts.js` watches ten conditions, but every one of them runs **on the Pi**.
A host without power cannot report its own death: that is how the outage of
**2026-07-07 07:59** stayed invisible for 72 days, until the station was
unplugged and replugged on 2026-09-18.

This switch inverts the logic. Instead of the station reporting a problem, an
external monitor alerts you when the station **stops reporting at all**.

## Setup (one step)

1. Create a check at <https://healthchecks.io> (free tier is enough).
   - **Period**: 5 minutes — **Grace**: 15 minutes.
2. Paste its ping URL into `config/deadman.json`:

   ```json
   { "url": "https://hc-ping.com/<your-uuid>" }
   ```

3. `sudo systemctl start birdash-deadman.service` — then check the log:
   `tail config/deadman.log`

Until `url` is filled in, the script logs a line and exits cleanly, so the
timer is safe to enable before you have an endpoint.

## Installation on other stations

`scripts/migrations/013-deadman-switch.sh` runs automatically from
`scripts/update.sh`. It generates the systemd units with the right `$HOME` and
service user for that host, then enables the timer. Nothing to do by hand
beyond step 2 above.

## What it reports

Each run POSTs a short status body, so the alert email shows the station's
last known state *before* it died:

```
BirdStation OK

services : birdengine=active birdengine-recording=active birdash=active caddy=active
detection: 2026-09-19 13:19:04 (2 min ago)
disk     : 25% used, 654G free
power    : throttled=0x0 temp=49.4'C
host     : bird up since 2026-09-18 19:00:03, load 0.34 0.36 0.36
```

A hard failure POSTs to `<url>/fail` instead, alerting immediately rather than
waiting for the grace period to expire.

## Options (`config/deadman.json`)

| Key | Default | Meaning |
|---|---|---|
| `url` | *(empty)* | Ping URL. Empty = disabled. |
| `fail_url` | `<url>/fail` | Override for non-healthchecks monitors (Uptime Kuma, ntfy…). |
| `db` | *(empty = auto-detect)* | Opened **read-only**, never blocks the engine. Auto-detect tries the BirdNET-Pi layout, then `data/birds.db`, then `birdengine/`. |
| `services` | 4 units | Any unit not `active` is a hard failure. |
| `max_detection_age_min` | `0` (off) | Fail if no detection for N minutes. Leave off unless you accept night/winter false alarms. |
| `min_free_pct` | `10` | Fail below this much free space on `/`. |
| `fail_on_undervoltage` | `false` | Fail when the SoC reports under-voltage *now*. |

## Why under-voltage is reported

`vcgencmd get_throttled` flags under-voltage both **now** (bit 0) and **since
boot** (bit 16). A PSU or USB-C cable on its way out usually announces itself
this way first. Given that the July outage was a power-path failure, this is
the one metric worth watching before it becomes another 72-day gap.
