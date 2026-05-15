# Birdash — Inventaire UI pour tests Playwright

Source : repo `birdash` à HEAD (v1.55.17, commit `59697d7`).
Dernière mise à jour : 2026-05-15.

> **TL;DR sélecteurs** : 269 `data-testid` posés (commits `591e684` + `59697d7`).
> Tous les éléments interactifs *critiques* sont équipés ; les compléments P1/P2
> restants sont listés en § 7.

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
- **i18n** : 4 langues chargées au boot (`/birds/i18n/{fr,en,de,nl}.json`).
  Le titre de page passe de `BirdStation — <i18n_key>` à
  `<siteName> — <traduction>` ≈ 1–2 s après le `load` event.
- **Service Worker** : `sw.js` actif en production. En dev local sur cert
  auto-signé l'enregistrement échoue ; à ignorer dans les tests
  (`registration failed: SSL certificate error`).
- **Auth interceptor** : un wrapper `fetch` redirige vers `login.html`
  sur 401 (sauf endpoints `/api/auth/*`).
- **Cert auto-signé** : lancer Playwright avec `ignoreHTTPSErrors: true`.

---

## 2. Routes canoniques

Source : `public/js/bird-config.js` lignes 50–88. **26 pages** distinctes.

| Section (i18n) | id config | URL | Notes |
|---|---|---|---|
| Accueil | `overview` | `overview.html` | dashboard d'entrée |
| Accueil | `today` | `today.html` | redirection depuis `index.html` |
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
| Indicateurs | `comparison` | `comparison.html` | (interne) |
| Indicateurs | `compare` | `compare.html` | comparaison période |
| Indicateurs | `phenology` | `phenology.html` | calendrier phénologique |
| Station | `settings` | `settings.html` | config (10 onglets lazy) |
| Station | `system` | `system.html` | supervision |
| Station | `log` | `log.html` | log live (SSE) |
| Station | `purge` | `purge.html` | corbeille / purge des détections |

**Hors-nav** mais accessibles : `login.html`, `biodiversity.html`,
`gallery.html`, `models.html` (redirige), `recent.html`, `spectro-test.html`,
`test.html`, `video-poc.html`, `index.html`.

**Deep-links via querystring** :

- `species.html?species=<NomVernaculaire>`
- `phenology.html?species=<NomVernaculaire>`
- `review.html?species=<NomVernaculaire>&date=YYYY-MM-DD`
- `detections.html?species=<NomVernaculaire>`
- `stats.html?tab={models|...}`
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
| `filter-period-*` | Composant `<filter-period>` (boutons 1d/7d/30d/…) |
| `filter-confidence-*` | Composant `<filter-confidence>` (slider/edit) |
| `update-banner-*`, `update-modal-*` | Bannière + modal d'auto-update |
| `bug-report-*`, `power-*` | Modals globaux |

Pour les éléments répétés en `v-for`, ajouter aussi un **attribut data
discriminant** : `:data-species`, `:data-sci`, `:data-date`, `:data-time`,
`:data-reason`, `:data-theme`, `:data-lang`, `:data-model`, `data-bucket`.
Cela permet de cibler `[data-testid="species-card"][data-sci="Turdus merula"]`.

**Anti-pattern** : ne pas réintroduire `data-test=` (l'ancienne convention
de `detection.html`, migrée vers `data-testid` au commit `59697d7`).

---

## 4. Couverture actuelle des `data-testid`

Posés par les commits `591e684` (1ère passe) et `59697d7` (2ème passe).

