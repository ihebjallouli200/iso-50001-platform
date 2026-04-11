# Priorisation Frontend par fonctionnalité (V1)

Objectif: donner un ordre d'exécution FE directement actionnable pour chaque capacité EnMS.

## Légende
- P0: indispensable V1
- P1: critique métier
- P2: amélioration post-V1

## 1) AuthN/AuthZ locale + rôles
- P0 FE-01: page login avec options Connect as, erreurs explicites, session persistée
- P0 FE-02: garde de routes par rôle (Admin Énergie, Responsable Site, Auditeur, Opérateur)
- P0 FE-03: masquage/disable des actions sensibles (lecture/écriture)
- P1 FE-04: écran profil session (expiration, dernière connexion)

## 2) Dashboard par rôle
- P0 FE-05: dashboard spécifique par rôle avec KPI adaptés
- P0 FE-06: courbes EnPI interactives (survol, comparaison baseline)
- P1 FE-07: filtres période/site/machine avec URL state
- P2 FE-08: comparaison multi-sites avancée

## 3) PDCA opérationnel
- P0 FE-09: liste cycles PDCA + statut phase Plan/Do/Check/Act
- P0 FE-10: détail cycle + actions + pièces justificatives
- P1 FE-11: création/édition cycle avec validation de formulaires
- P1 FE-12: clôture de cycle conditionnée RBAC + raison obligatoire

## 4) Approbations & documents
- P0 FE-13: file d'approbations (document/baseline/PDCA)
- P0 FE-14: écran de décision approuver/rejeter avec commentaire
- P1 FE-15: viewer versions documentaires + historique approbations
- P2 FE-16: diff visuel entre versions document

## 5) Audit & conformité
- P0 FE-17: matrice clauses 4→10 avec statut couvert/partiel/non couvert
- P0 FE-18: navigation preuve par clause (liens vers événements/docs)
- P1 FE-19: export pré-audit et accusé de génération
- P1 FE-20: suivi non-conformités et actions correctives

## 6) Machines / mesures / anomalies
- P0 FE-21: page machines live (liste + détail)
- P0 FE-22: alertes/anomalies avec niveau de sévérité et acquittement
- P1 FE-23: timeline mesures avec zoom et curseur
- P2 FE-24: corrélation machine-anomalie multi-variables

## 7) Recommandations IA (advisory-first)
- P0 FE-25: carte recommandation avec justification + impact estimé
- P0 FE-26: capture décision utilisateur (accepter/rejeter/reporter)
- P1 FE-27: historique décisions et taux d'adoption
- P2 FE-28: explicabilité avancée (contribution des variables)

## 8) Qualité data et ingestion (front exploitation)
- P1 FE-29: état ingestion (batch/stream), complétude, doublons, timezone
- P1 FE-30: journal d'import consultable
- P2 FE-31: console de rejets data + correction guidée

## 9) Observabilité produit
- P1 FE-32: page santé plateforme (API, ingestion, worker-audit)
- P1 FE-33: centre incidents techniques + statut
- P2 FE-34: SLO dashboard métier et technique

## Priorité d'implémentation FE (ordre conseillé)
1. FE-01 à FE-06 (auth + dashboards)
2. FE-09 à FE-14 (PDCA + approbations)
3. FE-17 à FE-22 (audit + preuves + anomalies)
4. FE-25 à FE-30 (IA advisory + qualité data)
5. FE-31 à FE-34 (maturité exploitation)

## Définition de terminé FE (DoD)
- Appels API réels, pas de données statiques.
- Gestion erreurs/chargement/vide standardisée.
- Contrôle d'accès visible + contrôlé côté serveur.
- Tests UI minimum sur parcours critique du rôle.
