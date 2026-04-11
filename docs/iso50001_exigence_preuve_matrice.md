# Matrice ISO 50001 - Exigence vers preuve

Références de base utilisées: schema.ts, audit_export.ts, energy_calculations.ts, reports/*

## Clauses et preuves attendues

| Clause | Exigence opérationnelle | Preuve attendue | Sources techniques actuelles | Statut |
|---|---|---|---|---|
| 4.1-4.4 | Contexte, périmètre, EnMS | Document périmètre + cartographie énergétique + responsabilités | schema.ts (responsibilities), docs | Partiel |
| 5.1-5.3 | Leadership, politique, rôles | Politique versionnée approuvée + rôles nominés | schema.ts (documentVersions, approvals, responsibilities) | Partiel |
| 6.2 | Objectifs et plans | Objectifs énergétiques + plans d'action mesurables | pdcaCycles, recommendations | Partiel |
| 6.3 | Revue énergétique | Analyse usages significatifs + risques/opportunités | measurements, anomalies, reports | Partiel |
| 6.4 | EnPI | Méthode + calculs + historique + statut | energy_calculations.ts, energyPerformanceIndicators | Couvert |
| 6.5 | Baseline (EnB) | Méthode baseline + normalisation + version | energyBaselines, energy_calculations.ts | Couvert |
| 7.2-7.3 | Compétences / sensibilisation | Attributions responsabilités + traces formation | responsibilities + docs RH | Non couvert |
| 7.5 | Information documentée | Versioning, approbation, traçabilité documentaire | documentVersions, approvals, auditLogs, configs/grafana/provisioning/* | Couvert |
| 8.1 | Maîtrise opérationnelle | Workflows PDCA + preuves d'exécution | pdcaCycles, auditLogs, /api/pdca/transition, /api/pdca/status | Couvert |
| 9.1 | Suivi/mesure/analyse | Dashboard EnPI + anomalies + KPI qualité data | Dashboard, measurements, anomalies, /api/enpi/current, /api/enb/baseline | Couvert |
| 9.2 | Audit interne | Plan audit + constats + suivi NC | audit_export.ts + worker-audit (à finaliser) | Partiel |
| 9.3 | Revue de direction | Comptes-rendus et décisions management | managementReviews | Partiel |
| 10.1-10.2 | NC, actions correctives, amélioration | Boucle corrective + preuve amélioration | PDCA + recommendations + improvementProof + aiIsoCouplingApplied | Couvert |

## Dictionnaire d'artefacts obligatoires V1

1. Politique énergétique validée (documentVersions + approvals)
2. Objectifs énergétiques annuels et plans d'action (PDCA Plan)
3. Méthode EnPI et méthode baseline (documents + calculs versionnés)
4. Journal d'anomalies et décisions associées
5. Journal d'audit immuable who/what/when/why
6. Registre actions correctives/preventives et statut
7. Dossier pré-audit par clause (preuves navigables)
8. Compte-rendu revue de direction et décisions

## Critères de conformité V1
- Chaque clause 4→10 doit avoir au moins une preuve navigable.
- Chaque preuve doit pointer vers une source horodatée.
- Chaque action sensible doit être reliée à un utilisateur, rôle et raison.

## Preuves automatiques ciblées (clauses techniques)
- 6.4, 6.5, 8.1, 9.1: `backend/tests/iso_runtime_http.test.js`
- 8.1, 9.1, 10.2: `backend/tests/ai_iso_coupling_http.test.js`
- 7.5, 9.1: `backend/tests/grafana_provisioning_contract.test.js`
- 6.4, 6.5, 7.5, 8.1, 9.1, 10.2: `backend/tests/iso50001_unified_e2e.test.js`
- Manifest machine-verifiable: `reports/iso50001_evidence_manifest.json`
- Rapport chainé d'exécution: `reports/iso50001_unified_e2e_result.json`
