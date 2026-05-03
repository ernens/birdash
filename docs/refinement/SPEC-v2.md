# SPEC — Module de raffinement des détections (Detection Refinement Module) — V2

> **Version** : 2.0
> **Statut** : Spécification de design consolidée, prête pour implémentation
> **Cible** : Birdash sur Raspberry Pi 5 (8GB), modèle Perch V2 INT8 + BirdNET V2.4
> **Auteur** : Conception itérative Björn Ernens, mai 2026
> **Précédente version** : V1 (mai 2026), revue critique externe et auto-revue

---

## Changements majeurs depuis V1

Cette V2 conserve **l'ambition globale** de la V1 (les trois niveaux, le batch, l'export Raven) mais corrige les points qui pouvaient induire une mauvaise implémentation. Le principe directeur a évolué :

> **« Le bon produit est aussi ambitieux que la spec, mais son ordre d'implémentation doit être plus discipliné. Il faut valider l'heuristique et le single-shot avant d'industrialiser le batch. »**

Liste des corrections appliquées :

| # | Domaine | V1 | V2 | Justification |
|---|---------|----|----|---------------|
| 1 | Phasage | 4 phases (Niveau 1 → batch directement) | 5 phases avec Phase 0 de validation empirique | Sans validation préalable de l'heuristique sur données réelles, on industrialise un algorithme dont la qualité est inconnue |
| 2 | Vocabulaire Niveau 2 | « Validation » | « Stability check » (vérification de stabilité au recentrage) | Le Niveau 2 ne valide rien scientifiquement ; il teste si la confiance reste stable quand on recentre la fenêtre. Un nom trompeur conduit à des décisions trompeuses |
| 3 | Pas de balayage par défaut | 200 ms | 500 ms (200 ms en mode haute précision) | À 200 ms, ~9 min/détection sur Pi 5 — inutilisable même en single-shot. À 500 ms, ~3.5 min, exploitable |
| 4 | Versioning algorithme | `{model}_hop{N}_v{X}` | `{model}_{model_version}_hop{N}_h{params_hash}` | L'ancien format ne capturait ni padding, ni smoothing, ni FWHM threshold, ni version exacte du modèle. Hash des params garantit la reproductibilité |
| 5 | Bug SQL | `job_id NOT NULL` + `ON DELETE SET NULL` (contradictoire) | `ON DELETE RESTRICT` + endpoint dédié de suppression cascade | Bug réel : la suppression d'un job aurait fait planter le moteur SQLite |
| 6 | Critères de succès | Binaire (« englobe la trace » ou non) | Quaternaire (utile / moyen / inutile / trompeur) avec seuils > 70 % utile, < 5 % trompeur | Le piège du bbox confiant mais erroné est plus dangereux qu'un bbox absent. Un critère binaire ne le capture pas |
| 7 | Position du batch dans le phasage | Phase 2 (mêlé au single-shot) | Phase 3, démarrant en CLI avant UI | Le batch UI est une feature, pas un MVP. CLI permet de prouver la valeur avant d'investir dans l'interface |
| 8 | UI batch | Page principale | Mode expert avec toggle | Cohérent avec « valider la valeur d'usage avant de l'exposer en première ligne » |

Le scope total reste inchangé : l'export Raven, les filtres taxonomiques, le batch sur historique sont conservés. Seul **l'ordre d'implémentation** et la **discipline d'évaluation** changent.

---

## 1. Vue d'ensemble

Module Birdash apportant trois capacités complémentaires :

1. **Localisation temps-fréquence** de chaque détection sur son spectrogramme (encadré visuel)
2. **Vérification de stabilité** d'une détection via re-inférence ciblée
3. **Analyse a posteriori paramétrable** sur l'historique avec filtres taxonomiques et temporels

### 1.1 Pourquoi ce module

Aucun dashboard amateur de monitoring acoustique (BirdNET-Pi, Haikubox, BirdWeather) ne propose de localisation précise des vocalises. C'est pourtant une fonctionnalité standard des outils scientifiques (Raven Pro, Kaleidoscope Pro, Whombat). Le module transpose cet outil dans le contexte amateur, avec un workflow d'analyse qui devient progressivement un véritable outil scientifique d'analyse a posteriori.

### 1.2 Cas d'usage couverts

| # | Cas d'usage | Fréquence | Niveau requis | Phase d'arrivée |
|---|-------------|-----------|---------------|-----------------|
| 1 | Validation visuelle au moment de la review | Quotidien | 1 | Phase 1 |
| 2 | QC rétroactif d'une espèce sur une période | Hebdomadaire | 3 | Phase 3 |
| 3 | Analyse temporelle ciblée | Ponctuelle | 3 | Phase 3 |
| 4 | Analyse taxonomique large | Ponctuelle | 3 | Phase 3 |
| 5 | Régénération après amélioration d'algorithme | Rare | 3 (avec versioning) | Phase 3 |
| 6 | Préparation d'un dataset annoté | One-shot | 3 | Phase 3 |

---

## 2. Architecture en 3 niveaux

| Niveau | Quand | Coût CPU | Précision | Source |
|--------|-------|----------|-----------|--------|
| 1 — Heuristique live | Sur chaque détection, synchrone | ~10-50 ms | Approximative (énergie en bande) | Signal processing pur |
| 2 — Stability check async | Optionnel, post-détection | ~12 s | Test de stabilité au recentrage | 1 inférence Perch recentrée |
| 3 — Raffinement on-demand | À la demande utilisateur | 1.5-9 min/détection (selon hop) | Précision maximale | Balayage à fenêtre glissante |

Les trois niveaux sont **indépendants et complémentaires**. Une détection peut avoir un bbox niveau 1 sans niveau 2, ou les trois superposés. La page Review affiche le plus récent disponible avec indication explicite de la source.

---

