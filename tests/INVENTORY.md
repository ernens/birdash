# Birdash — Inventaire UI pour tests Playwright

Source : repo `birdash` à HEAD (v1.55.17, commit `2911554`).
Dernière mise à jour : 2026-05-15 (rafraîchi depuis le Pi en production READ-ONLY).

> **TL;DR sélecteurs** : ~285 `data-testid` posés (commits `591e684`, `59697d7`,
> `cb60fd6` + ajouts `detections.html` / `purge.html`). Le shell global
> (nav + header + mobile-nav + modals) en plombe ~53. Les compléments
> P0/P1/P2 restants sont listés en § 7.

---

## 0. Contrat de sécurité

Cet inventaire a été produit **READ-ONLY** sur une station Pi en production
(`https://192.168.2.217/birds/`) contenant des données réelles. Toutes les
visites n'utilisent que des navigations + lectures de DOM et de réseau.
**Aucune** des actions suivantes n'a été effectuée pendant la collecte :
clic sur Save / Apply / Reset settings ; clic sur les boutons de revue
(✓ ? ✗) ou ★ favoris ; export CSV / eBird ; spectro « ▶ Démarrer » ;
options de thème / langue (persistées via `/api/settings`) ; power tiles ;
banner / modal update ; bug-report submit ; purge / trash / restore /
delete ; appel de `/api/apply-update`. Aucun POST/PUT/PATCH/DELETE n'a été
émis par l'opérateur ; seules les requêtes spontanées de Birdash
(`POST /api/query` notamment) sont visibles dans les traces réseau. La
contrainte d'origine — *« ne pas détruire, effacer, corrompre, perturber »* —
est respectée intégralement.

---

## 1. Architecture & contraintes

- **Framework** : Vue 3 chargé en CDN global (`js/vue.global.prod.min.js`).
  Aucun build : chaque `*.html` est un shell autonome qui boote Vue
  (`createApp(...).mount('#app')`). Le router est *côté serveur* (Caddy)
  + des `<a href="X.html">` côté client — pas de SPA history-based.
- **Bundle commun** : `public/js/bird-vue-core.js` (shell `<birdash-shell>`,
  nav, header, modals globaux, composables `useI18n`, `useTheme`, `useNav`,
  `useFilterPeriod`, `useFilterConfidence`, `useChart`, `useAudio`,
  `useFavorites`, etc.). `public/js/bird-config.js` déclare la nav.
- **Caddy** sert n'importe quel chemin `*.html` avec le shell ; un fichier
  inexistant donne **200** et le `index.html`. Toujours **vérifier
  `document.title`** ou `<h1>` après navigation pour distinguer un 404 silencieux.
- **Redirections observées au boot** :
  - `index.html` → `today.html`
  - `login.html` → `overview.html` (si déjà authentifié)
  - `recent.html` → `calendar.html`
  - `gallery.html` → `recordings.html`
  - `models.html` → `stats.html?tab=models`
- **i18n** : 4 langues chargées au boot (`/birds/i18n/{fr,en,de,nl}.json`).
  Le titre passe de `BirdStation — <i18n_key>` à `<siteName> — <traduction>`
  ≈ 1–2 s après le `load` event. **Toujours attendre 3-5 s** ou
  `page.waitForFunction(() => document.title.includes('—'))` avant assertion.
  Exception observée : `species.html` rend `BIRDASH — <espèce>` (cf. § 7).
- **Service Worker** : `sw.js` actif en production. En dev local sur cert
  auto-signé l'enregistrement échoue (`SSL certificate error … sw.js`) — à ignorer.
- **Auth interceptor** : un wrapper `fetch` redirige vers `login.html`
  sur 401 (sauf endpoints `/api/auth/*`).
- **Cert auto-signé** : lancer Playwright avec `ignoreHTTPSErrors: true`.

---

## 2. Routes canoniques

Source : `public/js/bird-config.js` lignes 50–88. **26 pages** distinctes.

| Section (i18n) | id config | URL | Notes |
|---|---|---|---|
| Accueil | `overview` | `overview.html` | dashboard d'entrée |
| Accueil | `today` | `today.html` | cible de `index.html` |
| En direct | `dashboard` | `dashboard.html` | « Bird Flow » — pipeline live |
| En direct | `liveboard` | `liveboard.html` | mosaïque KPI kiosque |
| En direct | `dashboard_kiosk` | `dashboard-kiosk.html` | « Bird Pulse » — affichage TV |
| En direct | `spectrogram` | `spectrogram.html` | spectro live |
| Historique | `calendar` | `calendar.html` | calendrier mensuel |
| Historique | `timeline` | `timeline.html` | journal d'une journée |
| Historique | `detections` | `detections.html` | liste filtrable multi-jour |
| Historique | `review` | `review.html` | file de validation |
| Espèces | `species` | `species.html` | fiche détail (deep-link `?species=X`) |
| Espèces | `rarities` | `rarities.html` | raretés |
| Espèces | `recordings` | `recordings.html` | meilleurs enregistrements |
| Espèces | `favorites` | `favorites.html` | watchlist en 4 buckets |
| Indicateurs | `quality` | `quality.html` | calibration + accord modèles |
| Indicateurs | `weather` | `weather.html` | météo & oiseaux |
| Indicateurs | `stats` | `stats.html` | stats générales |
| Indicateurs | `analyses` | `analyses.html` | analyses dérivées |
| Indicateurs | `models` | `stats.html?tab=models` | onglet de `stats.html` |
| Indicateurs | `comparison` | `comparison.html` | rapport saisonnier |
| Indicateurs | `compare` | `compare.html` | comparaison période |
| Indicateurs | `phenology` | `phenology.html` | calendrier phénologique |
| Station | `settings` | `settings.html` | config (10 onglets lazy) |
| Station | `system` | `system.html` | supervision |
| Station | `log` | `log.html` | log live (SSE) |
| Station | `purge` | `purge.html` | corbeille / purge des détections |

**Hors-nav** mais accessibles : `login.html`, `biodiversity.html`,
`gallery.html`→recordings, `models.html`→stats, `recent.html`→calendar,
`index.html`→today.

**Deep-links via querystring** :

- `species.html?species=<NomVernaculaire>`
- `phenology.html?species=<NomVernaculaire>`
- `review.html?species=<NomVernaculaire>&date=YYYY-MM-DD`
- `detections.html?species=<NomVernaculaire>`
- `stats.html?tab={models|...}`
- `timeline.html?date=YYYY-MM-DD`
- `settings.html#detection` (et autres ancres pour scroll-to)

---

## 3. Convention de sélecteurs

`data-testid` en **kebab-case, préfixé par contexte** :

| Préfixe | Portée |
|---|---|
| `nav-*` | Nav desktop (sections + items) |
| `nav-drawer-*` | Drawer mobile (sections + items) |
| `mobile-nav-*` | Bottom bar mobile |
| `header-*` | Tous utilitaires du header (search, bell, theme, lang, login…) |
| `species-card` | **Plat** — toute carte d'espèce, partout (today/dashboard/favorites). Discriminé par `data-species` / `data-sci` |
| `review-*` | review.html (sélection, actions, bulk, banner, delete) |
| `settings-*` | settings.html et tous les onglets (`settings-<tab>-<config-key>`) |
| `detections-*` | detections.html (liste, export, pagination, row) |
| `filter-period-*` | Composant `<filter-period>` (boutons 1d/7d/30d/…) |
| `filter-confidence-*` | Composant `<filter-confidence>` (slider/edit) |
| `filter-*` (autres) | Filtres globaux d'une page (`filter-species`, `filter-guild`, `filter-family`, `filter-order`, `filter-favorites-only`, `filter-new-species-only`, `filter-reset`) |
| `purge-*` | purge.html (rows, actions, vue Active/Corbeille) |
| `update-banner-*`, `update-modal-*` | Bannière + modal d'auto-update |
| `bug-report-*`, `power-*` | Modals globaux |

Pour les éléments répétés en `v-for`, ajouter aussi un **attribut data
discriminant** : `:data-species`, `:data-sci`, `:data-date`, `:data-time`,
`:data-reason`, `:data-theme`, `:data-lang`, `:data-model`, `data-bucket`,
`:data-confidence`, `:data-chip`.
Cela permet de cibler `[data-testid="species-card"][data-sci="Turdus merula"]`.

**Anti-pattern** : ne pas réintroduire `data-test=` (l'ancienne convention
de `detection.html`, migrée vers `data-testid` au commit `59697d7`).

---

## 4. Couverture actuelle des `data-testid`

Mesures relevées en live au 2026-05-15. Le shell global (nav + header +
mobile-nav + modals) ajoute systématiquement **53** testids à chaque page.

| Page | Total interactifs | data-testid | aria-only | href-only | Testids spécifiques page |
|---|---:|---:|---:|---:|---|
| `overview.html` | 97 | 53 | 1 | 15 | — (shell only) |
| `today.html` | 225 | 55 | 26 | 15 | `species-card`, `today-species-favorite` |
| `dashboard.html` | 112 | 54 | 0 | 20 | `species-card` |
| `liveboard.html` | 5 | 0 | 0 | 4 | — (sans shell : iframe-like) |
| `dashboard-kiosk.html` | 5 | 0 | 0 | 4 | — (sans shell) |
| `spectrogram.html` | 107 | 53 | 1 | 10 | — |
| `calendar.html` | 95 | 53 | 3 | 11 | — |
| `timeline.html` | 101 | 53 | 0 | 10 | — |
| `detections.html` | 367 | 78 | 50 | 110 | `detections-export-csv`, `detections-export-ebird`, `detections-list`, `detections-pagination`, `detections-result-count`, `detections-row`, `filter-family`, `filter-favorites-only`, `filter-guild`, `filter-new-species-only`, `filter-order`, `filter-reset`, `filter-species`, `filter-species-placeholder`, `filter-species-trigger` |
| `review.html` | 494 | 71 | 43 | 10 | `review-action-confirm`, `review-action-doubtful`, `review-action-reject`, `review-confidence-filter`, `review-list`, `review-reject-by-reason`, `review-row`, `review-row-play`, `review-row-spectro`, `review-select-all`, `review-select-row`, `review-show-more` (+ `filter-period-*`, `review-bulk-*`, `review-go-purge` rendus conditionnellement) |
| `species.html` | 161 | 60 | 6 | 20 | `species-detail-header`, `species-detail-title`, `species-detection-row`, `species-favorite`, `species-next`, `species-picker`, `species-prev` |
| `rarities.html` | 217 | 63 | 34 | 25 | — |
| `recordings.html` | 255 | 63 | 8 | 118 | — |
| `favorites.html` | 116 | 55 | 8 | 10 | `favorites-remove`, `species-card` |
| `quality.html` | 101 | 53 | 0 | 16 | — |
| `weather.html` | 118 | 53 | 0 | 10 | — |
| `stats.html` | 164 | 64 | 27 | 11 | — |
| `stats.html?tab=models` | 225 | 64 | 27 | 72 | — |
| `analyses.html` | 188 | 64 | 7 | 10 | — |
| `comparison.html` | 149 | 53 | 51 | 15 | — |
| `compare.html` | 101 | 53 | 0 | 10 | — |
| `phenology.html` | 96 | 53 | 0 | 10 | — |
| `settings.html` | 153 | 96 | 0 | 10 | 42 spécifiques onglet `detection` au boot — `settings-tab-{detection|audio|notif|station|services|species|backup|database|terminal|external-display|monitoring}`, `settings-save-bar`, `settings-save`, `settings-reset-defaults`, `settings-tabs`, et tous les `settings-detection-*` listés ci-dessous |
| `system.html` | 93 | 53 | 0 | 10 | — |
| `log.html` | 96 | 53 | 0 | 10 | — |
| `purge.html` | 252 | 54 | 0 | 10 | `purge-row-spectro` |
| `biodiversity.html` | 110 | 64 | 5 | 13 | — |

**Settings — testids présents au boot (onglet `detection` actif)** :
`settings-detection-audiofmt`, `…-birdnet-confidence`, `…-birdnet-echo-confidence`,
`…-channels`, `…-dog-filter-cooldown-sec`, `…-dog-filter-enabled`,
`…-dog-filter-threshold`, `…-dual-confirm-enabled`, `…-extraction-length`,
`…-model-option`, `…-noisy-throttle-enabled`, `…-overlap`,
`…-perch-confidence`, `…-perch-min-margin`, `…-perch-standalone-confidence`,
`…-privacy-filter-delete-audio`, `…-privacy-filter-enabled`,
`…-privacy-filter-threshold`, `…-profile-load`, `…-profile-save-as`,
`…-profile-select`, `…-profiles`, `…-range-filter-perch-ebird`,
`…-recording-length`, `…-sensitivity`, `…-sf-thresh`,
`…-throttle-bypass-confidence`, `…-throttle-cooldown-seconds`.
Les autres onglets (`audio`, `notif`, `station`, `backup`, `services`,
`species`, `database`, `external-display`, `terminal`, `monitoring`)
chargent leurs templates en lazy → leurs ~130 testids supplémentaires
n'apparaissent qu'après clic sur l'onglet correspondant.