| Fichier | Hooks | Couvre |
|---|---|---|
| `public/js/bird-vue-core.js` | 64 | Nav desktop + drawer + mobile bottom nav, header utils, update modal/banner, bug-report modal, power modal (3 étapes), FilterPeriod, FilterConfidence |
| `public/settings/notif.html` | 41 | Tous les `v-model` notif (Apprise, seuils, alertes météo) |
| `public/settings/detection.html` | 30 | Modèles, profils (`data-test` → `data-testid`), BirdNET/Perch params, YAMNet, throttle, recording, sliders SF_THRESH |
| `public/settings/audio.html` | 28 | Sélection device, profils, HP/LP, denoise, gain |
| `public/settings/backup.html` | 27 | Config backup (chemins, schedules, restore) |
| `public/settings/station.html` | 21 | Identité site, coords, élévation, **auth (user/password)** |
| `public/review.html` | 19 | select-all, confidence filter, bulk actions, reject-by-reason, per-row select/play/spectro/actions, species filter banner, show-more, go-purge |
| `public/favorites.html` | 8 | 4 buckets × (card + remove button) |
| `public/species.html` (détail) | 7 | header, picker prev/next/select, favorite toggle, feed rows |
| `public/settings.html` (shell) | 6 | Tabs strip + save bar |
| `public/settings/services.html` | 6 | Service toggles |
| `public/settings/external-display.html` | 5 | TFT display config |
| `public/dashboard.html` | 2 | `species-card` × 2 (recent species + det-mini strip) |
| `public/settings/species.html` | 2 | Include/exclude list textareas |
| `public/today.html` | 2 | `species-card` + favorite per card |
| `public/settings/database.html` | 1 | Vacuum trigger |
| **TOTAL** | **269** | |

**Total `v-model` instrumentés dans settings/** : ~158 (audio, backup,
database, detection, external-display, notif, services, species, station).
`terminal.html` n'a aucun `v-model` (iframe wrapper).

---

## 5. Comportements asynchrones

### 5.1 Pas de WebSocket. **EventSource (SSE) sur 3 pages.**

> Correction par rapport à la passe précédente : Birdash *utilise bien* SSE,
> pas seulement du polling.

| Page | URL SSE | Usage |
|---|---|---|
| `dashboard.html` | `GET /api/audio/monitor` | niveau du micro (barres animées) |
| `dashboard.html` | `GET /api/logs` | flux d'événements clés |
| `log.html` | `GET /api/logs` | log live complet |
| `settings.html` (onglet audio) | `GET /api/audio/monitor` | preview des niveaux pendant la config |

### 5.2 Polling — globaux (bird-vue-core.js)

| Cadence | Fonction | Endpoint / effet |
|---|---|---|
| 1 000 ms | tick d'un countdown UI | (UI only) |
| 2 000 ms | `_updatePollTimer` | `GET /api/update-status` |
| 5 min | `refreshAllAlerts` | recharge la bell + bandeau update |
| 10 min | `loadBirdsAlerts` | rare/nouvelles espèces pour la bell |

### 5.3 Polling — par page

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
| `system.html` | variable | services + santé |
| `settings.html` (audio tab) | 5 s | niveau sonore |
| `settings.html` (external-display tab) | 5 s | status TFT |
| `settings.html` (backup tab) | 2 s | progression backup |
| `timeline.html` | variable | tick UI |

### 5.4 Endpoints `/api/*` rencontrés au boot

```
/api/analysis-status        /api/auth/status
/api/audio/monitor (SSE)    /api/birdweather/status
/api/bug-report/status      /api/detections/bbox?file=…
/api/favorites              /api/flagged-detections?dateFrom=…&dateTo=…
/api/logs (SSE)             /api/photo?sci=<scientific>
/api/query (POST, multiplexé)
/api/range-filter/preview?threshold=…
/api/rare-today?date=YYYY-MM-DD
/api/settings               /api/species-names?lang=<fr|en|de|nl>
/api/update-status          /api/weather/range?from=…&to=…
/api/whats-new
```

### 5.5 Implications Playwright

- **SSE** : `page.route('**/api/audio/monitor', …)` peut casser le mic preview
  → désactiver ou mock-er. Idem pour `/api/logs`.
- **Polling court** : un test qui modifie une détection puis vérifie l'UI
  doit attendre ≤ 60 s ou intercepter `/api/query` pour stub-er la réponse.
- **i18n** : préférer `page.waitForFunction(() => document.title.includes('—'))`
  à `expect(page).toHaveTitle(…)`.
- **Cert** : `ignoreHTTPSErrors: true` côté config + `--ignore-https-errors`
  côté MCP.