## 3. Niveau 1 — Heuristique live (signal processing)

### 3.1 Pipeline

À chaque détection produite par le pipeline existant (BirdNET ou Perch), juste après la classification, sans bloquer le retour au flux audio :

1. Récupérer le spectrogramme haute résolution de la fenêtre détectée
2. Récupérer la bande fréquentielle typique de l'espèce dans `species_frequency_bands`
3. Filtre passe-bande sur le spectrogramme (mise à zéro hors bande)
4. Calcul de l'enveloppe d'énergie temporelle dans la bande
5. Lissage léger (filtre gaussien)
6. Détection du pic dominant via `scipy.signal.find_peaks`
7. Largeur du pic à mi-hauteur (FWHM) → bornes temporelles du bbox
8. Bornes fréquentielles du bbox = bande de l'espèce

### 3.2 Algorithme de référence

```python
def heuristic_bbox(
    audio: np.ndarray,
    sr: int,
    species_fmin_hz: float,
    species_fmax_hz: float,
    nperseg: int = 2048,
    noverlap: int = 1536,
) -> dict | None:
    """
    Calcule un bounding box temps-fréquence pour une détection.
    Retourne None si aucun pic clair n'est détecté.
    """
    f, t, S = scipy.signal.spectrogram(
        audio, fs=sr,
        nperseg=nperseg, noverlap=noverlap,
        scaling='spectrum',
    )

    band_mask = (f >= species_fmin_hz) & (f <= species_fmax_hz)
    if not band_mask.any():
        return None
    S_band = S[band_mask, :]

    energy = S_band.sum(axis=0)
    energy_smooth = scipy.ndimage.gaussian_filter1d(energy, sigma=2.0)

    threshold = energy_smooth.mean() + 1.5 * energy_smooth.std()
    peaks, _ = scipy.signal.find_peaks(energy_smooth, height=threshold)
    if len(peaks) == 0:
        return None

    peak_idx = peaks[np.argmax(energy_smooth[peaks])]
    peak_value = energy_smooth[peak_idx]

    half_height = peak_value / 2
    left_idx = peak_idx
    while left_idx > 0 and energy_smooth[left_idx] > half_height:
        left_idx -= 1
    right_idx = peak_idx
    while right_idx < len(energy_smooth) - 1 and energy_smooth[right_idx] > half_height:
        right_idx += 1

    return {
        't_min_s': float(t[left_idx]),
        't_max_s': float(t[right_idx]),
        'f_min_hz': float(species_fmin_hz),
        'f_max_hz': float(species_fmax_hz),
        'peak_t_s': float(t[peak_idx]),
        'peak_energy': float(peak_value),
        'snr_estimate': float(peak_value / energy_smooth.mean()),
    }
```

### 3.3 Stockage

```sql
CREATE TABLE detection_bbox_v1 (
  detection_id        INTEGER PRIMARY KEY,
  t_min_s             REAL NOT NULL,
  t_max_s             REAL NOT NULL,
  f_min_hz            REAL NOT NULL,
  f_max_hz            REAL NOT NULL,
  peak_t_s            REAL,
  peak_energy         REAL,
  snr_estimate        REAL,
  truncated           BOOLEAN DEFAULT 0,    -- pic en bord de fenêtre
  algorithm_version   TEXT NOT NULL DEFAULT 'heuristic_v1',
  created_at          INTEGER NOT NULL,
  FOREIGN KEY (detection_id) REFERENCES detections(id) ON DELETE CASCADE
);

CREATE INDEX idx_bbox_v1_algo ON detection_bbox_v1(algorithm_version);
```

### 3.4 Edge cases

- **Pas de pic** (énergie uniforme, bruit de fond) → ne pas insérer, la détection reste sans bbox
- **Plusieurs pics d'amplitude similaire** → prendre le plus proche du centre temporel de la fenêtre (heuristique « le modèle a probablement vu le centre »)
- **Espèce absente de `species_frequency_bands`** → fallback sur la table par ordre taxonomique (§3.5)
- **Pic en bord de fenêtre** → étendre le bbox jusqu'à la borne, marquer `truncated = 1`

### 3.5 Bandes fréquentielles fallback (par ordre taxonomique)

