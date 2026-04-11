# Audit des User Stories — Plateforme ISO 50001

Analyse point par point de chaque user story par rapport au code existant.

> [!NOTE]
> Légende : ✅ **Développé** | ⚠️ **Partiellement développé** | ❌ **Non développé**

---

## Epic 1 — Intégration de données

| # | User Story | Statut | Justification |
|---|-----------|--------|---------------|
| 1.1 | Connecter PLC/MES/SCADA via **OPC-UA ou Modbus** pour lier données production ↔ énergie | ❌ Non développé | Aucun connecteur OPC-UA/Modbus n'existe dans le code. L'ingestion se fait uniquement via CSV batch ou données synthétiques générées en interne. |
| 1.2 | **Importer des fichiers CSV** par lots (journaliers/horaires) pour charger historiques | ✅ Développé | [batch_csv_loader.py](file:///c:/Users/echre/OneDrive/Bureau/1/ingestion/batch_csv_loader.py) — loader complet avec validation des headers, staging table, insertion des lignes valides, export des rejections en JSONL, support source_type et batch_date. |
| 1.3 | Voir le **statut de toutes les sources de données** (connecté, en retard, erreur) sur un tableau de bord | ⚠️ Partiellement développé | Le backend expose [listDataQualitySummary()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1540-1590) et [listDataQualityIssues()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1591-1639) dans [store.js](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#L1540-L1638), plus [getPlatformHealthSummary()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1765-1803). **Mais** aucune UI frontend n'affiche ces données — le Dashboard est statique avec des KPIs mockés. |
| 1.4 | Recevoir une **alerte (email/notification)** quand une source s'arrête ou envoie des données incorrectes | ⚠️ Partiellement développé | La table `alerts` existe dans le schéma avec champs `emailSent`/`smsSent`. L'API backend a [getUnreadAlerts()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1130-1134) et [markAlertAsRead()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1135-1147). **Mais** aucun service d'envoi d'email/SMS n'est implémenté — les flags restent à `false`. |

---

## Epic 2 — Visualisation temps réel

| # | User Story | Statut | Justification |
|---|-----------|--------|---------------|
| 2.1 | Visualiser la consommation en **temps réel (kWh, kVA, cosφ, THD)** avec graphiques fluides | ⚠️ Partiellement développé | Le schéma `measurements` stocke kWh, kVA, cosφ, THD. Le backend a [listMachineLiveSnapshot()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1148-1200) et [listEnergyTimeline()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1398-1407). **Mais** pas de WebSocket/SSE pour le temps réel, et le frontend n'affiche aucun graphique — que des KPIs statiques. |
| 2.2 | Voir la **corrélation consommation/production** (OEE, pièces, tonnage) sur le même graphique | ⚠️ Partiellement développé | Les données OEE, outputPieces, outputTonnage sont stockées avec chaque mesure. L'API [listEnergyTimeline()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1398-1407) retourne les séries temporelles. **Mais** aucun graphique de corrélation n'est implémenté côté frontend. |
| 2.3 | Mode **"vue machine"** avec toutes les données (énergie + production + anomalies) | ⚠️ Partiellement développé | L'API backend fournit [listMachineLiveSnapshot()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1148-1200) par machine avec énergie, anomalies, EnPI. **Mais** aucun écran dédié "vue machine" n'existe dans le frontend. |
| 2.4 | **Alertes visuelles et sonores** quand anomalie détectée ou EnPI dépasse le seuil | ⚠️ Partiellement développé | Le backend crée des alertes avec sévérité (info/warning/critical). La table `alerts` et l'API [getUnreadAlerts()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1130-1134) existent. **Mais** aucune alerte visuelle/sonore n'est implémentée dans le frontend. |

---

## Epic 3 — Détection IA (pas d'epic 3 explicite, intégré dans les epics)

---

## Epic 4 — Intelligence artificielle et détection d'anomalies

| # | User Story | Statut | Justification |
|---|-----------|--------|---------------|
| 4.1 | Détection **automatique des anomalies** électriques et productives en temps réel | ✅ Développé | Pipeline ML complet : [serve_anomaly_inference.py](file:///c:/Users/echre/OneDrive/Bureau/1/ml_pipeline/serve_anomaly_inference.py) avec modèles LSTM et Transformer. [benchmark_sequential_anomaly_torch.py](file:///c:/Users/echre/OneDrive/Bureau/1/ml_pipeline/benchmark_sequential_anomaly_torch.py) pour validation. Le backend appelle l'inférence via `runAnomalyInference()`. |
| 4.2 | Voir le **score de confiance** de chaque anomalie | ✅ Développé | La table `anomalies` a un champ `confidence` (0-1). Le modèle d'inférence retourne un score de confiance. Le backend stocke et expose cette donnée. |
| 4.3 | **Prédiction de consommation optimale** par machine en fonction OEE/état production | ⚠️ Partiellement développé | Les calculs EnPI dans [energy_calculations.ts](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts) incluent la méthode regression ([calculateEnPIRegression](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts#38-58)) qui modélise la consommation attendue. **Mais** il n'y a pas de modèle ML de prévision dédié (forecast) — la "prédiction" est basée sur la régression statistique, pas sur un modèle prédictif. |
| 4.4 | **Recommandations concrètes et priorisées** (ex: maintenance machine X) | ✅ Développé | [recommendation_expert_system.py](file:///c:/Users/echre/OneDrive/Bureau/1/ml_pipeline/recommendation_expert_system.py) avec 4 règles (cosφ bas, THD élevé, OEE drop + kWh élevé, anomalie labellisée). Recommandations avec sévérité et actions concrètes. Table `recommendations` avec priorité et lien PDCA. |
| 4.5 | **EnPI actuel** par machine, ligne et site en temps réel | ⚠️ Partiellement développé | [getEnpiCurrentSnapshot()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2297-2390) dans le backend retourne l'EnPI par machine avec normalisation. **Mais** pas d'agrégation par "ligne" et l'agrégation par site est limitée à [listSiteComparison()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1250-1298). Le frontend n'affiche pas ces données dynamiquement. |
| 4.6 | **Comparer EnPI actuel avec baseline (EnB)** automatiquement | ✅ Développé | [energy_calculations.ts](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts) : [calculateEnPIDeviation()](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts#78-92) et [calculateCompleteEnPI()](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts#120-170) comparent EnPI courant vs baseline. [getEnbBaselineSnapshot()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2262-2296) dans le backend. Table `energyPerformanceIndicators` avec `enpiDeviation`. |
| 4.7 | **Normalisation automatique des EnPI** (production, température, OEE) | ✅ Développé | [normalizeEnPI()](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts#59-77) et [calculateNormalizationFactors()](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts#289-305) dans [energy_calculations.ts](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts). Table `energyBaselines` avec `normalizationFactors`. Le backend applique la normalisation via [normalizeFactorsProduct()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2220-2235) et [computeRegressionEnpi()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2236-2261). |
| 4.8 | **Visualiser l'évolution EnPI** sur période choisie avec baseline en arrière-plan | ⚠️ Partiellement développé | L'API `getEnPIHistory()` retourne l'historique EnPI par machine et période. [getEnbBaselineSnapshot()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2262-2296) fournit la baseline. **Mais** aucun graphique frontend ne visualise cette évolution. |

---

## Epic 5 — Cycle PDCA

| # | User Story | Statut | Justification |
|---|-----------|--------|---------------|
| 5.1 | **Créer et suivre un plan d'action** énergétique (objectifs, cibles EnPI, actions) | ✅ Développé | Table `pdcaCycles` complète avec `planObjective`, `planTargetEnpi`, `planActions`. API [createPdcaCycle()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2155-2179), [updatePdcaCycle()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2180-2201), [listPdcaCycles()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2145-2149). |
| 5.2 | **Passer de Plan à Do** automatiquement à la validation | ✅ Développé | [transitionPdcaCycle()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2401-2479) dans [store.js](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#L2401-L2478) avec [getPdcaAllowedTransition()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2391-2400) qui vérifie les transitions valides. Gouvernance tracée. |
| 5.3 | Voir **l'état PDCA** (Plan/Do/Check/Act) par objectif sur un seul écran | ⚠️ Partiellement développé | Backend [getPdcaStatus()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2480-2512) retourne l'état complet. Le frontend [PDCAManagement.tsx](file:///c:/Users/echre/OneDrive/Bureau/1/PDCAManagement.tsx) affiche les cycles **mais avec des données statiques/mockées**. |
| 5.4 | Passage automatique en **phase Check** quand EnPI sont calculés vs baseline | ⚠️ Partiellement développé | La logique de transition existe dans [transitionPdcaCycle()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2401-2479) mais le passage Check n'est **pas déclenché automatiquement** par le calcul EnPI. C'est une transition manuelle via API. |
| 5.5 | **Synthèse Check** (EnPI actuel vs baseline + réduction) | ✅ Développé | [evaluatePDCACheck()](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts#214-235) dans [energy_calculations.ts](file:///c:/Users/echre/OneDrive/Bureau/1/energy_calculations.ts) compare target vs achieved et calcule `improvementPercent`. Table `pdcaCycles` stocke `checkEnpiAchieved` et `checkImprovementProof`. |
| 5.6 | Passer en **phase Act** à la validation d'une action corrective | ✅ Développé | [transitionPdcaCycle()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2401-2479) gère la transition Check→Act. [closePdcaCycle()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2202-2219) clôture le cycle. |
| 5.7 | **Traçabilité des transitions PDCA** (date, utilisateur, raison) | ✅ Développé | Champ `auditTrail` (JSON) dans la table `pdcaCycles`. [addGovernanceEvent()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2119-2133) enregistre chaque action avec who/what/when/why. |
| 5.8 | **Lier recommandation IA → action PDCA** | ✅ Développé | Table `recommendations` avec champ `pdcaCycleId`. [createRecommendationFromAnomaly()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#1345-1397) lie anomalie→recommandation. La table permet le lien direct recommandation→PDCA. |

---

## Epic 6 — Rapports et conformité ISO 50001

| # | User Story | Statut | Justification |
|---|-----------|--------|---------------|
| 6.1 | **Rapport complet EnPI/EnB/réduction** en un clic | ✅ Développé | [audit_export.ts](file:///c:/Users/echre/OneDrive/Bureau/1/audit_export.ts) : [generateAuditReport()](file:///c:/Users/echre/OneDrive/Bureau/1/audit_export.ts#40-84) produit un rapport complet avec EnPI, baseline, improvement proof, PDCA, anomalies. |
| 6.2 | **Choisir période et périmètre** (machine, ligne, site) avant génération | ⚠️ Partiellement développé | [generateAuditReport()](file:///c:/Users/echre/OneDrive/Bureau/1/audit_export.ts#40-84) prend un `machineId` et les mesures filtrées. **Mais** le périmètre est limité à la machine — pas de sélection par ligne ou site. |
| 6.3 | **Rapport conformité ISO 50001** (clauses 9.1, 10.2...) avec preuves | ✅ Développé | [listAuditMatrix()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2593-2597), [listAuditEvidenceByClause()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2598-2602) dans le backend. [AuditCenter.tsx](file:///c:/Users/echre/OneDrive/Bureau/1/AuditCenter.tsx) affiche une matrice clause→preuve→statut. Reports ISO dans [reports/](file:///c:/Users/echre/OneDrive/Bureau/1/reports/) incluent [iso50001_evidence_manifest.json](file:///c:/Users/echre/OneDrive/Bureau/1/reports/iso50001_evidence_manifest.json) et [iso50001_closure_summary.json](file:///c:/Users/echre/OneDrive/Bureau/1/reports/iso50001_closure_summary.json). |
| 6.4 | Rapport contient **graphiques EnPI, PDCA, anomalies, recommandations IA** | ✅ Développé | [generatePDFContent()](file:///c:/Users/echre/OneDrive/Bureau/1/audit_export.ts#85-248) génère un HTML complet avec sections EnPI, PDCA cycle, anomalies, recommandations IA, audit trail. |
| 6.5 | **Export PDF ou Excel** avec logo entreprise et mise en page pro | ⚠️ Partiellement développé | [generatePDFContent()](file:///c:/Users/echre/OneDrive/Bureau/1/audit_export.ts#85-248) (HTML→PDF) et [generateExcelContent()](file:///c:/Users/echre/OneDrive/Bureau/1/audit_export.ts#249-305) (CSV) existent. **Mais** pas de logo d'entreprise intégré, et la génération PDF réelle (conversion HTML→PDF) n'est pas câblée (pas de bibliothèque comme puppeteer/wkhtmltopdf). |
| 6.6 | **Historique des rapports** générés précédemment | ✅ Développé | [listPreAuditExports()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2705-2709) retourne l'historique des exports pré-audit. Backend stocke chaque export avec date et métadonnées. |
| 6.7 | **Accès lecture seule auditeur** aux rapports et traçabilité | ✅ Développé | RBAC complet dans [auth_rbac.ts](file:///c:/Users/echre/OneDrive/Bureau/1/auth_rbac.ts) : rôle `AUDITEUR` avec accès restreint. `canWriteEndpoint()` vérifie les permissions. Le frontend désactive les boutons sensibles pour les auditeurs. |
| 6.8 | **Bundle de preuves complet** (matrice ISO + logs + rapports) en un clic | ✅ Développé | [generatePreAuditExport()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2670-2704) crée un bundle avec matrice, logs, et exports. API exposée dans le backend avec bouton frontend "Générer export pré-audit". |
| 6.9 | **Mise à jour auto de la matrice ISO 50001** à chaque action/calcul | ❌ Non développé | La matrice d'audit ([listAuditMatrix()](file:///c:/Users/echre/OneDrive/Bureau/1/backend/core/store.js#2593-2597)) est statique dans le store. Aucun mécanisme automatique ne met à jour la matrice quand un EnPI est calculé ou une action PDCA est complétée. |

---

## Synthèse globale

| Statut | Nombre | % |
|--------|--------|---|
| ✅ Développé | 15 | 48% |
| ⚠️ Partiellement développé | 13 | 42% |
| ❌ Non développé | 3 | 10% |

### Points forts de la plateforme
- **Modèle de données complet** : schéma ISO 50001 exhaustif (machines, mesures, EnB, EnPI, PDCA, anomalies, recommandations, alertes, audit logs)
- **Backend API riche** : ~70 fonctions dans le store couvrant tout le périmètre fonctionnel
- **Pipeline ML opérationnel** : LSTM + Transformer pour anomaly detection, expert system pour recommandations
- **PDCA avec gouvernance** : transitions PDCA avec traçabilité who/what/when/why
- **RBAC solide** : 4 rôles avec séparation lecture/écriture et write exceptions

### Lacunes critiques à combler

> [!CAUTION]
> **3 user stories entièrement non développées :**
> 1. **OPC-UA / Modbus** — aucun connecteur industriel
> 2. **Mise à jour auto matrice ISO** — la matrice est statique
> 3. **Email/SMS (envoi réel)** — les flags existent mais aucun service d'envoi

> [!WARNING]
> **Le frontend est le maillon faible** : la grande majorité des APIs backend existent mais le frontend ne les consomme pas. Les vues sont principalement des maquettes statiques avec des données mockées. Les 13 user stories "partiellement développées" partagent presque toutes ce problème.
