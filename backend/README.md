# Serveur HTTP principal unique (Tranche 4)

Entrée unique:
- `backend/http_main_server.js`

## Ce que fait ce serveur
- Expose les endpoints `auth`:
  - `POST /api/auth/login`
  - `GET /api/auth/meByToken` (Bearer token requis)
  - `POST /api/auth/logoutByToken`
- Expose une API métier minimale RBAC:
  - `GET /api/machines`
  - `POST /api/machines`
  - `GET /api/alerts/unread`
  - `POST /api/alerts/mark-read`
  - `POST /api/governance/approve-baseline`
  - `POST /api/governance/close-pdca`
  - `POST /api/governance/export-audit`
- Proxifie tout le non-API vers le frontend (`FRONTEND_TARGET`, défaut `http://localhost:5173`).

## Exécution
- `node backend/http_main_server.js`

## Smoke unique (backend + HTTP + E2E navigateur)
- `node backend/tests/smoke_http_e2e_runner.js`
- Étapes incluses:
  - `backend/tests/backend_hardening_contracts_http.test.js`
  - `backend/tests/backend_pagination_contracts_http.test.js`
  - `backend/tests/anomaly_inference_http.test.js`
  - `backend/tests/iso_runtime_http.test.js`
  - `backend/tests/ai_iso_coupling_http.test.js`
  - `backend/tests/grafana_provisioning_contract.test.js`
  - `backend/tests/iso50001_unified_e2e.test.js`
  - `backend/tests/iso50001_compliance_manifest_contract.test.js`
  - `scripts/generate_iso50001_closure_report.js`
  - `backend/tests/iso50001_closure_report_contract.test.js`
  - `scripts/generate_machine_verifiable_evidence_manifest.js`
  - `backend/tests/iso50001_machine_verifiable_evidence_manifest_contract.test.js`
  - `backend/tests/fe_critical_paths_http.test.js`
  - `backend/tests/ingestion_http_e2e.test.js`
  - `backend/tests/e2e_roles_browser.test.js`