| Ordre taxonomique | fmin (Hz) | fmax (Hz) |
|-------------------|-----------|-----------|
| Passeriformes (passereaux) | 1000 | 8000 |
| Falconiformes / Accipitriformes (rapaces diurnes) | 500 | 3500 |
| Strigiformes (rapaces nocturnes) | 200 | 2500 |
| Anseriformes / Pelecaniformes (oiseaux d'eau) | 200 | 3000 |
| Galliformes | 300 | 4000 |
| Piciformes (pics) | 800 | 5000 |
| Columbiformes | 200 | 1500 |
| Charadriiformes (limicoles, mouettes) | 1000 | 6000 |
| Apodiformes (martinets) | 4000 | 9000 |
| **Défaut générique** | 500 | 10000 |

### 3.6 Performance budget

- Cible : < 50 ms par détection sur Pi 5
- Pas de modèle ML, juste numpy + scipy déjà présents
- Latence ajoutée au pipeline live : négligeable face aux ~14 s d'inférence dual-model existante

---

## 4. Niveau 2 — Stability check (vérification de stabilité au recentrage)

> **Note de vocabulaire (V2)** : ce niveau a été renommé de « Validation » à « Stability check ». Il ne valide rien indépendamment ; il vérifie que la confiance du modèle reste stable lorsqu'on recentre la fenêtre sur le pic d'énergie identifié au Niveau 1. Une perte de stabilité indique une incohérence à examiner, pas une invalidation.

### 4.1 Principe

Pour les détections suspectes (faible confiance ou flaggées par les règles d'auto-flagging existantes), une seule inférence supplémentaire suffit à tester la stabilité du score : on recentre une fenêtre 5 s sur le pic d'énergie du Niveau 1 et on relance Perch. Si la confiance s'effondre, le bbox heuristique est probablement aligné sur le mauvais signal — ou le modèle réagissait à un contexte plus large que le pic seul.

### 4.2 Trigger conditions

L'inférence Niveau 2 s'enqueue **uniquement si toutes ces conditions sont réunies** :

- La détection a un bbox Niveau 1 valide
- ET au moins une de :
  - `detection.confidence < 0.7` (configurable)
  - une règle d'auto-flagging existante a flaggé la détection
- ET la queue n'est pas saturée (max 100 entrées en attente)
- ET le service `birdengine.service` (live) est inactif depuis > 5 s
- ET on est dans la fenêtre horaire autorisée

### 4.3 Algorithme

```python
def stability_check(detection_id: int) -> dict:
    bbox = load_bbox_v1(detection_id)
    if bbox is None:
        return {'status': 'skipped_no_bbox'}

    audio, sr = load_audio_for_detection(
        detection_id,
        center_s=bbox['peak_t_s'],
        duration_s=5.0,
    )

    species_id = get_detection(detection_id)['species_id']
    confidence = perch_infer_single_class(audio, species_id)

    original = get_detection(detection_id)['confidence']
    ratio = confidence / original

    if ratio >= 0.8:
        status = 'stable'
    elif ratio < 0.5:
        status = 'unstable'
    else:
        status = 'inconclusive'

    return {
        'status': status,
        'recentered_confidence': confidence,
        'ratio_to_original': ratio,
    }
```

### 4.4 Stockage

```sql
CREATE TABLE detection_stability_v1 (
  detection_id            INTEGER PRIMARY KEY,
  recentered_confidence   REAL NOT NULL,
  ratio_to_original       REAL NOT NULL,
  stability_status        TEXT NOT NULL,  -- 'stable' | 'unstable' | 'inconclusive'
  algorithm_version       TEXT NOT NULL,
  inference_ms            INTEGER,
  created_at              INTEGER NOT NULL,
  FOREIGN KEY (detection_id) REFERENCES detections(id) ON DELETE CASCADE
);
```

### 4.5 Service systemd

`birdengine-stability.service` — désactivé par défaut, opt-in via config. Worker Python qui :
- Lit la queue `stability_queue` en SQLite
- Tourne avec `nice -n 19` et `ionice -c 3`
- Vérifie l'inactivité de l'engine principal avant chaque inférence
- Insère le résultat dans `detection_stability_v1`

### 4.6 Intégration auto-flagging

Nouvelle règle dans `config/detection_rules.json` :

```json
{
  "name": "recentering_unstable",
  "trigger": "stability_v1.stability_status == 'unstable'",
  "label": "Détection instable au recentrage"
}
```

---

## 5. Niveau 3 — Service de raffinement on-demand

### 5.1 Vue d'ensemble

Service séparé `birdengine-refinement.service` qui :

- Consomme une queue de jobs en SQLite
- Pour chaque détection ciblée, balaye une fenêtre glissante autour de la détection originale
- Produit une **courbe de confiance temporelle** + un **bbox raffiné**
- Tourne en priorité minimale, ne perturbe jamais le pipeline live

### 5.2 Schéma fonctionnel

```
+------------------+        +-------------------+
|  Birdash UI/CLI  |        |  birdengine-      |
|                  | -----> |  refinement       |
|  Job submission  |        |  (Python)         |
|  Job monitoring  |        |                   |
|  Result display  | <----- |  - Queue worker   |
+------------------+        |  - Sliding window |
        |                   |  - Result writer  |
        |                   +-------------------+
        v                            |
   +-------------+                   v
   | birdash.db  |              +-------------+
   | (jobs +     |              |  birds.db   |
   |  results)   |              | (detections,|
   +-------------+              |  bbox v1)   |
                                +-------------+
```

### 5.3 Algorithme de balayage

Pour une détection donnée, dont la fenêtre originale couvre `[t_start, t_end]` :

1. Charger l'audio source de l'enregistrement, étendu à `[t_start - context_padding, t_end + context_padding]`
2. Pour chaque position `t_offset = -context_padding` à `+context_padding` par pas de `hop_ms` :
   - Extraire la fenêtre 5 s centrée sur cette position
   - Lancer une inférence du modèle choisi (Perch ou BirdNET)
   - Récupérer la confiance pour `detection.species_id` **spécifiquement**
3. Construire la courbe `confidence(t)` : N points
4. Identifier le pic principal :
   - Filtre médian léger pour lisser
   - Maximum global de la courbe lissée
   - Largeur à mi-hauteur (FWHM)
5. Le bbox temporel raffiné = bornes FWHM du pic
6. Le bbox fréquentiel = celui du Niveau 1
7. Score de cohérence : `peak_confidence / original_detection_confidence`
   - Si > 1.0 : raffinement améliore la décision (la fenêtre originale était mal alignée)
   - Si < 0.5 : courbe plate, détection probablement faux positif
   - Entre les deux : courbe nette, détection valide

### 5.4 Paramètres configurables

```python
@dataclass(frozen=True)
class RefinementParams:
    hop_ms: int = 500                    # défaut V2 (V1: 200)
    context_padding_s: float = 2.0
    model: Literal["perch", "birdnet"] = "perch"
    smoothing_kernel: int = 3
    fwhm_relative_threshold: float = 0.5

    # Mode haute précision : hop_ms = 200, le reste identique
```

**Justification du hop par défaut** : à 500 ms, ~22 inférences par détection sur fenêtre 5 s + padding 2 s × 2 = ~4.4 minutes CPU/détection sur Pi 5 avec Perch INT8. À 200 ms, ~45 inférences = ~9 min. Le 500 ms est un compromis entre coût et capture des vocalises (la plupart des chants ont une dynamique > 200 ms).

### 5.5 Versioning étendu (V2)

Format : `{model}_{model_version}_hop{N}_h{params_hash}`

- `model` : `perch` ou `birdnet`
- `model_version` : version exacte (ex: `int8v1` pour ton Perch quantifié, `v24` pour BirdNET 2.4)
- `N` : pas de balayage en ms
- `params_hash` : 6 premiers caractères du SHA-256 de la sérialisation canonique JSON des `RefinementParams` (incluant tous les champs : padding, smoothing, fwhm_threshold)

Exemples :
- `perch_int8v1_hop500_h7a3f2b` : Perch INT8 v1, pas 500 ms, params standard
- `perch_int8v1_hop200_h9d4e1a` : même modèle, pas 200 ms, params différents
- `perch_int8v2_hop500_h7a3f2b` : nouveau modèle quantifié v2, mêmes params logiciels

```python
import hashlib
import json
from dataclasses import asdict

def compute_algorithm_version(params: RefinementParams, model_version: str) -> str:
    canonical = json.dumps(asdict(params), sort_keys=True)
    h = hashlib.sha256(canonical.encode()).hexdigest()[:6]
    return f"{params.model}_{model_version}_hop{params.hop_ms}_h{h}"
```

Cette extension garantit que **tout changement de paramètre produit une `algorithm_version` distincte**, et que les résultats sont reproductibles.

### 5.6 Schéma SQLite (jobs et résultats)

```sql
CREATE TABLE refinement_jobs (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  query_filter                TEXT NOT NULL,
  params                      TEXT NOT NULL,
  status                      TEXT NOT NULL,    -- 'queued' | 'running' | 'paused'
                                                --  | 'done' | 'cancelled' | 'failed'
  total_detections            INTEGER NOT NULL,
  processed_detections        INTEGER DEFAULT 0,
  failed_detections           INTEGER DEFAULT 0,
  estimated_cpu_seconds       INTEGER NOT NULL,
  estimated_completion_at     INTEGER,
  created_at                  INTEGER NOT NULL,
  started_at                  INTEGER,
  finished_at                 INTEGER,
  algorithm_version           TEXT NOT NULL,
  user_note                   TEXT,
  source                      TEXT NOT NULL,   -- 'cli' | 'ui_single' | 'ui_batch'
  notify_on_completion        BOOLEAN DEFAULT 1,
  error_message               TEXT
);

CREATE INDEX idx_jobs_status_created ON refinement_jobs(status, created_at DESC);
CREATE INDEX idx_jobs_algo_version ON refinement_jobs(algorithm_version);

-- V2: ON DELETE RESTRICT au lieu de SET NULL (corrige le bug V1)
CREATE TABLE refinement_results (
  detection_id          INTEGER NOT NULL,
  job_id                INTEGER NOT NULL,
  confidence_curve      TEXT NOT NULL,
  peak_t_s              REAL NOT NULL,
  peak_confidence       REAL NOT NULL,
  fwhm_t_min_s          REAL NOT NULL,
  fwhm_t_max_s          REAL NOT NULL,
  bbox_t_min_s          REAL NOT NULL,
  bbox_t_max_s          REAL NOT NULL,
  bbox_f_min_hz         REAL NOT NULL,
  bbox_f_max_hz         REAL NOT NULL,
  consistency_score     REAL,
  algorithm_version     TEXT NOT NULL,
  computed_at           INTEGER NOT NULL,
  PRIMARY KEY (detection_id, algorithm_version),
  FOREIGN KEY (detection_id) REFERENCES detections(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES refinement_jobs(id) ON DELETE RESTRICT
);

CREATE INDEX idx_refinement_results_job ON refinement_results(job_id);

CREATE VIEW refinement_results_latest AS
SELECT r1.* FROM refinement_results r1
WHERE r1.computed_at = (
  SELECT MAX(r2.computed_at)
  FROM refinement_results r2
  WHERE r2.detection_id = r1.detection_id
);
```

**Conséquence du `ON DELETE RESTRICT` (corrigée par rapport à V1)** : un job ne peut pas être supprimé tant qu'il a des résultats associés. Pour purger un job + ses résultats, l'utilisateur doit explicitement passer par l'endpoint `DELETE /api/refinement/jobs/:id?cascade=true` qui supprime d'abord les résultats puis le job dans une transaction.

### 5.7 Structure des filtres (`query_filter`)

```json
{
  "species_codes": ["eurkes", "eurrob1"],
  "taxon": {
    "rank": "order",
    "name": "Pelecaniformes"
  },
  "date_range": {
    "from": "2025-11-01T00:00:00Z",
    "to": "2026-05-01T23:59:59Z"
  },
  "time_of_day": {
    "from": "05:00",
    "to": "08:00"
  },
  "confidence_range": {
    "min": 0.0,
    "max": 0.7
  },
  "exclude_already_refined_at_version": "perch_int8v1_hop500_h7a3f2b",
  "limit": null
}
```

Règles :
- `species_codes` ET `taxon` mutuellement exclusifs
- Tous les autres filtres se combinent en AND
- `exclude_already_refined_at_version` : exclut les détections déjà raffinées à cette version exacte (idempotence)
- `limit` : optionnel, plafond hard

### 5.8 Contention CPU — règles non négociables

1. **Priorité système** : worker en `nice -n 19` + `ionice -c 3`
2. **Détection d'activité de l'engine** : sentinelle `/tmp/birdengine-active`. Si actif depuis < 5 s, attendre 100 ms et réessayer
3. **Fenêtre horaire configurable** par défaut 1h-6h
4. **Override manuel** : checkbox UI ou flag CLI `--force-immediate`
5. **Throttling thermique** : si `vcgencmd measure_temp` > 75 °C pendant > 30 s, pause 60 s
6. **Concurrence** : `max_concurrent_jobs = 1` par défaut

### 5.9 Estimation préalable du coût

```python
def estimate_job(query_filter, params, model_version) -> dict:
    n_total = count_matching_detections(query_filter)
    algo_v = compute_algorithm_version(params, model_version)
    n_already = count_already_refined(query_filter, algo_v)
    n_to_process = n_total - n_already

    window_s = 5.0 if params.model == "perch" else 3.0
    total_window_s = window_s + 2 * params.context_padding_s
    inferences_per_detection = total_window_s / (params.hop_ms / 1000)

    inference_time_s = 12.0 if params.model == "perch" else 2.0
    cpu_seconds = n_to_process * inferences_per_detection * inference_time_s

    available_hours_per_day = compute_available_hours(config)
    wallclock_days = cpu_seconds / (available_hours_per_day * 3600)

    return {
        'matching_detections': n_total,
        'already_refined_at_this_version': n_already,
        'to_process': n_to_process,
        'inferences_per_detection': int(inferences_per_detection),
        'estimated_cpu_seconds': int(cpu_seconds),
        'estimated_wallclock_human': humanize_duration(wallclock_days),
        'algorithm_version': algo_v,
        'warnings': generate_warnings(n_to_process, cpu_seconds),
    }
```

Warnings à générer :
- `to_process > 1000` : « Job important, envisagez de réduire les filtres ou d'augmenter `hop_ms` »
- `cpu_seconds > 100000` : « Plus de 28 h de CPU — considérez de découper »
- `to_process == 0` : « Aucune détection à traiter »
- `params.hop_ms < 200` : « Pas de balayage très fin, coût quadruple — réservé aux cas exceptionnels »

---

## 6. API et CLI

### 6.1 CLI (Phase 3, étape 1)

Le batch démarre en CLI avant toute UI. Cela permet de prouver la valeur d'usage sans investir dans une interface complète.

Exécutable `birdash-refine` installé dans le venv :

```bash
# Estimation préalable
birdash-refine estimate \
  --species eurkes \
  --from 2025-11-01 --to 2026-05-01 \
  --hop-ms 500

# Lancement
birdash-refine run \
  --species eurkes \
  --from 2025-11-01 --to 2026-05-01 \
  --hop-ms 500 \
  --note "QC kestrels Q1 2026" \
  --notify

# Monitoring
birdash-refine status                          # liste tous les jobs
birdash-refine status --id 42                  # détail
birdash-refine logs --id 42 --follow

# Actions
birdash-refine cancel --id 42
birdash-refine pause --id 42
birdash-refine resume --id 42

# Export
birdash-refine export --id 42 --format raven > kestrels.txt
birdash-refine export --id 42 --format csv > kestrels.csv
```

Le CLI partage le même service backend que l'UI future. Les jobs créés en CLI sont visibles dans la base et exécutés par le même worker.

### 6.2 API REST (Phase 2 pour single-shot, Phase 3.5+ pour batch)

#### Phase 2 — endpoints minimaux

```
POST /api/refinement/detections/:id/refine
  Body: { params }
  Crée un mini-job single-detection.
  Response 202: { job_id, estimated_seconds, tracking_url }

GET /api/refinement/detections/:id
  Retourne tous les niveaux de raffinement disponibles pour une détection.
```

#### Phase 3.5+ — endpoints batch (à activer si CLI prouve l'usage)

```
POST /api/refinement/estimate           Estimation sans soumission
POST /api/refinement/jobs               Soumission d'un job batch
GET  /api/refinement/jobs               Liste paginée
GET  /api/refinement/jobs/:id           Détail
POST /api/refinement/jobs/:id/cancel
POST /api/refinement/jobs/:id/pause
POST /api/refinement/jobs/:id/resume
DELETE /api/refinement/jobs/:id?cascade=true   Suppression cascade explicite
GET  /api/refinement/jobs/:id/export?format=raven|csv
```

Détails JSON identiques à V1, à ceci près que tous les `algorithm_version` utilisent désormais le format étendu V2.

---

## 7. UI / Frontend

### 7.1 Modifications de pages existantes (Phase 1)

#### Toutes les pages affichant des spectrogrammes

- Overlay SVG avec le bbox disponible le plus récent (Niveau 3 > Niveau 2 > Niveau 1)
- **Légende explicite** indiquant la source :
  - Niveau 1 : « Localisation par énergie spectrale »
  - Niveau 3 : « Localisation par balayage modèle »
- Style visuel différencié : trait pointillé pour Niveau 1, trait plein pour Niveau 3
- Toggle utilisateur « Afficher les encadrés » (préférence persistée localStorage)

#### `spectrogram.html` — Live spectrogram

- Au moment d'une détection (notification SSE), afficher l'encadré Niveau 1 en surimpression pendant 5 s puis fade-out
- Couleur dérivée de l'espèce (hash → palette HSL)
- Tooltip au survol : nom espèce + confiance + dimensions du bbox + source

#### `review.html` — Detection Review (Phase 1 puis Phase 2)

**Phase 1 :**
- Encadré Niveau 1 visible par défaut
- Indicateur visuel pour `recentering_unstable` du Niveau 2 (badge « Instable au recentrage »)

**Phase 2 :**
- Bouton « Localiser précisément » par détection :
  - Modal de confirmation avec estimation (~4 min en hop 500 ms)
  - Spinner avec progression
  - Au retour : courbe de confiance + bbox raffiné en superposition au Niveau 1
- Affichage différentiel Niveau 1 vs Niveau 3 si les deux sont présents

### 7.2 Nouvelles pages (Phase 3.5+)

#### `refinement.html` — Page batch (mode expert, désactivée par défaut)

⚠️ **Position V2** : cette page est **derrière un toggle « Mode expert »** dans les settings (désactivé par défaut). Cohérent avec le principe « valider l'usage avant d'exposer en première ligne ».

Trois sections :
- Soumission de job (formulaire avec sélecteur taxonomique cascade, plage de dates, paramètres avancés)
- Jobs en cours et historique (tableau)
- Visualisation des résultats par job (stats + liste)

Détails de l'UI inchangés par rapport à V1, à ceci près qu'elle n'apparaît que si l'utilisateur a explicitement activé le mode expert.

### 7.3 Nouveaux composants Vue 3

- `<TaxonomySelector>` : cascade ordre→famille→genre→espèce (Phase 3.5+)
- `<ConfidenceCurve>` : tracé courbe de confiance temporelle (Phase 2)
- `<SpectrogramOverlay>` : SVG overlay réutilisable (Phase 1)
- `<JobEstimationPanel>` : affichage estimation avec warnings (Phase 3+ CLI puis 3.5+ UI)

---

## 8. Phasage révisé (V2)

Le phasage est plus discipliné qu'en V1. Chaque phase a un **gate explicite** : on ne passe à la suivante que si les critères de la précédente sont validés.

### Phase 0 — Validation empirique de l'heuristique

**Durée estimée** : 3-5 jours.

**Livrables** :
- Script Python autonome qui prend un échantillon de 100-200 détections existantes (de la base SQLite Birdash actuelle) et calcule un bbox heuristique pour chacune
- Génération d'une **galerie HTML statique** : pour chaque détection, spectrogramme + bbox superposé + métadonnées (espèce, confiance originale, SNR estimé)
- Annotation manuelle par toi-même : pour chacune, classer en `utile` / `moyen` / `inutile` / `trompeur`

**Définitions des catégories** :
- **utile** : le bbox englobe correctement la vocalise visible
- **moyen** : le bbox est imprécis mais aide visuellement à localiser
- **inutile** : le bbox est positionné aléatoirement sans correspondance visible
- **trompeur** : le bbox semble confiant mais pointe vers une zone non liée à l'espèce détectée (faux positif visuel)

**Critères go/no-go pour Phase 1** :
- ≥ 70 % de bboxes classés `utile`
- ≤ 5 % de bboxes classés `trompeur`
- Latence moyenne du calcul < 100 ms par détection

Si critères non atteints : itérer sur l'algorithme heuristique (revoir les seuils, le lissage, les bandes par espèce) avant Phase 1. Si critères persistent en échec après 2-3 itérations, reconsidérer l'approche.

### Phase 1 — Niveau 1 productisé

**Durée estimée** : 1-2 semaines.

**Livrables** :
- Algorithme heuristique intégré dans `engine.py`
- Tables `detection_bbox_v1` et `species_frequency_bands` avec migrations
- Population manuelle des 30-50 espèces les plus fréquentes en Belgique
- Composant `<SpectrogramOverlay>` Vue 3
- Affichage sur Review et Spectrogramme live
- Toggle d'affichage utilisateur
- **Backfill CLI léger** : `birdash-refine backfill --algorithm heuristic_v1` pour rétroappliquer aux détections historiques

**Critères de succès** :
- Métriques utile/moyen/trompeur respectées en production sur 1 semaine de détections
- Latence ajoutée au pipeline live mesurée < 100 ms
- 0 régression sur le pipeline existant

### Phase 2 — Niveau 3 single-shot depuis Review

**Durée estimée** : 2-3 semaines.

**Livrables** :
- Service `birdengine-refinement.service` avec scheduler simple
- Schéma DB jobs/results
- Endpoints API minimaux (single-shot uniquement)
- Algorithme de balayage avec hop 500 ms par défaut, 200 ms en mode haute précision
- Composant `<ConfidenceCurve>`
- Bouton « Localiser précisément » dans Review
- Versioning étendu opérationnel

**Critères de succès** :
- Sur 50 détections testées en single-shot, le bbox Niveau 3 est jugé `utile` dans ≥ 80 % des cas (critère plus exigeant qu'au Niveau 1)
- Aucun lag mesurable sur le pipeline live pendant les calculs
- L'utilisateur déclare avoir effectivement utilisé le bouton ≥ 10 fois en 2 semaines (signal d'usage réel)

**⚠️ Gate explicite vers Phase 3** : si le bouton « Localiser précisément » est utilisé < 5 fois en 2 semaines, **ne pas implémenter Phase 3 batch**. Le besoin est plus théorique que réel.

### Phase 3 — Niveau 3 batch en CLI uniquement

**Durée estimée** : 2 semaines.

**Livrables** :
- Outil `birdash-refine` (CLI Python) installé dans le venv
- Sous-commandes : `estimate`, `run`, `status`, `logs`, `cancel`, `pause`, `resume`, `export`, `backfill`
- Filtres taxonomiques + temporels + confidence
- Estimation préalable obligatoire
- Notifications Apprise/ntfy en fin de job (réutilise l'infra existante)
- Export Raven Selection Table

**Critères de succès** :
- Tu utilises le CLI au moins 3 fois sur des cas réels avec des filtres différents
- Tu identifies au moins 1 cas où le batch a apporté une valeur que le single-shot ne pouvait pas (ex : QC d'une espèce sur 3 mois)

**⚠️ Gate explicite vers Phase 3.5** : si le CLI est utilisé moins de 3 fois en 1 mois, **ne pas implémenter l'UI batch**. Le CLI suffit pour les rares cas d'usage.

### Phase 3.5 — UI batch derrière toggle expert

**Durée estimée** : 2-3 semaines.

**Conditionnel à la validation Phase 3.**

**Livrables** :
- Page `refinement.html` avec sections soumission / jobs / résultats
- Composants `<TaxonomySelector>` et `<JobEstimationPanel>`
- Toggle « Mode expert » dans Settings (désactivé par défaut)
- Documentation in-app expliquant les coûts et garde-fous

### Phase 4 — Niveau 2 (stability check) + polishing

**Durée estimée** : 2 semaines.

**Livrables** :
- Service `birdengine-stability.service` (opt-in)
- Trigger conditions et queue
- Règle d'auto-flagging `recentering_unstable`
- Affichage du badge « Instable au recentrage » dans Review
- Polishing UX général : reprise après reboot, stats agrégées, multi-versions UI

**Note** : le Niveau 2 est volontairement repositionné en Phase 4 (pas Phase 3 comme en V1) parce que sa valeur est faible tant que le Niveau 3 single-shot n'est pas en place. Mieux vaut un raffinement explicite qu'un check automatique de stabilité ambigu.

### Phase 5 — Export scientifique élargi

**Durée estimée** : 1-2 semaines, à intégrer au fil de l'eau dès Phase 3.

**Livrables** :
- Export Raven Selection Table (commencé en Phase 3)
- Compatibilité avec `bioacoustics-model-zoo` (kitzeslab) — format pickle/parquet pour intégration dans pipelines de recherche
- Documentation utilisateur sur l'usage en workflow scientifique

L'export Raven n'est **pas un gadget** : c'est ce qui transforme Birdash en porte d'entrée vers l'écosystème scientifique. Une fois disponible, c'est aussi un argument marketing pour la communauté ornithologique.

---

## 9. Intégration avec l'existant

### 9.1 Nouveaux services systemd

À ajouter dans `engine/` :

| Service | Phase d'arrivée | État par défaut |
|---------|-----------------|-----------------|
| `birdengine-refinement.service` | Phase 2 | activé |
| `birdengine-stability.service` | Phase 4 | désactivé (opt-in) |

`install.sh` doit créer et activer/désactiver selon ces défauts.

### 9.2 Modifications du recording engine

Dans `engine/engine.py`, après chaque détection enregistrée :

```python
def on_detection_recorded(detection):
    # Niveau 1 — synchrone, < 50ms (Phase 1+)
    if config.bbox.enabled:
        bbox = compute_heuristic_bbox(detection)
        if bbox:
            insert_bbox_v1(detection.id, bbox)

    # Niveau 2 — async, opt-in (Phase 4+)
    if config.stability.enabled and should_check_stability(detection):
        enqueue_stability_check(detection.id)
```

### 9.3 Configuration (`engine/config.toml`)

```toml
[bbox]
enabled = true
algorithm_version = "heuristic_v1"
spectrogram_nperseg = 2048
spectrogram_noverlap = 1536

[stability]
enabled = false                      # opt-in (Phase 4+)
trigger_below_confidence = 0.7
trigger_on_autoflag = true
max_queue_size = 100

[refinement]
enabled = true
allowed_hours_start = "01:00"
allowed_hours_end = "06:00"
allow_outside_hours_with_user_override = true
default_hop_ms = 500                 # V2: 500ms (V1: 200ms)
high_precision_hop_ms = 200          # mode haute précision
default_model = "perch"
default_context_padding_s = 2.0
max_concurrent_jobs = 1
hard_limit_detections_per_job = 50000
cpu_temp_threshold_celsius = 75
cpu_temp_pause_seconds = 60
notify_completion_via_apprise = true

[refinement.ui]
expert_mode_enabled = false          # Phase 3.5+, opt-in via Settings
```

### 9.4 Données de référence : `species_frequency_bands`

Phase 1 : population manuelle pour les ~30-50 espèces les plus fréquentes en Belgique. Format CSV importable :

```csv
species_code,fmin_hz,fmax_hz,source,notes
eurrob1,2000,8000,literature,Erithacus rubecula
eurkes,800,3500,literature,Falco tinnunculus
gretit1,2500,7000,literature,Parus major
```

Sources possibles : Cramp & Simmons, Glutz von Blotzheim, mesures Xeno-Canto.

⚠️ **Question ouverte (§11.2)** : automatisation de cette population.

---

## 10. Métriques à instrumenter

**Niveau 1**
- Distribution `utile / moyen / inutile / trompeur` (échantillonnage manuel mensuel sur 50 détections aléatoires)
- % de détections avec bbox calculé (objectif > 95 %)
- Distribution des `snr_estimate`
- Latence moyenne de calcul

**Niveau 2 (Phase 4+)**
- % de détections `unstable` (objectif < 10 % en régime normal)
- Profondeur de la queue au cours du temps

**Niveau 3**
- Nombre de raffinements single-shot par semaine (signal d'usage)
- Nombre de jobs batch par mois (signal d'usage CLI/UI)
- Durée moyenne de job, taux d'échec
- Distribution `peak_confidence`, FWHM, `consistency_score`

Exposer en JSON via `/api/refinement/metrics`. Le but n'est pas seulement la qualité, c'est aussi de **valider que les fonctionnalités sont effectivement utilisées** — ce qui détermine les phases suivantes.

---

## 11. Questions ouvertes

### 11.1 Source des bandes fréquentielles

Population manuelle vs scrap Xeno-Canto vs apprentissage automatique sur le corpus Birdash.

**Recommandation** : manuel pour Phase 1, automatiser plus tard si volume justifie.

### 11.2 Stockage des courbes de confiance

JSON inline en SQLite vs fichiers Parquet séparés. Volumétrie estimée : 100 points × 16 bytes × 1M détections raffinées = 1.6 GB. Acceptable sur SSD 1TB.

**Recommandation** : JSON inline pour Phase 2-3. Migrer si la base SQLite dépasse 5 GB.

### 11.3 Politique de rétention des versions

**Recommandation** : tout garder par défaut. Commande CLI `birdash-refine purge --before <date> --keep-latest` pour nettoyage manuel.

### 11.4 Reprise après reboot

Si le Pi reboote pendant un job de 14 h, on reprend où on s'était arrêté ou on relance from scratch ?

**Recommandation** : checkpointing en SQLite. Worker au démarrage cherche les jobs `running`, les bascule en `paused`, l'utilisateur les reprend manuellement.

### 11.5 Concurrence multi-utilisateurs

Si plusieurs personnes accèdent à Birdash et soumettent des jobs concurrents.

**Recommandation** : queue partagée naturelle via SQLite. Tous voient tous les jobs.

### 11.6 Précision fréquentielle dynamique

Bbox actuel utilise des bandes statiques par espèce. Évolution possible vers analyse dynamique.

**Recommandation** : laisser pour Phase 5+.

---

## 12. Annexes

### 12.1 Exemple de courbe de confiance attendue

Détection nette de Rouge-gorge, fenêtre 5 s, hop 500 ms (V2 défaut) :

```
t (s)   confidence
-2.0    0.08
-1.5    0.12
-1.0    0.31
-0.5    0.81
 0.0    0.92  <- pic
 0.5    0.62
 1.0    0.18
 1.5    0.10
 2.0    0.08
```

11 points (vs 22 avec hop 200 ms). FWHM ~700 ms, suffisant pour identifier la vocalise.

### 12.2 Estimations CPU (V2)

Hypothèses : Perch INT8 sur Pi 5 = 12 s/inférence, padding 2 s.

**Avec hop 500 ms (défaut V2)** : (5 + 4) / 0.5 = 18 inférences = **216 s = 3.6 min/détection**.

**Avec hop 200 ms (haute précision)** : (5 + 4) / 0.2 = 45 inférences = 540 s = 9 min/détection.

| Scénario | Détections | CPU (hop 500) | Wallclock 5h/nuit |
|----------|------------|---------------|-------------------|
| Single-shot Review | 1 | 3.6 min | immédiat |
| 1 espèce / 1 jour (50) | 50 | 3 h | 1 nuit |
| 1 espèce / 6 mois (5000) | 5000 | 300 h | ~60 nuits |
| 1 ordre / 1 mois (200) | 200 | 12 h | 3 nuits |

→ Le passage de 200 → 500 ms divise les coûts par 2.5.

### 12.3 Format Raven Selection Table

```
Selection    View    Channel    Begin Time (s)    End Time (s)    Low Freq (Hz)    High Freq (Hz)    Species    Confidence
1    Spectrogram 1    1    1.42    2.15    2000    8000    Erithacus rubecula    0.92
2    Spectrogram 1    1    5.31    6.04    800    3500    Falco tinnunculus    0.78
```

### 12.4 Glossaire (V2 update)

- **Bbox** : Bounding Box, rectangle temps × fréquence sur le spectrogramme
- **FWHM** : Full Width at Half Maximum, largeur d'un pic à mi-hauteur
- **Hop** : pas de balayage de la fenêtre glissante
- **Consistency score** : ratio entre confiance au pic raffiné et confiance originale
- **Stability check** (V2) : vérification de la stabilité du score au recentrage. Remplace l'ancien terme « Validation » (V1) qui suggérait à tort une vérification scientifique indépendante
- **Algorithm version** : identifiant `{model}_{model_version}_hop{N}_h{params_hash}` permettant de coexister plusieurs raffinements pour une même détection
- **Selection Table** : format tabulé Raven Pro pour annotations bioacoustiques
- **Mode expert** : toggle dans Settings exposant les fonctionnalités avancées (UI batch). Désactivé par défaut

---

## 13. Décisions tracées (V2)

Pour la traçabilité de l'implémentation, voici les décisions prises et leur rationale.

| Décision | Rationale |
|----------|-----------|
| Hop par défaut 500 ms | Compromis coût/précision. 9 min/détection en hop 200 est inutilisable même en single-shot. À 500 ms, 3.6 min reste exploitable et capture la dynamique de la majorité des chants |
| Phase 0 obligatoire | Sans validation empirique, on industrialise un algorithme dont la qualité est inconnue. Le bbox `trompeur` est dangereux car il donne une fausse confiance |
| Niveau 2 renommé `stability` | Le mot « validation » suggère une garantie scientifique. Le mécanisme ne garantit que la stabilité du score, pas la justesse de la décision |
| Niveau 2 reporté en Phase 4 | Sa valeur dépend de l'existence du Niveau 3. Avant, c'est un check automatique mal cadré |
| Batch en CLI avant UI | Permet de prouver l'usage avec un coût d'implémentation 5× moindre que l'UI complète. Si le CLI est peu utilisé, l'UI est inutile |
| Versioning par hash des params | Le format V1 manquait padding et smoothing. Le hash garantit que tout changement produit une version distincte et reproductible |
| `ON DELETE RESTRICT` au lieu de `SET NULL` | Le V1 contenait un bug : `NOT NULL` + `SET NULL` est contradictoire. RESTRICT préserve les données et force une décision explicite à la suppression |
| Mode expert toggle pour UI batch | Cohérent avec « valider la valeur d'usage avant de l'exposer en première ligne ». Évite de diluer l'UX pour les utilisateurs n'ayant pas besoin du batch |
| Critères utile/moyen/trompeur | Critère binaire ne capture pas le piège du bbox confiant mais erroné. Quaternaire avec seuils explicites force une évaluation honnête |

---

## 14. Références

- Birdash repo : https://github.com/ernens/birdash
- Perch V2 : https://research.google/pubs/perch-20-the-bittern-lesson-for-bioacoustics/
- BirdNET : https://birdnet.cornell.edu/
- Raven Pro : https://www.ravensoundsoftware.com/software/raven-pro/
- perch-hoplite (agile modeling) : https://github.com/google-research/perch-hoplite
- AudioProtoPNet : https://www.sciencedirect.com/science/article/pii/S1574954125000901
- bioacoustics-model-zoo : https://github.com/kitzeslab/bioacoustics-model-zoo

---

*Fin du document — V2.0.*