- **SW** : ignorer les warnings `SSL certificate error … sw.js` en dev.

---

## 6. Inventaire détaillé — pages instrumentées

### 6.1 `today.html`

- `species-card` + `:data-species` sur chaque ligne d'espèce. Tags
  `species-tag-{new|rare|review}` non explicités (couverts par les
  classes Vue + i18n). Bouton ★ favori : `today-species-favorite`.
- KPI buttons (Toutes / Rares / Signal solide / À revoir / Nouvelles) :
  **non instrumentés** (P1).
- Tri `<select>`, filtre `<input>` : **non instrumentés** (P1).
- Lecteur audio (Play, ⟵ ⟶, Gain/HP/LP, "Nettoyer le son", "Agrandir",
  "Masquer bande", chips de détection horaire) : **non instrumentés** (P1).

### 6.2 `dashboard.html` (Bird Flow)

- `species-card` sur les liens espèce (recent + det-mini). KPI cards
  (Détections / Espèces / À valider / Santé) : **non instrumentés** (P1) —
  ce sont déjà des `<a href>` stables.
- Mic monitor (SSE), pipeline stages, dual-AI cores, fusion bar : pas
  d'interaction utilisateur → pas de testid nécessaire.

### 6.3 `review.html`

- Toolbar : `filter-period-{1d|7d|30d|90d|all}` (via composant partagé),
  `review-select-all`, `review-confidence-filter`.
- Bulk : `review-bulk-bar` (wrapper) + `review-bulk-{confirm|doubtful|reject}`.
- Reject-by-rule : `review-reject-by-reason` + `:data-reason`.
- Banner espèce : `review-species-filter-banner` + `review-clear-species-filter`.
- Liste : `review-list` ; chaque carte `review-row` +
  `:data-sci / :data-date / :data-time / :data-validation` ;
  `review-row-play`, `review-row-spectro`,
  `review-action-{confirm|doubtful|reject}` ; `review-select-row` sur checkbox.
- Pagination : `review-show-more`. Lien purge : `review-go-purge`.

> **Note** : la modal de suppression locale n'existe plus depuis le commit
> `b73b7da` (mai 2026) ; la suppression est maintenant exclusivement gérée
> dans `purge.html` (overlay SSE). Les sélecteurs `review-delete-*`
> initialement planifiés ne sont donc pas nécessaires.

### 6.4 `species.html` (détail)

- En-tête : `species-detail-header` + `:data-species / :data-sci`,
  `species-detail-title`, `species-picker` (select), `species-prev`,
  `species-next`, `species-favorite`.
- Feed de détections : `species-detection-row` + `:data-date / :data-time`.
- Carrousel photos, profil météo, vidéos : pas encore instrumentés (P2).

### 6.5 `favorites.html`

- 4 buckets × `species-card` + `data-bucket="{active|recent|dormant|never}"`.
- Bouton ★ remove : `favorites-remove` (les 4 occurrences).
- Search input (filtre), banner de désync, bouton de re-sync : pas
  encore instrumentés (P1).

### 6.6 `settings.html` + onglets

- Shell : `settings-tabs`, `settings-tab-{detection|audio|notif|station|
  services|species|backup|database|terminal|external-display|monitoring}`,
  `settings-save-bar`, `settings-save`, `settings-reset-defaults`,
  `settings-save-msg`.
- Onglets : chaque `<input>` / `<select>` / `<textarea>` lié à un `v-model`
  a un `data-testid="settings-<tab>-<config-path-kebab>"`.
  Ex : `settings-detection-sensitivity`, `settings-audio-audioconf-input-channels`,
  `settings-notif-notify-rare-species`, `settings-station-latitude`.
  Voir la table en § 4 pour le total par onglet.

### 6.7 Header (commun à toutes les pages)

`header-{model-link, search-toggle, search-input, search-clear,
search-results, search-result (per-item, :data-sci),
login, logout, birdweather, bug-report, power, notifications,
notifications-panel, theme-toggle, theme-menu,
theme-option (per-item, :data-theme),
lang-toggle, lang-menu, lang-option (per-item, :data-lang)}`.

