# Roadmap d'exécution EnMS ISO 50001 V1

Date de référence: 2026-04-04
Objectif: pré-audit interne ISO 50001 avec architecture multi-services et interfaces par rôle.

## Principes de priorisation
- P0: Bloquant production/audit/sécurité
- P1: Critique métier V1
- P2: Important mais planifiable après V1

## Phasage recommandé

### Phase A - Stabilisation exécutable (Semaine 1)
1. Cadrer le référentiel ISO en matrice exigence→preuve + dictionnaire d'artefacts (P0)
2. Stabiliser le socle exécutable runtime/build/tests unitaires (P0)
3. Aligner modèle de données et migrations SQL/Drizzle (P0)

### Phase B - Sécurité et API métier (Semaines 2-3)
4. AuthN/AuthZ V1 locale + RBAC global + audit des accès (P0)
5. Recomposer API métier complète et normalisée (P0)
6. Topologie monorepo 5 services + contrats inter-services (P1)

### Phase C - Valeur métier et conformité (Semaines 3-5)
7. Industrialiser moteur métier ISO versionné (P1)
8. Connecter frontend au backend réel + workflows approbation (P0)
9. Déployer worker-audit et dossiers de preuve par clause (P1)

### Phase D - Données, IA, exploitation (Semaines 5-8)
10. Service ingestion mixte + qualité et traçabilité (P1)
11. Service analytics advisory-first + registry minimal (P1)
12. Observabilité et exploitation (P1)
13. Qualité & livraison CI/CD + sécurité + E2E (P0)

## Dépendances critiques
- Auth/RBAC avant exposition des mutations sensibles.
- Contrats API/DTO avant implémentation frontend massive.
- Schéma/migrations alignés avant ingestion et analytics.
- Worker-audit dépend des événements métier normalisés.

## Jalons de sortie
- J1: Plateforme exécutable sécurisée avec login, rôles, endpoints critiques, dashboards rôle.
- J2: Flux E2E complet ingestion→EnPI→anomalie→PDCA→preuve.
- J3: Pré-audit interne simulé avec preuves navigables clauses 4→10.

## Mise à jour exécution (2026-04-05)

### Ingestion opérationnelle (implémenté)
- Batch loader Python créé: `ingestion/batch_csv_loader.py`.
	- Lot journalier via `--batch-date`.
	- Chargement bulk par `COPY` en table staging temporaire.
	- Insertion validée vers Timescale + traçage des rejets en table dédiée.
- Dépendances Python ingestion: `ingestion/requirements.txt`.
- Backend branché en mode parallèle DB+fallback JSON:
	- Repository DB: `backend/core/ingestion_repository.js`.
	- Endpoints qualité raccordés au repository DB avec fallback JSON conservé.

### Rétention et historique (implémenté)
- Migration de politique de rétention: `migrations/0003_retention_policy.sql`.
	- Rétention brute 90 jours (`energy_measurements_synthetic`).
	- Compression + politique de compression.
	- Stratégie agrégée optionnelle (continuous aggregate horaire + rétention 365 jours).
	- Requêtes de vérification purge/consistance incluses en fin de script.

### Opérations et validation (implémenté)
- Runbook local enrichi: `README.md` (variables, troubleshooting, procédure de test).
- Contrats backend adaptés (ingestion/readiness/health + admin flush + qualité parallèle).
- Smoke complète exécutée avec succès via `backend/tests/smoke_http_e2e_runner.js`.
