# Detection Refinement Module — outils de validation

Voir la spec complète : `docs/refinement/SPEC-v2.md`.

## Phase 0 — Validation empirique de l'heuristique bbox

Script autonome qui calcule un bbox temps-fréquence pour un échantillon de
détections existantes, génère une galerie HTML statique annotable, et reporte
les métriques de coût (latence) et qualité (SNR, taux de succès).

**Garanties non-perturbatives :**

- Lit `birds.db` en mode strictement read-only (`?mode=ro&immutable=1`)
- Aucun import du moteur `engine/`, aucun chargement de modèle ML
- Décode les MP3 via `ffmpeg` en sous-processus (un à la fois)
- Sortie isolée dans `docs/refinement/phase0/` (pas dans `data/` ni `engine/`)
- À lancer en `nice -n 19 ionice -c 3` pour éviter toute contention avec
  le pipeline de détection live

**Lancement :**

```bash
nice -n 19 ionice -c 3 \
  /home/bjorn/birdengine/venv/bin/python3 \
  scripts/refinement/phase0_eval.py --n 150 --seed 42
```

Durée estimée : ~30-60 s pour 150 détections sur Pi 5 (pas d'inférence ML,
juste FFT + décodage MP3).

**Sortie :**

- `docs/refinement/phase0/index.html` — galerie annotable (annotations
  sauvegardées en localStorage du navigateur, exportables en JSON via le
  bouton « Export annotations »)
- `docs/refinement/phase0/metrics.json` — stats de coût et de qualité

**Critères go/no-go pour Phase 1** (SPEC §8) :

- ≥ 70 % de bboxes annotés `utile`
- ≤ 5 % de bboxes annotés `trompeur`
- Latence moyenne du calcul < 100 ms par détection