### 6.8 Modals globaux

- Update : `update-banner` + `update-banner-view`, `update-modal` +
  `update-modal-{close, install, skip, defer, rollback, rollback-failed,
  reload, force, dismiss}`.
- Bug report : `bug-report-modal`, `bug-report-{close, title,
  description, attach-logs, cancel, submit}`.
- Power : `power-modal`, `power-{close, restart-service, reboot, shutdown,
  confirm-cancel, slide-track, slide-cancel}`.

### 6.9 Mobile

- Bottom nav (`mobile-nav` wrapper) :
  `mobile-nav-{overview, today, species, stats, more}`.
- Drawer : `nav-drawer-section-{home|realtime|history|species|indicators|system}`,
  `nav-drawer-{overview|today|dashboard|liveboard|…}`. Le wrapper drawer
  lui-même n'a pas de testid dédié (peut être ciblé via `.mob-drawer-overlay`
  ou ajouté en P2).

---

## 7. TODO restant (P1 / P2)

### Priorité P1 — utile pour des tests sérieux mais non bloquant

- [ ] **today.html** : KPI buttons (`kpi-{rares|robust|new|review|all}`),
  `<select>` tri (`today-sort`), `<input>` filtre (`today-filter`),
  bouton ★ du panneau détail (côté droit).
- [ ] **today.html** : lecteur audio (`audio-play`, `audio-prev`, `audio-next`,
  `audio-progress`) et contrôles spectro (`spec-gain-*`, `spec-hp-*`,
  `spec-lp-*`, `spec-clean`, `spec-expand`, `spec-toggle-band`).
- [ ] **spectrogram.html** : `spec-source` (Live/Replay), `spec-fmax`,
  `spec-start`, `spec-volume` (déjà aria-label), gain/HP/LP idem today.
- [ ] **detections.html** : `<select>` guilde/ordre/famille (déjà aria-label),
  range buttons via FilterPeriod, slider confiance via FilterConfidence,
  boutons d'export `detections-export-{csv|ebird}`, `detections-reset`,
  checkboxes par ligne, play par ligne.
- [ ] **dashboard.html** : 4 KPI cards (`dashboard-kpi-{detections|species|review|health}`).
- [ ] **stats.html** : onglets internes (`stats-tab-{total|models|seasons|…}`),
  sélecteur de période/granularité.
- [ ] **purge.html** : sélection, actions trash/restore/empty, progress overlay.
- [ ] **rarities.html**, **recordings.html**, **quality.html**,
  **weather.html**, **analyses.html**, **compare.html**, **phenology.html**,
  **calendar.html**, **timeline.html** : aucun sélecteur posé pour le moment.
- [ ] **system.html** : actions (probables redémarrages partiels), boutons
  d'action sur les services.
- [ ] **log.html** : contrôles de filtrage du flux SSE (level, search,
  pause/resume).

### Priorité P2

- [ ] **species.html** : carrousel photos (`sp-thumb-{i}`), profil météo
  (`wp-bar-row`, `wp-temp-col`), vidéos.
- [ ] **today.html** : pastilles de détection horaire (`detection-chip` +
  `:data-time`, `:data-confidence`).
- [ ] Icon-only buttons restants (refresh photo, masquer bande, etc.) —
  beaucoup ont déjà un `aria-label`.
- [ ] Wrapper `mobile-drawer` (testid sur l'overlay, pas seulement les liens).

### Hygiène

- [ ] Quand une page est instrumentée, mettre à jour les sections §4 et §6
  ci-dessus.
- [ ] Si un `v-model` est ajouté dans `settings/*.html`, relancer
  `python3 /tmp/instrument-settings.py` (ou le réintégrer dans `scripts/`)
  pour auto-injecter le testid manquant.
- [ ] Surveiller la dérive du `species.html`'s `<title>` qui passe en
  `BIRDASH — <espèce>` au lieu de `<siteName> — <espèce>` — incohérent avec
  les autres pages.

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
```
