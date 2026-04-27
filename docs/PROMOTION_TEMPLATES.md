# Promotion Templates

Drafts prêts à copier-coller pour annoncer BirdStation sur différentes
communautés. Adapter le ton et la longueur selon la plateforme avant de
poster. **Une plateforme à la fois**, ne pas spammer.

> Chaque post devrait inclure au minimum 1 image (idéalement un GIF) en
> haut. La social preview de 1280×640 (`screenshots/social-preview.png`)
> fonctionne aussi pour ces posts. Pour les GIFs, capturer 5–10s de
> spectrogramme live ou de la timeline qui scrolle.

---

## Hacker News (Show HN) — 1 chance, préparer

**Title** (max 80 chars, sans emojis ni superlatifs) :

> Show HN: BirdStation – real-time bird detection dashboard for Raspberry Pi

**Body** (1–3 paragraphes courts) :

```
Hi HN — I built BirdStation, a real-time bird detection dashboard that runs
on a Raspberry Pi (3/4/5). It uses two ML models in parallel — BirdNET V2.4
and Perch V2 — and gives you a single dashboard to explore detections by
species, time of day, season, weather correlation, and more.

What's different from BirdNET-Pi (which it's compatible with):
- Dual-model inference: shows where the two models agree/disagree per species
- Weather context per detection (temperature, wind, pressure correlations)
- Live spectrogram with playback of recent detections
- 4 languages (EN/FR/DE/NL), PWA, dark/light/lab themes
- Modern Vue 3 frontend, no build step (vendored, edit-and-reload)
- ~30 pages: today, calendar, timeline, species, rarities, comparisons,
  biodiversity indices (Shannon/Simpson), phenology, model comparison

Stack: Node.js + better-sqlite3, Vue 3 Composition API, Chart.js + ECharts,
Python inference engine, no build step.

It's MIT, designed to install in under 30 minutes on a fresh Pi. There's a
community map of live stations: https://ernens.github.io/birdash-network/

Repo: https://github.com/ernens/birdash
```