**Total testids ≈** 53 shell + 219 spécifiques pages = **272** uniques en
production observée (settings ajoute encore ~130 quand tous ses onglets
sont visités).

---

## 5. Comportements asynchrones

### 5.1 SSE — EventSource (toujours pas de WebSocket)

Confirmé en live, **3 endpoints SSE** consommés au boot des pages
suivantes :

| Page | URL SSE | Usage |
|---|---|---|
| `dashboard.html` | `GET /api/audio/monitor` | niveau du micro (barres animées) |
| `dashboard.html` | `GET /api/logs` | flux d'événements clés |
| `liveboard.html` | `GET /api/audio/monitor` | micro level kiosque |
| `liveboard.html` | `GET /api/logs` | flux pour ticker kiosque |
| `log.html` | `GET /api/logs` | log live complet (le flux exact peut être amorcé après une interaction, pas systématiquement au boot) |
| `purge.html` | `GET /api/logs` | listen pour invalider la liste après une purge |
| `settings.html` onglet audio | `GET /api/audio/monitor` | preview niveaux pendant la config |
| `spectrogram.html` | (pas d'SSE au boot ; flux audio bin start sur « ▶ Démarrer ») | — |

### 5.2 Polling global (bird-vue-core.js)

| Cadence | Fonction | Endpoint / effet |
|---|---|---|
| 1 000 ms | tick d'un countdown UI | (UI only) |
| 2 000 ms | `_updatePollTimer` | `GET /api/update-status` |
| 5 min | `refreshAllAlerts` | recharge la bell + bandeau update |
| 10 min | `loadBirdsAlerts` | rare/nouvelles espèces pour la bell |

### 5.3 Polling par page (mesuré ou tiré du source)

| Page | Cadence | Cible |
|---|---|---|
| `today.html` | 60 s | `refreshLive` (recharge le jour) |
| `dashboard.html` | 30 s | KPIs, dernière détection |
| `dashboard.html` | 45 s | espèces récentes |
| `dashboard.html` | 60 s | status pipeline |
| `dashboard-kiosk.html` | 10 s | horloge |
| `dashboard-kiosk.html` | 30 s | refresh-all + now-marker |
| `dashboard-kiosk.html` | 10 min | météo |
| `liveboard.html` | 10 s | horloge |
| `liveboard.html` | 30 s | refresh-all |
| `liveboard.html` | 10 min | météo |
| `spectrogram.html` | 1 s | horloge |
| `spectrogram.html` | variable | détections live micro |
| `overview.html` | 5 min | what's new |
| `system.html` | 5–10 s | services + santé + hardware |
| `settings.html` (audio tab) | 5 s | niveau sonore |
| `settings.html` (external-display tab) | 5 s | status TFT |
| `settings.html` (backup tab) | 2 s | progression backup |
| `timeline.html` | variable | tick UI |
| `log.html` | flux SSE | pas de polling — `EventSource` direct |
| `purge.html` | variable | invalidate après SSE log event |

### 5.4 Endpoints `/api/*` rencontrés (catalogue consolidé)

```
/api/alert-thresholds            /api/analysis-status
/api/apprise                     /api/audio/adaptive-gain/{config,state}
/api/audio/boost                 /api/audio/config
/api/audio/devices               /api/audio/monitor (SSE)
/api/audio/noise-profile/status  /api/audio/profiles
/api/audio-device                /api/auth/status
/api/backup-{config,history,progress,schedule,status}
/api/birdweather/status          /api/bug-report/status
/api/calendar/month?from=&to=&conf=
/api/detection-profiles          /api/detections/bbox?file=
/api/favorites                   /api/favorites/stats
/api/flagged-detections?dateFrom=&dateTo=&limit=
/api/hardware                    /api/health
/api/languages                   /api/logs (SSE)
/api/models                      /api/network-info
/api/notes?com_name=…            /api/photo?sci=…
/api/purge/{list,stats}          /api/query (POST, multiplexé)
/api/quality?days=               /api/range-filter/preview?threshold=
/api/rare-today?date=            /api/seasons/report?season=&year=
/api/services                    /api/settings
/api/settings/auto-purge         /api/setup/status
/api/species-info?sci=&lang=     /api/species-lists
/api/species-names?lang=         /api/species-videos?sci=
/api/system-health               /api/taxonomy?lang=
/api/telemetry/{anonymous-pings,status}
/api/timeline?date=&minConf=&maxEvents=
/api/update-status               /api/weather?days=
/api/weather/match-summary       /api/weather/range?from=&to=
/api/weather/species-by-condition?codes=|precip_min=|temp_max=|wind_min=
/api/weather/species-heatmap?top= /api/weather/species-profile?species=
/api/whats-new
```

### 5.5 Implications Playwright

- **SSE** : `page.route('**/api/audio/monitor', …)` peut casser le mic preview
  → désactiver ou mock-er. Idem pour `/api/logs`.
- **Polling court** : un test qui modifie une détection puis vérifie l'UI
  doit attendre ≤ 60 s ou intercepter `/api/query` pour stub-er la réponse.
- **i18n** : préférer `page.waitForFunction(() => document.title.includes('—') && !document.title.startsWith('BirdStation —'))`
  à `expect(page).toHaveTitle(…)` strict.
- **Cert** : `ignoreHTTPSErrors: true` côté config + `--ignore-https-errors`
  côté MCP.
- **SW** : ignorer les warnings `SSL certificate error … sw.js` en dev.
- **Redirections silencieuses** : `index.html`, `gallery.html`, `recent.html`,
  `models.html`, `login.html` (si auth) redirigent **avant** que le test
  ait le temps d'observer la page demandée. Toujours vérifier `location.href`
  après navigation.

---

## 6. Inventaire détaillé par page

### 6.0 Shell global (présent sur toutes les pages avec birdash-shell)

- **Nav desktop** : `nav-{section-home|section-realtime|section-history|section-species|section-indicators|section-system}` (6 sections) + `nav-{overview|today|dashboard|liveboard|dashboard_kiosk|spectrogram|calendar|timeline|detections|review|species|rarities|recordings|favorites|quality|weather|stats|analyses|models|comparison|compare|phenology|settings|system|log|purge}` (26 items).
- **Mobile bottom nav** : `mobile-nav`, `mobile-nav-{overview|today|species|stats|more}`.
- **Header utils** : `header-{model-link|search-toggle|search-input|search-clear|search-results|search-result(*data-sci)|login|logout|birdweather|bug-report|power|notifications|notifications-panel|theme-toggle|theme-menu|theme-option(*data-theme)|lang-toggle|lang-menu|lang-option(*data-lang)}`.
- **Modals globaux** : `update-banner`, `update-banner-view`, `update-modal`, `update-modal-{close|install|skip|defer|rollback|rollback-failed|reload|force|dismiss}` ; `bug-report-modal`, `bug-report-{close|title|description|attach-logs|cancel|submit}` ; `power-modal`, `power-{close|restart-service|reboot|shutdown|confirm-cancel|slide-track|slide-cancel}`.
- **Skip link** « Aller au contenu » : présent partout, sans testid (P2 — `header-skip-link` à poser).

### 6.1 `overview.html` — Vue d'ensemble

- **Title rendered** : `Heinsch, Belgium — Vue d'ensemble`
- **H1** : `Accueil`
- **Interactive total / testid / aria-only / href-only** : 97 / 53 / 1 / 15
- **Testids spécifiques** : aucun — tous les liens KPI sont des `<a>` typés et tracés par href stable.
- **Critical missing testids** :
  - KPI rares (« 4 ESPÈCES RARES AUJOURD'HUI ») → `overview-kpi-rares`
  - Tab « DERNIÈRE DÉTECTION » → `overview-featured-tab` `:data-tab="last"`
  - Tab « MEILLEURE DU JOUR » → `overview-featured-tab` `:data-tab="best"`
  - Bouton ▶ play sur la featured detection → `overview-featured-play`
- **API observée au boot** : `GET /api/settings`, `GET /api/species-names?lang=fr`, `GET /api/update-status`, `GET /api/whats-new`, `GET /api/flagged-detections`, `GET /api/bug-report/status`, `GET /api/birdweather/status`, `GET /api/auth/status`, `GET /api/rare-today?date=…`, `GET /api/weather/range?from=&to=`, `GET /api/setup/status`, `GET /api/analysis-status`, `GET /api/weather?days=1`, `POST /api/query` (×9).
- **Notes** : Polling 5 min sur `/api/whats-new`. La page est très légère en data SQL — la plupart des chiffres viennent de `/api/query` agrégés.

### 6.2 `today.html` — Aujourd'hui

- **Title** : `Heinsch, Belgium — Aujourd'hui`
- **H1** : `Aujourd'hui`
- **Interactive** : 225 / 55 / 26 / 15
- **Testids spécifiques** : `species-card`, `today-species-favorite`.
- **Critical missing testids** :
  - Slider confiance globale → `today-confidence-slider`
  - KPI buttons (« 40 ESPÈCES », « 0 NOUVELLES ESPÈCES », « Rares 4 », « Signal solide 10 », « À revoir », « Toutes ») → `kpi-{all|new|rare|robust|review}`
  - Tri `<select>` (Nombre / Première détection / Confiance max / Nouvelles) → `today-sort`
  - Input de filtre → `today-filter`
  - Pills `td-pill` (Toutes / Rares / Signal solide / À revoir / Nouvelles) → déjà nommées ci-dessus
  - Lecteur audio : `▶` (`play-big`) → `audio-play` ; `freq-toggle-btn`, `spectro-expand-btn`, gain ×6 (`+5`/`+10`/`+15`/`+20`/Off), HP ×6 (`200`/`500`/`1k`/`2k`/Off), LP ×6 (`3k`/`6k`/`9k`/`12k`/Off) → `audio-{gain|hp|lp}-{value}` ; « Nettoyer le son » → `audio-clean`.
- **API au boot** : `GET /api/favorites`, `GET /api/species-names`, `GET /api/settings`, `GET /api/whats-new`, `GET /api/flagged-detections`, `GET /api/weather/range`, `GET /api/rare-today`, `GET /api/detections/bbox?file=…`, `GET /api/analysis-status`, `POST /api/query` (×7).
- **Notes** : Polling `refreshLive` 60 s. Les pills `td-pill--active` peuvent être ciblées via la classe pour vérifier l'état sélectionné.

### 6.3 `dashboard.html` — Bird Flow

- **Title** : `Heinsch, Belgium — Tableau de bord`
- **H1** : `Bird Flow`
- **Interactive** : 112 / 54 / 0 / 20
- **Testids spécifiques** : `species-card`.
- **Critical missing testids** : 4 KPI cards (Détections / Espèces / À valider / Santé) sont des `<a href>` stables — pas critiques. À ajouter en P1 : `dashboard-kpi-{detections|species|review|health}`.
- **API au boot** : shell + `POST /api/query` pour les agrégats. Plus **SSE** : `/api/audio/monitor` et `/api/logs`.
- **Notes** : Pipeline live, dual-AI cores, fusion bar — aucune interaction utilisateur (read-only display).

### 6.4 `liveboard.html` — Live Board

- **Title** : `BirdStation — Live Board` *(reste en anglais, pas de re-rendu i18n du titre)*
- **H1** : absent
- **Interactive** : 5 / 0 / 0 / 4
- **Testids spécifiques** : aucun.
- **Critical missing testids** : bouton `d-fullscreen` → `liveboard-fullscreen`. Les 4 `<a>` href-only sont des deep-links vers d'autres pages (déjà stables).
- **API au boot** : `GET /api/audio/monitor` (SSE), `GET /api/logs` (SSE), `GET /api/species-names`, `GET /api/update-status`, `GET /api/weather?days=1`, `POST /api/query`.
- **Notes** : **Pas de shell birdash-vue** (mode kiosque dédié). Polling 10 s horloge / 30 s refresh-all / 10 min météo.

### 6.5 `dashboard-kiosk.html` — Bird Pulse / Kiosk

- **Title** : `BirdStation — Kiosk` *(pas de re-rendu i18n)*
- **H1** : absent
- **Interactive** : 5 / 0 / 0 / 4
- **Testids spécifiques** : aucun.
- **Critical missing testids** : `k-fullscreen` → `kiosk-fullscreen`.
- **API au boot** : `GET /api/species-names`, `GET /api/update-status`, `GET /api/weather?days=1`, `POST /api/query`.
- **Notes** : Idem liveboard — pas de shell, conçu pour affichage TV.

### 6.6 `spectrogram.html` — Spectrogramme live

- **Title** : `Heinsch, Belgium — Spectrogramme live`
- **H1** : `Live`
- **Interactive** : 107 / 53 / 1 / 10
- **Testids spécifiques** : aucun — uniquement le shell.
- **Critical missing testids** :
  - `<select>` source (Live Micro / Réécoute détections) → `spec-source`
  - Bouton « ▶ Démarrer » → `spec-start` *(⚠ déclenche un flux audio — pas à cliquer en READ-ONLY)*
  - Pills gain (Off/+6/+12/+18/+24) → `spec-gain-{value}`
  - Pills HP / LP (mêmes valeurs que today) → `spec-{hp|lp}-{value}`
- **API au boot** : shell standard + `POST /api/query`. Le flux audio binaire n'est ouvert qu'après « Démarrer ».
- **Notes** : Polling 1 s horloge.

### 6.7 `calendar.html` — Calendrier

- **Title** : `Heinsch, Belgium — Calendrier`
- **H1** : `Calendrier`
- **Interactive** : 95 / 53 / 3 / 11
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Navigation mois (boutons `‹` / `›`) → `cal-prev-month`, `cal-next-month`
  - Sélecteur année / vue → `cal-year-picker`
  - Chips espèce sur cellule (`cal-signal-chip`) → `cal-signal-chip` `:data-species` `:data-date`
- **API au boot** : `GET /api/calendar/month?from=2026-05-01&to=2026-05-31&conf=0.7` (data driver), shell standard, `POST /api/query`.
- **Notes** : Pas de polling actif.

### 6.8 `timeline.html` — Chronologie

- **Title** : `Heinsch, Belgium — Chronologie`
- **H1** : `Chronologie`
- **Interactive** : 101 / 53 / 0 / 10
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Navigation jour (`‹` / `›`) → `tl-prev-day`, `tl-next-day`
  - `<input type="date">` → `tl-date-input`
  - Slider confiance → `tl-confidence`
  - Toggle mode (« Moments marquants » / « Toutes les détections ») → `tl-mode` `:data-mode`
  - Filtres (`⭐ Rare 5`, `tl-filter-btn`) → `tl-filter` `:data-filter`
- **API au boot** : `GET /api/timeline?date=2026-05-15&minConf=0.475&maxEvents=8`, shell standard, `POST /api/query`.
- **Notes** : URL synchronisée avec `?date=YYYY-MM-DD`.

### 6.9 `detections.html` — Détections

- **Title** : `Heinsch, Belgium — Détections`
- **H1** : `Détections`
- **Interactive** : 367 / 78 / 50 / 110
- **Testids spécifiques** : `detections-export-csv`, `detections-export-ebird`, `detections-list`, `detections-pagination`, `detections-result-count`, `detections-row`, `filter-family`, `filter-favorites-only`, `filter-guild`, `filter-new-species-only`, `filter-order`, `filter-reset`, `filter-species`, `filter-species-placeholder`, `filter-species-trigger`.
- **Critical missing testids** :
  - `<button ▶>` × N (play par ligne) → `detections-row-play` (avec `:data-id`)
  - Bouton spectro / actions par ligne (s'il existe) → `detections-row-spectro`
  - Checkbox de sélection par ligne, si applicable → `detections-row-select`
- **API au boot** : `GET /api/favorites`, `GET /api/taxonomy?lang=fr`, shell standard, `POST /api/query`.
- **Notes** : 50 boutons ont `aria-label` (donc ciblables) — c'est la page la mieux a11y-fournie.

### 6.10 `review.html` — À valider

- **Title** : `Heinsch, Belgium — À valider`
- **H1** : `À valider`
- **Interactive** : 494 / 71 / 43 / 10
- **Testids spécifiques** : `review-action-confirm`, `review-action-doubtful`, `review-action-reject`, `review-confidence-filter`, `review-list`, `review-reject-by-reason`, `review-row`, `review-row-play`, `review-row-spectro`, `review-select-all`, `review-select-row`, `review-show-more`. Conditionnels (rendus quand un filtre est actif ou la bulk bar visible) : `filter-period-{1d|7d|30d|90d|all}`, `review-bulk-bar`, `review-bulk-{confirm|doubtful|reject}`, `review-species-filter-banner`, `review-clear-species-filter`, `review-go-purge`.
- **Critical missing testids** : couverture déjà très bonne. À surveiller : que `review-bulk-bar` apparaisse bien quand ≥ 1 sélection — sinon poser `review-bulk-bar-placeholder`.
- **API au boot** : `GET /api/weather/range?from=&to=`, shell standard, `POST /api/query`.
- **Notes** : Pas de polling automatique. Note du commit `b73b7da` (mai 2026) : la modal de suppression locale n'existe plus — la suppression se fait via `purge.html`.

### 6.11 `species.html` — Détail espèce

- **Title** : `BIRDASH — Fauvette à tête noire` ⚠ incohérent (cf. § 7)
- **H1** : `Espèces`
- **Interactive** : 161 / 60 / 6 / 20
- **Testids spécifiques** : `species-detail-header`, `species-detail-title`, `species-detection-row`, `species-favorite`, `species-next`, `species-picker`, `species-prev`.
- **Critical missing testids** :
  - Arrows `‹` / `›` (`sp-arrow`) — déjà couvert par `species-prev`/`-next` mais pose à vérifier sur deux occurrences.
  - Boutons « Définir par défaut » / « Bannir » → `species-set-default`, `species-ban`
  - Carousel vidéos (`▶ 4` `sp-video-thumb`) → `species-video-thumb` `:data-idx`
  - Bouton « 🔗 Partager » → `species-share`
  - Textarea note perso → `species-personal-note`
- **API au boot** : `GET /api/notes?com_name=…`, `GET /api/species-info?sci=&lang=`, `GET /api/species-videos?sci=`, `GET /api/weather/species-profile?species=`, shell standard, `POST /api/query`.

### 6.12 `rarities.html` — Raretés

- **Title** : `Heinsch, Belgium — Raretés`
- **H1** : `Raretés`
- **Interactive** : 217 / 63 / 34 / 25
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - `<select>` seuil rareté (`fp-select`) → `rarities-threshold`
  - Boutons « Actualiser » / « Réinitialiser » → `rarities-refresh`, `rarities-reset`
  - KPI links (« 141 Espèces », « 35 Espèces rares ≤10 », « 12 Vues une seule fois », « 13 Vue la première fois 2026 ») → `rarities-kpi-{total|rare|singletons|firsts}` (déjà `<a>` mais sans testid)
- **API au boot** : `GET /api/weather/range`, shell standard, `POST /api/query`.

### 6.13 `recordings.html` — Meilleurs enregistrements

- **Title** : `Heinsch, Belgium — Meilleurs enregistrements`
- **H1** : `Enregistrements`
- **Interactive** : 255 / 63 / 8 / 118
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Tabs « Bibliothèque audio » / « Meilleures » (`gallery-tab`) → `recordings-tab` `:data-tab`
  - Tri `<select>` (Confiance / Date / Espèce) → `recordings-sort`
  - Search input (`bf-sp-search`) → `recordings-search`
  - Toggle « Tout sélect. » (`bf-sp-toggle-btn`) → `recordings-select-all`
  - Boutons play/spectro par ligne → `recordings-row-{play|spectro}` `:data-id`
- **API au boot** : `GET /api/weather/range`, shell standard, `POST /api/query`.

### 6.14 `favorites.html` — Favoris

- **Title** : `Heinsch, Belgium — Favoris`
- **H1** : `Favoris`
- **Interactive** : 116 / 55 / 8 / 10
- **Testids spécifiques** : `favorites-remove`, `species-card` (4 buckets × N, `data-bucket="{active|recent|dormant|never}"`).
- **Critical missing testids** :
  - Search/filter input → `favorites-filter-input`
  - Bandeau de désync + bouton de re-sync → `favorites-resync-banner`, `favorites-resync`
- **API au boot** : `GET /api/favorites`, `GET /api/favorites/stats`, `GET /api/weather/range`, shell standard, `POST /api/query`.

### 6.15 `quality.html` — Qualité de détection

- **Title** : `Heinsch, Belgium — Qualité de détection`
- **H1** : `Qualité`
- **Interactive** : 101 / 53 / 0 / 16
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Pills période (7j / 30j / 90j) → `quality-period` `:data-period`
  - Tabs (« À surveiller 10 » / « Bon accord 0 ») → `quality-tab` `:data-tab`
  - CTAs « Voir les espèces à surveiller » / « Voir la timeline » (`qa-pilot-cta`) → `quality-cta` `:data-target`
- **API au boot** : `GET /api/quality?days=30`, shell standard, `POST /api/query`.

### 6.16 `weather.html` — Météo & Oiseaux

- **Title** : `Heinsch, Belgium — Météo & Oiseaux`
- **H1** : `Météo & Oiseaux`
- **Interactive** : 118 / 53 / 0 / 10
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Presets « Grand froid », « Pluie soutenue », « Aube dégagée », « Pluie/Orage », « Réinitialiser » (`ws-preset`) → `weather-preset` `:data-preset`
  - Inputs température / vent / précip (`<input>` sans label visible) → `weather-{temp|wind|precip}-min/max`
  - Toggle on/off → `weather-toggle`
- **API au boot** : `GET /api/weather?days=30`, `GET /api/weather/match-summary`, `GET /api/weather/species-by-condition` (×4 ; codes climatiques, précip, temp, vent), `GET /api/weather/species-heatmap?top=30`, shell standard, `POST /api/query`.

### 6.17 `stats.html` — Statistiques

- **Title** : `Heinsch, Belgium — Statistiques`
- **H1** : `Statistiques`
- **Interactive** : 164 / 64 / 27 / 11
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Tabs (`gallery-tab` : « Statistiques » / « Modèles ») → `stats-tab` `:data-tab` (déjà adressable via `?tab=models`)
  - Bouton « Défaut » / « Actualiser » → `stats-reset`, `stats-refresh`
  - Bouton export « ⬇ CSV » (`dl-btn`) → `stats-export-csv`
  - Players audio inline `🔊 qplay-btn` → `stats-qplay` `:data-id`
- **API au boot** : shell standard, `POST /api/query` (multiplexé pour tous les agrégats).

### 6.18 `stats.html?tab=models` — Modèles

- **Title** : `Heinsch, Belgium — Statistiques`
- **H1** : `Modèles`
- **Interactive** : 225 / 64 / 27 / 72 (les 72 href en plus sont des liens espèce dans la table de classement)
- **Testids spécifiques** : aucun.
- **Critical missing testids** : idem `stats.html`, plus colonnes triables → `stats-models-col` `:data-col`.
- **Notes** : C'est la même page Vue avec un onglet `models` actif — pas un autre HTML.

### 6.19 `analyses.html` — Analyses espèces

- **Title** : `Heinsch, Belgium — Analyses espèces`
- **H1** : `Analyses`
- **Interactive** : 188 / 64 / 7 / 10
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - `<select>` guilde (Toutes / 🦅 Rapaces / 🦆 …) → `analyses-guild`
  - Tags retirables `✕` (`sp-tag-x`) → `analyses-tag-remove` `:data-species`
  - Inputs radio granularité (`raw` / `15min` / `hourly`) → `analyses-grain` `:data-grain`
- **API au boot** : shell standard, `POST /api/query`.

### 6.20 `comparison.html` — Saisons

- **Title** : `Heinsch, Belgium — Bird Flow` ⚠ titre i18n erroné (fall-back sur la clé `dashboard`)
- **H1** : `Saisons`
- **Interactive** : 149 / 53 / 51 / 15
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Pills saisons (« Printemps / Été / Automne / Hiver ») → `comparison-season` `:data-season`
  - Boutons navigation gauche/droite (`btn btn-secondary`) → `comparison-prev`, `comparison-next`
- **API au boot** : `GET /api/seasons/report?season=spring&year=2026`, shell standard, `POST /api/query`.
- **Notes** : Trois des quatre pills sont disabled (`ssn-pill disabled`) en fonction de la date.

### 6.21 `compare.html` — Comparer

- **Title** : `Heinsch, Belgium — Comparer`
- **H1** : `Comparer`
- **Interactive** : 101 / 53 / 0 / 10
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - 2× combobox espèce (`cmp2-cb-input`) → `compare-species` `:data-side="a|b"`
  - Bouton swap → `compare-swap`
  - Pills période « 30 j / 90 j / Saison / Année » → `compare-period` `:data-period`
- **API au boot** : shell standard, `POST /api/query`.

### 6.22 `phenology.html` — Calendrier phénologique

- **Title** : `Heinsch, Belgium — Phénologie`
- **H1** : `Calendrier phénologique observé`
- **Interactive** : 96 / 53 / 0 / 10
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Trigger picker espèce (`ph-species-trigger`) → `phenology-species-trigger`
  - Boutons suggestions (`ph-suggestion-btn`) → `phenology-suggestion` `:data-species`
- **API au boot** : shell standard, `POST /api/query` (lazy : pas de fetch dédié avant choix d'espèce).

### 6.23 `settings.html` — Configuration

- **Title** : `Heinsch, Belgium — Configuration`
- **H1** : `Configuration`
- **Interactive** : 153 / 96 / 0 / 10 (au boot, onglet `detection` actif)
- **Testids spécifiques** : `settings-tabs`, `settings-save-bar`, `settings-save`, `settings-reset-defaults`, `settings-tab-{detection|audio|notif|station|services|species|backup|database|terminal|external-display|monitoring}` (11), plus 28 `settings-detection-*` au boot — voir § 4 pour la liste complète. Les autres onglets sont lazy : leurs ~130 testids n'apparaissent qu'à l'ouverture.
- **Critical missing testids** :
  - Boutons info (`info-btn` × N « i ») → `settings-info` `:data-key`
  - Indicateur « save dirty » → `settings-save-msg` (existant côté JS mais pas relevé ici car non visible au boot)
- **API au boot** : énorme — `GET /api/{alert-thresholds, apprise, audio/{adaptive-gain/{config,state}, boost, config, devices, noise-profile/status, profiles}, backup-{config,history,progress,schedule}, detection-profiles, languages, models, range-filter/preview?threshold=, services, settings, settings/auto-purge, species-lists, telemetry/{anonymous-pings,status}}`, plus shell standard.

### 6.24 `system.html` — Supervision

- **Title** : `Heinsch, Belgium — Système`
- **H1** : `Supervision`
- **Interactive** : 93 / 53 / 0 / 10
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Tabs (Santé / Modèle / Données / Externe / Terminal / Configuration) (`sys-tab-btn`) → `system-tab` `:data-tab`
  - Actions service (start/stop/restart par ligne) → `system-service-action` `:data-service` `:data-action`
- **API au boot** : `GET /api/{audio-device, backup-status, hardware, health, network-info, services, system-health}` + shell.

### 6.25 `log.html` — Log live

- **Title** : `Heinsch, Belgium — Log live`
- **H1** : `Log live`
- **Interactive** : 96 / 53 / 0 / 10
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Boutons « ⏸ Pause » / « Effacer » (`rv-btn-outline`) → `log-pause`, `log-clear`
  - Filtres (Tous / 🟢 Détections / 🔵 BirdWeather / 🔴 Erreurs / ⚙️ API) (`log-filter`) → `log-filter` `:data-channel`
- **API au boot** : shell standard. Le flux SSE `/api/logs` peut être amorcé après une interaction (Pause/Resume) ou immédiatement selon l'auto-start.

### 6.26 `purge.html` — Purge / Corbeille

- **Title** : `Heinsch, Belgium — Purge`
- **H1** : `Purge`
- **Interactive** : 252 / 54 / 0 / 10
- **Testids spécifiques** : `purge-row-spectro`.
- **Critical missing testids** (P0 — interface très destructrice, à instrumenter en priorité) :
  - Tabs « Actives 353 665 » / « Corbeille 102 445 » (`pg-tab`) → `purge-tab` `:data-view="active|trash"`
  - Inputs filtres (espèce, date début/fin, confiance min/max, etc.) (`pg-filter-input`) → `purge-filter-{species|date-from|date-to|conf-min|conf-max|…}`
  - Sélecteur pagination (10/50/100 / page) → `purge-page-size`
  - Bouton « Réinitialiser » (filtres) → `purge-reset-filters`
  - Checkbox sélection globale → `purge-select-all`
  - Bouton bulk « Mettre à la corbeille (N) » → `purge-bulk-trash`
  - Checkbox par ligne → `purge-row-select` `:data-id`
  - Bouton action par ligne (`pg-action-btn danger`) → `purge-row-trash` `:data-id` (et `purge-row-restore` côté Corbeille, `purge-row-delete-forever`)
- **API au boot** : `GET /api/purge/list?view=active&limit=50&offset=0`, `GET /api/purge/stats`, `GET /api/logs` (SSE pour invalidations), shell standard, `POST /api/query`.

### 6.27 `biodiversity.html` — Biodiversité (hors-nav)

- **Title** : `Heinsch, Belgium — Biodiversité`
- **H1** : `Biodiversité`
- **Interactive** : 110 / 64 / 5 / 13
- **Testids spécifiques** : aucun.
- **Critical missing testids** :
  - Tab « Biodiversité » (`gallery-tab`) → `biodiversity-tab`
  - Boutons « Défaut » / « Actualiser » → `biodiversity-reset`, `biodiversity-refresh`
  - Bouton export « ⬇ CSV » → `biodiversity-export-csv`
- **API au boot** : shell standard, `POST /api/query`.
- **Notes** : page « parente » de stats — partage le composant gallery-tab.

### 6.28 Pages-redirection (non-instrumentables sans bypass)

| Source | Cible observée | Recommandation |
|---|---|---|
| `index.html` | `today.html` | Tester avec `goto('index.html')` puis assert sur `today` |
| `login.html` | `overview.html` *(si déjà auth)* | Tester en context non-auth pour voir le vrai formulaire — `header-login`, inputs, bouton submit attendus (P1) |
| `recent.html` | `calendar.html` | Confirmer redirect côté Caddy |
| `gallery.html` | `recordings.html` | Idem |
| `models.html` | `stats.html?tab=models` | Idem |

---

## 7. Backlog d'instrumentation P0/P1/P2

Reconstitué à partir du crawl 2026-05-15. Priorisé par impact test.

### P0 — actions destructives ou load-bearing sans hook stable

- [ ] **purge.html** : tabs `purge-tab`, filtres `purge-filter-*`,
  pagination `purge-page-size`, select-all `purge-select-all`,
  bulk `purge-bulk-trash`, par ligne `purge-row-{select|trash|restore|delete-forever}`.
- [ ] **review.html** : valider que `review-bulk-bar` apparaît dans le DOM
  (même `display:none`) pour permettre l'assert sans condition.
- [ ] **settings.html** : poser `settings-save-msg` (existant côté JS) sur l'élément visible après save ; sinon le test ne peut pas attendre la confirmation.

### P1 — utile pour des tests E2E sérieux

- [ ] **today.html** : `today-confidence-slider`, `today-sort`, `today-filter`, KPI buttons `kpi-{all|new|rare|robust|review}`, audio controls `audio-{play|gain|hp|lp|clean}` et `freq-toggle`, `spectro-expand`.
- [ ] **dashboard.html** : KPI cards `dashboard-kpi-{detections|species|review|health}`.
- [ ] **spectrogram.html** : `spec-source`, `spec-start` (avec note d'avertissement READ-ONLY), `spec-{gain|hp|lp}-*`, `spec-fmax`.
- [ ] **calendar.html** : `cal-{prev|next}-month`, `cal-year-picker`, `cal-signal-chip` + `:data-species` `:data-date`.
- [ ] **timeline.html** : `tl-{prev|next}-day`, `tl-date-input`, `tl-confidence`, `tl-mode`, `tl-filter` `:data-filter`.
- [ ] **detections.html** : `detections-row-play` (avec `:data-id`), `detections-row-spectro`, `detections-row-select`.
- [ ] **rarities.html** : `rarities-threshold`, `rarities-refresh`, `rarities-reset`, `rarities-kpi-*`.
- [ ] **recordings.html** : `recordings-tab`, `recordings-sort`, `recordings-search`, `recordings-select-all`, `recordings-row-{play|spectro}`.
- [ ] **favorites.html** : `favorites-filter-input`, `favorites-resync-banner`, `favorites-resync`.
- [ ] **quality.html** : `quality-period`, `quality-tab`, `quality-cta`.
- [ ] **weather.html** : `weather-preset` (5 valeurs), `weather-{temp|wind|precip}-{min|max}`, `weather-toggle`.
- [ ] **stats.html** : `stats-tab`, `stats-reset`, `stats-refresh`, `stats-export-csv`, `stats-qplay`, `stats-models-col` `:data-col`.
- [ ] **analyses.html** : `analyses-guild`, `analyses-tag-remove` `:data-species`, `analyses-grain` `:data-grain`.
- [ ] **comparison.html** : `comparison-season`, `comparison-prev`, `comparison-next`.
- [ ] **compare.html** : `compare-species` `:data-side`, `compare-swap`, `compare-period`.
- [ ] **phenology.html** : `phenology-species-trigger`, `phenology-suggestion` `:data-species`.
- [ ] **system.html** : `system-tab`, `system-service-action` `:data-service` `:data-action`.
- [ ] **log.html** : `log-pause`, `log-clear`, `log-filter` `:data-channel`.
- [ ] **biodiversity.html** : `biodiversity-tab`, `biodiversity-reset`, `biodiversity-refresh`, `biodiversity-export-csv`.
- [ ] **liveboard.html / dashboard-kiosk.html** : `liveboard-fullscreen`, `kiosk-fullscreen` ; et **réparer l'i18n du titre** (reste en `BirdStation —`).
- [ ] **comparison.html** : réparer l'i18n du titre (`Bird Flow` au lieu de `Saisons`).

### P2 — finition / cosmétique

- [ ] **species.html** : `species-set-default`, `species-ban`, `species-video-thumb` `:data-idx`, `species-share`, `species-personal-note`. Plus carrousel photos (`species-thumb-{i}`), profil météo (`species-weather-bar-row`).
- [ ] **overview.html** : `overview-kpi-rares`, `overview-featured-tab` `:data-tab`, `overview-featured-play`.
- [ ] **today.html** : pastilles de détection horaire `detection-chip` + `:data-time`, `:data-confidence`.
- [ ] Skip-link partagé : `header-skip-link` (présent partout, sans hook).
- [ ] Mobile drawer overlay : wrapper `mobile-drawer` (les items ont déjà `nav-drawer-*`).
- [ ] **species.html** : régression i18n du `<title>` qui devient
  `BIRDASH — <espèce>` au lieu de `<siteName> — <espèce>` — incohérent
  avec les 25 autres pages.

### Hygiène

- [ ] Quand une page est instrumentée, mettre à jour les sections § 4 et § 6 ci-dessus.
- [ ] Si un `v-model` est ajouté dans `settings/*.html`, relancer
  `python3 /tmp/instrument-settings.py` (ou le réintégrer dans `scripts/`)
  pour auto-injecter le testid manquant.
- [ ] Surveiller la dérive du `<title>` non-i18n sur `liveboard.html`,
  `dashboard-kiosk.html`, `comparison.html`, `species.html`.

---

## 8. Exemple Playwright

Avec les testids posés, un test peut maintenant ressembler à :

```js
test('valide une détection depuis review', async ({ page }) => {
  await page.goto('https://192.168.2.217/birds/review.html');
  await page.getByTestId('filter-period-7d').click();

  const row = page.locator('[data-testid="review-row"]').first();
  await expect(row).toBeVisible();
  await row.getByTestId('review-action-confirm').click();

  await expect(row).toHaveAttribute('data-validation', 'confirmed');
});

test('change la sensibilité BirdNET', async ({ page }) => {
  await page.goto('https://192.168.2.217/birds/settings.html');
  await page.getByTestId('settings-tab-detection').click();
  await page.getByTestId('settings-detection-sensitivity').fill('1.25');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('settings-save-msg')).toContainText(/ok|saved/i);
});

test('filtre detections par espèce via deep-link', async ({ page }) => {
  await page.goto('https://192.168.2.217/birds/detections.html?species=Turdus%20merula');
  await page.waitForFunction(() => document.title.includes('—') && !document.title.startsWith('BirdStation —'));
  await expect(page.getByTestId('detections-result-count')).toContainText(/\d+/);
  await page.getByTestId('filter-reset').click();
});
```
