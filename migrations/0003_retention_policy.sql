-- 0003_retention_policy.sql
-- Retention policy 90 jours sur mesures brutes + agrégats optionnels.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS energy_measurements_synthetic (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  machine_id INTEGER NOT NULL,
  machine_type TEXT NULL,
  kwh DOUBLE PRECISION NOT NULL,
  kva DOUBLE PRECISION NOT NULL,
  cos_phi_voltage DOUBLE PRECISION NULL,
  cos_phi_current DOUBLE PRECISION NULL,
  thd_voltage DOUBLE PRECISION NULL,
  thd_current DOUBLE PRECISION NULL,
  oee DOUBLE PRECISION NULL,
  production DOUBLE PRECISION NULL,
  source_type TEXT NOT NULL,
  source_name TEXT NOT NULL,
  ingestion_id TEXT NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

SELECT create_hypertable('energy_measurements_synthetic', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_energy_measurements_synthetic_ts
  ON energy_measurements_synthetic(ts DESC);
CREATE INDEX IF NOT EXISTS idx_energy_measurements_synthetic_machine_ts
  ON energy_measurements_synthetic(machine_id, ts DESC);

-- Rétention brute: 90 jours
SELECT add_retention_policy(
  'energy_measurements_synthetic',
  INTERVAL '90 days',
  if_not_exists => TRUE
);

-- Compression recommandée avant purge (améliore coût stockage)
ALTER TABLE energy_measurements_synthetic
  SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'machine_id,source_type,source_name'
  );
SELECT add_compression_policy(
  'energy_measurements_synthetic',
  INTERVAL '7 days',
  if_not_exists => TRUE
);

-- Stratégie historique agrégé (optionnelle): buckets 1h conservés 365 jours
CREATE MATERIALIZED VIEW IF NOT EXISTS energy_measurements_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 hour', ts) AS bucket,
  machine_id,
  AVG(kwh) AS avg_kwh,
  MAX(kwh) AS max_kwh,
  AVG(kva) AS avg_kva,
  MAX(kva) AS max_kva,
  AVG(oee) AS avg_oee,
  COUNT(*)::BIGINT AS points
FROM energy_measurements_synthetic
GROUP BY 1, 2
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'energy_measurements_hourly',
  start_offset => INTERVAL '90 days',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '15 minutes'
);

SELECT add_retention_policy(
  'energy_measurements_hourly',
  INTERVAL '365 days',
  if_not_exists => TRUE
);

-- Vérification rapide de cohérence/purge (à exécuter manuellement après migration)
-- SELECT now() AS executed_at;
-- SELECT policy_name, hypertable_name FROM timescaledb_information.jobs ORDER BY hypertable_name;
-- SELECT min(ts), max(ts), count(*) FROM energy_measurements_synthetic;