**Tips HN** :
- Poster un mardi ou mercredi 13–16h CET (8–11am ET = peak HN traffic)
- Réponds à TOUS les commentaires les premières 2 heures (signal d'engagement)
- Pas de "please upvote" — instant flag

---

## Reddit r/raspberry_pi (3M+ members)

**Title** :

> I built BirdStation — a real-time bird detection dashboard for Pi with dual ML models (BirdNET + Perch V2)

**Body** :

```markdown
Hey r/raspberry_pi 👋

After a year of running BirdNET on a Pi 4 in my garden, I wanted a more
modern interface that could:
- show me what was detected *today* at a glance
- correlate detections with weather
- compare my two models (BirdNET V2.4 vs Perch V2) side-by-side

So I built **BirdStation** — a complete dashboard + inference engine
that runs on Pi 3 / 4 / 5. Compatible with BirdNET-Pi if you already have
that running.

**Features:**
- Real-time spectrogram with playback of recent clips
- ~30 pages including species deep-dive, calendar heatmap, phenology,
  rare species inventory, biodiversity indices
- Weather correlation (temperature, wind, pressure) per detection
- 4 languages: EN/FR/DE/NL
- PWA — installs as a standalone app on phone
- 3 themes including a sober "lab" theme for desktop monitoring

**Stack:** Node.js, Vue 3 (no build step), SQLite, Python inference.
MIT license.

Setup is a single script — under 30 min on a fresh Pi.

[Screenshot grid] (image)
[Live spectrogram GIF] (image)

Repo: https://github.com/ernens/birdash
Live station map: https://ernens.github.io/birdash-network/

Happy to answer questions!
```

**Best time** : weekday morning ET (15h–17h CET)

---

## Reddit r/selfhosted (300k+ members)

**Title** :

> BirdStation — self-hosted bird detection dashboard with dual-model inference, weather correlation, 4 languages

**Body** :

```markdown
**What it solves:** I wanted a self-hosted bird detection setup that wasn't
just BirdNET-Pi's basic UI — something that could compare two models, show
weather correlations, and feel like a real dashboard rather than a logger.

**What it is:** BirdStation runs on a Raspberry Pi 3/4/5. Standalone — no
cloud dependency. Optional opt-in network for a community map of stations.

**Highlights for self-hosters:**
- Single Node.js process + Python worker, ~150MB RAM idle
- SQLite, no DB server to manage
- Auto-update flow built in (in-app trigger, no SSH)
- Backup support (rsync to NAS / USB / S3)
- Service worker = full offline PWA
- All data stays on your Pi unless you opt into the community network
- Health dashboard with services control, logs, restart from UI

**Privacy:** anonymous pings (Pi model + country, no GPS/UUID) by default,
fully disableable. Community map opt-in only.

**Stack:** Node 18+, Vue 3 (vendored, edit-and-reload), Python inference,
SQLite, Caddy.

Repo: https://github.com/ernens/birdash
Live map: https://ernens.github.io/birdash-network/

MIT, contributions welcome.
```

---

## Reddit r/birdwatching (500k+ members)

**Title** (less technical, outcome-focused) :

> I built a free dashboard for the BirdNET-Pi crowd — visualize who's singing in your garden, when, and how the weather affects them

**Body** :

```markdown
Hey fellow bird folks! 🐦

If you have (or want) a small device that listens to bird songs and
identifies them automatically — this is for you.

I run a Raspberry Pi in my Belgian garden that picks up everything from
robins at dawn to owls at night. Over a year I logged about 50,000
detections, but the existing tools to *look at* that data felt clunky.

So I built **BirdStation**: a free, open-source dashboard that turns your
detections into something fun to explore.

**Things it lets you do:**
- See which species sang most this morning vs yesterday
- Look at the seasonal phenology of any species (when do swallows arrive
  and leave?)
- Compare two species side by side
- Pinpoint rare detections in your year
- Listen to a spectrogram of what was actually recorded
- See if a particular wind direction brings new birds

**Setup:** under 30 minutes on a Raspberry Pi. Compatible with BirdNET-Pi
if you already have that.

[Screenshots]

Repo: https://github.com/ernens/birdash
Live map of registered stations: https://ernens.github.io/birdash-network/

Curious what species you're picking up — drop a screenshot in the comments!
```

---

## Reddit r/homelab (700k+ members)

**Title** :

> [Project] BirdStation — Raspberry Pi bird detection dashboard, dual-model ML, weather, full PWA

**Body** : reuse r/selfhosted body but emphasize :
- The ops side: Caddy reverse proxy, systemd services, health dashboard
- Migration path from existing BirdNET-Pi installs
- Backup story
- Resource footprint

---

## Mastodon

**Post 1 — annonce courte** :

```
🐦 Just released BirdStation — a real-time bird detection dashboard
for Raspberry Pi.

✨ Dual-model ML (BirdNET + Perch V2)
🌦️ Weather correlation per detection
📊 30+ pages of analytics
🌐 4 languages (EN/FR/DE/NL)
🔓 MIT, self-hosted

https://github.com/ernens/birdash

#birdwatching #raspberrypi #selfhosted #opensource #birdnet #bioacoustics
```

**Post 2 — thread visuel (1 image par toot, 4–5 toots)** :
1. screenshot today.html + "Just shipped — BirdStation v1.45.0…"
2. screenshot spectrogram.html + "Live spectrogram with playback…"
3. screenshot biodiversity.html + "Shannon, Simpson, dominance — all explained…"
4. screenshot system.html + "Health dashboard with services control…"
5. screenshot dashboard.html + "Live pipeline visualization. MIT, link in bio."

---

## Awesome-* lists — PR drafts

### awesome-selfhosted

**Repo:** https://github.com/awesome-selfhosted/awesome-selfhosted

**Category:** `Home Automation > IoT / Smart Home` (or `Science and Education`)

**Line to add (alphabetical position)** :

```markdown
- [BirdStation](https://github.com/ernens/birdash) - Real-time bird detection dashboard for Raspberry Pi with BirdNET + Perch V2 dual-model inference, weather correlation, live spectrogram, 4 languages. ([Demo Network](https://ernens.github.io/birdash-network/), [Source Code](https://github.com/ernens/birdash)) `MIT` `Nodejs/Vue/Python`
```

**PR title** : `Add BirdStation`

**PR body** :

```markdown
## What is it?

BirdStation is a real-time bird detection dashboard that runs entirely on a
Raspberry Pi (3/4/5). It uses two ML models (BirdNET V2.4 + Perch V2) to
identify bird species from microphone audio, and provides a complete dashboard
to explore detections.

## Why selfhosted?

- All data stays on the user's Pi (no cloud dependency)
- Optional opt-in community network with anonymous data only
- Auto-update flow built-in (no SSH needed)
- Backup support to NAS/USB/S3
- ~150MB RAM idle, runs comfortably on Pi 3

## Stack

- Backend: Node.js 18+, SQLite (better-sqlite3), Python inference engine
- Frontend: Vue 3 Composition API (vendored, no build step), Chart.js + ECharts
- License: MIT

## Verification

- README: https://github.com/ernens/birdash/blob/main/README.md
- Screenshots: 30+ in https://github.com/ernens/birdash/tree/main/screenshots
- Live demo: https://ernens.github.io/birdash-network/

Let me know if a different category fits better — I think "IoT / Smart Home"
because it bridges sensor + dashboard, but "Science and Education" could
also work given the citizen-science angle.
```

---

### awesome-raspberry-pi (multiple forks — pick the most active)

**Active fork** : https://github.com/thibmaek/awesome-raspberry-pi

**Category** : `Cool Projects` or `Home automation`

**Line** :

```markdown
- [BirdStation](https://github.com/ernens/birdash) - Real-time bird detection dashboard with BirdNET + Perch V2 dual-model inference, weather correlation, and a 4-language Vue 3 PWA. MIT.
```

**PR body** : reuse awesome-selfhosted body, trim the IoT section.

---

### awesome-bioacoustics (less standardized)

**Repo to check** : https://github.com/rhine3/bioacoustics-software

**Category** : "Acoustic monitoring" or "Visualization"

**Format** :

```markdown
**[BirdStation](https://github.com/ernens/birdash)** — Real-time bird detection
dashboard for Raspberry Pi. Combines BirdNET V2.4 and Perch V2 with weather
correlation, live spectrogram, and biodiversity indices (Shannon, Simpson,
Pielou's evenness). Citizen-science friendly, 4 languages. MIT.
```

---

## Repobeats analytics graph (manual setup, ~2 min)

Aller sur https://repobeats.axiom.co/, sign in avec GitHub, ajouter le repo
`ernens/birdash`. Récupérer l'URL d'embed (forme
`https://repobeats.axiom.co/api/embed/HASH.svg`) et ajouter dans le README
sous Star History :

```markdown
## Activity

![Repobeats analytics image](https://repobeats.axiom.co/api/embed/YOUR_HASH.svg)
```

Effet "ce projet est vivant" sur les 28 derniers jours : commits, PRs, issues.

---

## Suivi

Tableau pour tracker ce qui a été posté + résultats :

| Plateforme | Date | URL post | Stars gagnés J+7 | Notes |
| --- | --- | --- | --- | --- |
| HN Show HN | | | | |
| r/raspberry_pi | | | | |
| r/selfhosted | | | | |
| r/birdwatching | | | | |
| r/homelab | | | | |
| Mastodon | | | | |
| awesome-selfhosted | | | | PR # |
| awesome-raspberry-pi | | | | PR # |
| awesome-bioacoustics | | | | PR # |
