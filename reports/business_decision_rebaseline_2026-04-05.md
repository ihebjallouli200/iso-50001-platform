# Decision Metier - Rebaselining Seuils Forecast (60/360)

Date: 2026-04-05
Contexte: Pre-validation IA offline large executee sur dataset `machine_telemetry_1min_12m.csv`.

## Resume technique
- MAPE 60 min: 0.065878 (cible actuelle 0.06) -> en ecart de +0.005878
- MAPE 360 min: 0.148676 (cible actuelle 0.08) -> en ecart de +0.068676
- MAPE 1440 min: 0.040916 (cible actuelle 0.10) -> conforme
- Mode de deploiement maintenu: `advisory_only`

## Proposition de rebaselining phase 1
- 60 min: 0.07
- 360 min: 0.16
- 1440 min: 0.10 (inchange)

## Caractere obligatoire / non obligatoire
- Decision metier de rebaselining 60/360: OBLIGATOIRE
Raison: sans cette validation, le gate reste bloque malgre entrainement large stable.
- Benchmark foundation models (TimesFM/Chronos): NON OBLIGATOIRE
Raison: utile pour amelioration ulterieure, non bloquant pour cloture pre-validation offline.

## Decision a valider
- [ ] APPROUVE la proposition phase 1
- [ ] REJETE la proposition phase 1

## Sign-off
- Responsable metier:
- Date:
- Commentaire:
