# EnMS ISO 50001 — Runbook local d'exploitation

## Démarrage rapide
- Backend: `node backend/http_main_server.js`
- Smoke complète: `node backend/tests/smoke_http_e2e_runner.js`
- Stack observabilité (Mosquitto + Timescale + Influx + Grafana): `docker compose up -d`
- Grafana: `http://localhost:3000` (`admin` / `admin`)
- Ingestion Python (batch CSV):
  - installer dépendances: `pip install -r ingestion/requirements.txt`
  - exécuter: `python ingestion/batch_csv_loader.py --csv data/raw/synthetic_measurements.csv --source-name synthetic_daily_batch --source-type synthetic_batch --batch-date 2026-04-05`

## Variables d'environnement clés
- `INGESTION_INTEGRATION_MODE` = `json_only` | `parallel_fallback_json` | `timescale_primary`
- `SYNTHETIC_ONLY_MODE` = `true|false`
- `MEASUREMENTS_RETENTION_DAYS` (défaut 90)
- `TIMESCALE_HOST`, `TIMESCALE_PORT`, `TIMESCALE_DB`, `TIMESCALE_USER`, `TIMESCALE_PASSWORD`, `TIMESCALE_SSL`
- `INFLUX_HOST`, `INFLUX_ORG`, `INFLUX_BUCKET`, `INFLUX_TOKEN`
- `INFLUX_MIRROR_ENABLED`, `INFLUX_RETRY_ENABLED`, `INFLUX_RETRY_MAX_QUEUE`, `INFLUX_RETRY_BATCH_SIZE`

## Endpoints ingestion/qualité
- `GET /api/ingestion/health`
- `GET /api/ingestion/health/events?limit=25`
- `GET /api/ingestion/readiness`
- `POST /api/ingestion/batch/load`
- `POST /api/admin/ingestion/influx/flush` (ADMIN_ENERGIE)
- `GET /api/data-quality/summary`
- `GET /api/data-quality/issues`
- `GET /api/data-quality/rejections`

## Grafana provisionné (ISO runtime)
- Fichiers de provisioning:
  - `configs/grafana/provisioning/datasources/datasources.yml`
  - `configs/grafana/provisioning/dashboards/dashboards.yml`
- Dashboard versionné:
  - `configs/grafana/dashboards/iso50001_operational_runtime.json`
- Panneaux requis inclus:
  - EnPI realtime vs EnB
  - PDCA current status
  - Anomalies + AI score
  - Forecast vs actual
  - EnPI drift alert (24h)

## Modes de fonctionnement
- `json_only`: store local uniquement.
- `parallel_fallback_json`: DB prioritaire quand disponible, fallback JSON conservé.
- `timescale_primary`: readiness stricte (`503`) si Timescale indisponible.

## Rétention et purge
- Migration SQL: `migrations/0003_retention_policy.sql`
- Mesures brutes: rétention 90 jours.
- Agrégats continus (optionnels): vue horaire, rétention 365 jours.
- Vérification post-migration recommandée:
  - jobs Timescale actifs (retention/compression/cagg)
  - bornes temporelles `min(ts)/max(ts)` cohérentes.

## Troubleshooting
- Port 4001 occupé:
  - `Get-NetTCPConnection -LocalPort 4001 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }`
- `node backend/http_main_server.js` retourne code 1 mais service up:
  - vérifier `http://localhost:4001/api/health` avant de conclure à un échec.
- Influx indisponible:
  - le miroir passe en retry queue; surveiller `activity.influxRetry` dans `/api/ingestion/health`.
- Timescale indisponible en `timescale_primary`:
  - `/api/ingestion/readiness` retourne `503` (comportement attendu).

## Procédure de test recommandée
1. Lancer backend.
2. Vérifier `/api/health` puis `/api/ingestion/health`.
3. Jouer un lot CSV via `/api/ingestion/batch/load` ou script Python.
4. Vérifier `/api/data-quality/summary` + `/api/data-quality/issues`.
5. Exécuter smoke: `node backend/tests/smoke_http_e2e_runner.js`.