Variables utiles:
- `PORT` (défaut `4001`)
- `FRONTEND_TARGET` (défaut `http://localhost:5173`)
- `MAX_JSON_BODY_BYTES` (défaut `1048576`)
- `SYNTHETIC_ONLY_MODE` (`true` par défaut: imports non synthétiques refusés)
- `INGESTION_INTEGRATION_MODE` (`parallel_fallback_json` par défaut)
- `MEASUREMENTS_RETENTION_DAYS` (`90` par défaut)
- `INFLUX_MIRROR_ENABLED` (`true` par défaut, active/désactive l'écriture miroir Influx)
- `INFLUX_MEASUREMENT` (`machine_telemetry` par défaut)
- `INFLUX_RETRY_ENABLED` (`true` par défaut, active la file de retry Influx)
- `INFLUX_RETRY_MAX_QUEUE` (`5000` par défaut)
- `INFLUX_RETRY_MAX_ATTEMPTS` (`5` par défaut)
- `INFLUX_RETRY_BASE_DELAY_MS` (`2000` par défaut)
- `INFLUX_RETRY_FLUSH_INTERVAL_MS` (`5000` par défaut)
- `INFLUX_RETRY_BATCH_SIZE` (`300` par défaut)
- `LEGACY_RESPONSE_MODE_POLICY` (`warn` par défaut, ou `deny` pour couper le mode legacy)
- `LEGACY_RESPONSE_MODE_AUTO_DENY_AT` (ISO-8601, défaut `2026-12-31T23:59:59.000Z`, active automatiquement la coupure legacy à partir de cette date)
- `LEGACY_USAGE_RESET_HISTORY_LIMIT` (défaut `200`, nombre max d'événements de reset conservés)
- `LEGACY_USAGE_RESET_HISTORY_TTL_DAYS` (défaut `365`, rétention temporelle de l'historique de reset)

## Politique données synthétiques (phases 1-6)
- Le backend fonctionne en mode **synthetic-only** pendant la phase de construction IA.
- Les imports réels sont bloqués côté API (`/api/imports/run`) quand `SYNTHETIC_ONLY_MODE=true`.
- Types d'import autorisés: `synthetic_csv`, `synthetic_mqtt`, `synthetic_batch`, `manual`.
- Les marqueurs de données réelles dans `sourceName`/`fileName` sont refusés.

## Stack ingestion hybride (mode parallèle)
- Source de vérité: **TimescaleDB**.
- Série temporelle support: **InfluxDB**.
- Broker: **Mosquitto**.
- Endpoints ingestion:
  - `GET /api/ingestion/health`
  - `GET /api/ingestion/health/events`
  - `GET /api/ingestion/readiness` (strict: `503` si `INGESTION_INTEGRATION_MODE=timescale_primary` et Timescale indisponible)
  - `POST /api/ingestion/batch/load`
- Endpoint admin ingestion:
  - `POST /api/admin/ingestion/influx/flush` (ADMIN_ENERGIE) pour forcer un flush de la file retry Influx.
- Fallback: JSON local (`backend/data/fallback_measurements.json`) en mode parallèle jusqu'au passage de gate.
- Fichiers infra:
  - `docker-compose.yml`
  - `infra/mosquitto/mosquitto.conf`
  - `.env.example`
  - `configs/retention_90d.yml`

## Contrats API backend (sous-lot standardisation)
- Endpoint de gouvernance contrat:
  - `GET /api/contract`
  - expose la version (`data.contractVersion`), la politique de migration (`data.listResponseModes`) et la télémétrie d'usage legacy (`data.telemetry.legacyUsage`)
  - endpoint admin de reset métriques: `POST /api/admin/contract/metrics/reset` (ADMIN_ENERGIE uniquement)
  - endpoint admin read-only de consultation de l'historique de reset: `GET /api/admin/contract/metrics/resets` (ADMIN_ENERGIE uniquement)
  - endpoint admin d'export CSV de l'historique: `GET /api/admin/contract/metrics/resets/export.csv` (ADMIN_ENERGIE uniquement)
- Réponses d'erreur normalisées:
  - format: `{ "error": "code", "message": "texte", "details"?: ... }`
- Réponses de succès listées normalisées:
  - format: `{ "data": [...], "meta": { ... } }`
  - `meta.count` toujours présent
- Réponses de succès non-listes normalisées:
  - format: `{ "data": { ... } | "valeur", "meta": { ... } }`
- Réponses paginées (si `limit` ou `offset` présents):
  - format: `{ "data": [...], "meta": { "total": 123, "count": 50, "limit": 50, "offset": 0, "hasNext": true|false, "hasPrevious": true|false } }`
  - endpoints concernés: incidents, issues qualité data, rejets qualité data, journal imports
  - mode explicite possible: `responseMode=paginated` (même sans `limit/offset`)
  - `responseMode=legacy` est en dépréciation explicite (`Deprecation`, `Sunset`, `meta.deprecation`) tant que la policy = `warn`
  - si `LEGACY_RESPONSE_MODE_POLICY=deny`, le mode `legacy` retourne `410 responseMode_legacy_removed`
  - si la date `LEGACY_RESPONSE_MODE_AUTO_DENY_AT` est dépassée, le mode `legacy` est automatiquement refusé (`410`) même si la policy statique reste `warn`
  - un compteur d'usage legacy par endpoint est maintenu en mémoire et publié via `/api/contract` (utile pour piloter la migration)
  - ce compteur est persisté sur disque dans `backend/data/legacy_usage_metrics.json` et rechargé au redémarrage
  - chaque reset est historisé avec motif/auteur/timestamp, persisté sur disque et consultable via l'endpoint admin read-only
  - l'historique est soumis à une rétention TTL (`LEGACY_USAGE_RESET_HISTORY_TTL_DAYS`) et à une limite de cardinalité (`LEGACY_USAGE_RESET_HISTORY_LIMIT`)

## Persistance
- Store local JSON: `backend/data/runtime_store.json`
- Contient: comptes locaux, sessions persistées, machines, alertes, événements gouvernance.

## RBAC
- Matrice et mapping mutations: `backend/core/rbac.js`
- Contrôle écriture appliqué sur chaque mutation d'écriture exposée.

## Compatibilité
- `backend/auth/auth_http_server.js` reste disponible mais délègue désormais au serveur principal unique.
