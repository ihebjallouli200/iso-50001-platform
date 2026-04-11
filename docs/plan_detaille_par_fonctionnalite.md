# Plan détaillé par fonctionnalité avec priorités frontend

## 1. Référentiel ISO exigence→preuve
- Livrable: matrice clause/preuve + dictionnaire artefacts
- Frontend prioritaire: P0 FE-17, FE-18
- Dépendances: worker-audit, documents, approvals

## 2. Stabilisation socle exécutable
- Livrable: baseline build/tests runtime
- Frontend prioritaire: P0 FE-01, FE-02, FE-03
- Dépendances: auth/session, normalisation erreurs API

## 3. Topologie monorepo 5 services
- Livrable: conventions contrats sync/async + versionnement
- Frontend prioritaire: P1 FE-07 (URL/filter), FE-32 (santé services)
- Dépendances: API gateway, event bus, corrélation

## 4. Modèle de données et migrations
- Livrable: schéma aligné + migrations complètes
- Frontend prioritaire: P0 FE-13, FE-15, FE-20
- Dépendances: approvals/documentVersions/managementReviews

## 5. AuthN/AuthZ V1
- Livrable: comptes locaux, sessions, RBAC global, audit accès
- Frontend prioritaire: P0 FE-01 à FE-04
- Dépendances: auditLogs, endpoints auth

## 6. API métier complète
- Livrable: endpoints normalisés + pagination/idempotence
- Frontend prioritaire: P0 FE-21, FE-22, FE-09, FE-10
- Dépendances: validation stricte, erreurs uniformes

## 7. Moteur métier ISO versionné
- Livrable: service calcul EnPI/Baseline/Improvement
- Frontend prioritaire: P0 FE-06, P1 FE-23
- Dépendances: service calcul, historiques

## 8. Ingestion mixte
- Livrable: batch/stream + qualité + journal append-only
- Frontend prioritaire: P1 FE-29, FE-30
- Dépendances: connecteurs ERP/MES/SCADA

## 9. Analytics advisory-first
- Livrable: recommandations explicables + décision utilisateur
- Frontend prioritaire: P0 FE-25, FE-26
- Dépendances: pipeline inférence, registry minimal

## 10. Worker-audit pré-audit
- Livrable: dossier de preuve clause avec liens corrélés
- Frontend prioritaire: P0 FE-17, FE-18, P1 FE-19
- Dépendances: événements corrélés

## 11. Frontend connecté backend réel
- Livrable: suppression statique Dashboard/PDCA, workflows justificatifs
- Frontend prioritaire: P0 FE-05 à FE-14
- Dépendances: endpoints stables + auth bearer

## 12. Observabilité & exploitation
- Livrable: logs/metrics/alertes + playbooks
- Frontend prioritaire: P1 FE-32, FE-33
- Dépendances: collecteur logs, métriques SLI/SLO

## 13. Qualité & livraison
- Livrable: tests unit/int/E2E + CI/CD + rollback migrations
- Frontend prioritaire: tests E2E parcours rôle
- Dépendances: pipeline CI + environnements dev/staging/prod

## Ordre d'exécution frontend recommandé
1) Auth + RBAC + dashboards (P0)
2) PDCA + approbations (P0)
3) Audit/preuve + anomalies/machines (P0)
4) IA advisory + ingestion qualité (P1)
5) Observabilité produit (P1/P2)
