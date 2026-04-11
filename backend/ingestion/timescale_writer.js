const { randomUUID } = require("crypto");

let pgModule = null;
try {
  pgModule = require("pg");
} catch (_) {
  pgModule = null;
}

function sanitizeTableName(rawName) {
  const candidate = String(rawName || "machine_telemetry").trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(candidate)) {
    return "machine_telemetry";
  }
  return candidate;
}

const DEFAULT_TABLE = sanitizeTableName(process.env.TIMESCALE_MEASUREMENTS_TABLE || "machine_telemetry");
const DEFAULT_RETENTION_DAYS = Number(process.env.MEASUREMENTS_RETENTION_DAYS || 90);

let pool = null;
let schemaReady = false;

const ingestionStats = {
  initializedAt: new Date().toISOString(),
  totalWrites: 0,
  totalRowsWritten: 0,
  totalRowsRejected: 0,
  consecutiveFailures: 0,
  lastWriteAt: null,
  lastFailureAt: null,
  lastError: null,
};

function buildConnectionConfig() {
  return {
    host: process.env.TIMESCALE_HOST || "localhost",
    port: Number(process.env.TIMESCALE_PORT || 5432),
    database: process.env.TIMESCALE_DB || "enms",
    user: process.env.TIMESCALE_USER || "enms",
    password: process.env.TIMESCALE_PASSWORD || "enms",
    ssl: String(process.env.TIMESCALE_SSL || "false").toLowerCase() === "true"
      ? { rejectUnauthorized: false }
      : false,
    max: Number(process.env.TIMESCALE_POOL_MAX || 6),
    idleTimeoutMillis: Number(process.env.TIMESCALE_IDLE_TIMEOUT_MS || 15000),
    connectionTimeoutMillis: Number(process.env.TIMESCALE_CONNECT_TIMEOUT_MS || 4000),
  };
}

function isDriverAvailable() {
  return Boolean(pgModule && pgModule.Pool);
}

function getPool() {
  if (!isDriverAvailable()) {
    return null;
  }

  if (!pool) {
    const { Pool } = pgModule;
    pool = new Pool(buildConnectionConfig());
  }

  return pool;
}

function toTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeMeasurement(row = {}, fallback = {}) {
  const timestamp = toTimestamp(row.timestamp || row.ts || row.datetime || row.time);
  const machineIdRaw = row.machine_id ?? row.machineId ?? fallback.machineId;
  const machineId = String(machineIdRaw ?? "").trim();

  const kWh = toNumberOrNull(row.kwh ?? row.kWh);
  const kVA = toNumberOrNull(row.kva ?? row.kVA);

  const cosPhi = toNumberOrNull(row.cos_phi ?? row.cosPhi ?? row.cosPhiVoltage ?? row.cos_phi_voltage ?? row.cosPhiCurrent ?? row.cos_phi_current);
  const thdV = toNumberOrNull(row.thd_v ?? row.thdVoltage ?? row.thd_voltage);
  const thdI = toNumberOrNull(row.thd_i ?? row.thdCurrent ?? row.thd_current);

  const harm3 = toNumberOrNull(row.harm_3 ?? row.harm3);
  const harm5 = toNumberOrNull(row.harm_5 ?? row.harm5);
  const harm7 = toNumberOrNull(row.harm_7 ?? row.harm7);

  const outputPieces = toNumberOrNull(row.output_pieces ?? row.outputPieces ?? row.production);
  const outputTonnage = toNumberOrNull(row.output_tonnage ?? row.outputTonnage ?? row.production);

  const etatRaw = row.etat ?? row.machineState ?? row.machine_state;
  let etat = null;
  if (typeof etatRaw === "string") {
    const state = etatRaw.trim().toLowerCase();
    if (state === "running" || state === "run" || state === "marche") {
      etat = 1;
    } else if (state === "idle") {
      etat = 2;
    } else if (state === "stopped" || state === "stop" || state === "arret" || state === "arrêt") {
      etat = 0;
    }
  }
  if (etat === null) {
    const numericEtat = Number(etatRaw);
    if (Number.isFinite(numericEtat)) {
      etat = Math.max(0, Math.min(2, Math.round(numericEtat)));
    }
  }

  const oeeCandidate = toNumberOrNull(row.oee);
  const oee = oeeCandidate === null ? null : (oeeCandidate <= 1 ? oeeCandidate * 100 : oeeCandidate);

  const anomalyRaw = row.label_anomalie ?? row.labelAnomalie ?? row.isAnomaly ?? row.is_anomaly;
  let labelAnomalie = 0;
  if (typeof anomalyRaw === "boolean") {
    labelAnomalie = anomalyRaw ? 1 : 0;
  } else if (typeof anomalyRaw === "string") {
    const normalized = anomalyRaw.trim().toLowerCase();
    labelAnomalie = ["1", "true", "yes", "y"].includes(normalized) ? 1 : 0;
  } else {
    const numeric = Number(anomalyRaw);
    labelAnomalie = Number.isFinite(numeric) && numeric > 0 ? 1 : 0;
  }

  if (!timestamp || !machineId || kWh === null || kVA === null) {
    return {
      ok: false,
      error: "invalid_measurement_row",
      details: {
        timestamp: row.timestamp,
        machineId: row.machineId,
        kWh: row.kWh,
        kVA: row.kVA,
      },
    };
  }

  return {
    ok: true,
    value: {
      timestamp,
      machineId,
      kWh,
      kVA,
      cosPhi: cosPhi === null ? 0.95 : Math.max(0, Math.min(1, cosPhi)),
      thdV: thdV === null ? 0 : Math.max(0, thdV),
      thdI: thdI === null ? 0 : Math.max(0, thdI),
      harm3: harm3 === null ? Math.max(0, ((thdV === null ? 0 : thdV) * 0.45)) : Math.max(0, harm3),
      harm5: harm5 === null ? Math.max(0, ((thdV === null ? 0 : thdV) * 0.30)) : Math.max(0, harm5),
      harm7: harm7 === null ? Math.max(0, ((thdV === null ? 0 : thdV) * 0.20)) : Math.max(0, harm7),
      outputPieces: outputPieces === null ? 0 : Math.max(0, Math.round(outputPieces)),
      outputTonnage: outputTonnage === null ? 0 : Math.max(0, outputTonnage),
      etat: etat === null ? 1 : etat,
      oee: oee === null ? 0 : Math.max(0, Math.min(100, oee)),
      labelAnomalie,
      sourceType: String(row.sourceType || fallback.sourceType || "synthetic_batch").toLowerCase(),
      sourceName: String(row.sourceName || fallback.sourceName || "synthetic_ingestion").trim() || "synthetic_ingestion",
    },
  };
}

async function ensureSchema(client) {
  if (schemaReady) {
    return;
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS ${DEFAULT_TABLE} (
      timestamp TIMESTAMPTZ NOT NULL,
      machine_id TEXT NOT NULL,
      kwh DOUBLE PRECISION NOT NULL,
      kva DOUBLE PRECISION NOT NULL,
      cos_phi DOUBLE PRECISION NOT NULL,
      thd_v DOUBLE PRECISION NOT NULL,
      thd_i DOUBLE PRECISION NOT NULL,
      harm_3 DOUBLE PRECISION NOT NULL,
      harm_5 DOUBLE PRECISION NOT NULL,
      harm_7 DOUBLE PRECISION NOT NULL,
      output_pieces INTEGER NOT NULL,
      output_tonnage DOUBLE PRECISION NOT NULL,
      etat INTEGER NOT NULL,
      oee DOUBLE PRECISION NOT NULL,
      label_anomalie INTEGER NOT NULL,
      CHECK (etat IN (0,1,2)),
      CHECK (label_anomalie IN (0,1)),
      CHECK (oee >= 0 AND oee <= 100)
    );
    CREATE INDEX IF NOT EXISTS idx_${DEFAULT_TABLE}_timestamp ON ${DEFAULT_TABLE}(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_${DEFAULT_TABLE}_machine_timestamp ON ${DEFAULT_TABLE}(machine_id, timestamp DESC);
  `);

  try {
    await client.query("SELECT create_hypertable($1, 'timestamp', if_not_exists => TRUE)", [DEFAULT_TABLE]);
  } catch (_) {
  }

  if (Number.isFinite(DEFAULT_RETENTION_DAYS) && DEFAULT_RETENTION_DAYS > 0) {
    try {
      await client.query("SELECT add_retention_policy($1, ($2 || ' days')::interval, if_not_exists => TRUE)", [
        DEFAULT_TABLE,
        String(DEFAULT_RETENTION_DAYS),
      ]);
    } catch (_) {
    }
  }

  schemaReady = true;
}

function buildInsertQuery(rows, ingestionId) {
  void ingestionId;
  const values = [];
  const placeholders = rows.map((row, rowIndex) => {
    const base = rowIndex * 15;
    values.push(
      row.timestamp,
      row.machineId,
      row.kWh,
      row.kVA,
      row.cosPhi,
      row.thdV,
      row.thdI,
      row.harm3,
      row.harm5,
      row.harm7,
      row.outputPieces,
      row.outputTonnage,
      row.etat,
      row.oee,
      row.labelAnomalie,
    );

    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15})`;
  });

  const sql = `
    INSERT INTO ${DEFAULT_TABLE} (
      timestamp,
      machine_id,
      kwh,
      kva,
      cos_phi,
      thd_v,
      thd_i,
      harm_3,
      harm_5,
      harm_7,
      output_pieces,
      output_tonnage,
      etat,
      oee,
      label_anomalie
    ) VALUES ${placeholders.join(",")}
  `;

  return { sql, values };
}

async function writeMeasurements(rows = [], options = {}) {
  const sourceType = String(options.sourceType || "synthetic_batch").toLowerCase();
  const sourceName = String(options.sourceName || "synthetic_ingestion").trim() || "synthetic_ingestion";
  const ingestionId = String(options.ingestionId || randomUUID());

  if (!isDriverAvailable()) {
    const error = "timescale_driver_unavailable";
    ingestionStats.totalRowsRejected += Array.isArray(rows) ? rows.length : 0;
    ingestionStats.lastFailureAt = new Date().toISOString();
    ingestionStats.lastError = error;
    ingestionStats.consecutiveFailures += 1;
    return {
      ok: false,
      error,
      message: "PostgreSQL driver 'pg' is not installed.",
      insertedRows: 0,
      rejectedRows: Array.isArray(rows) ? rows.length : 0,
    };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ok: true,
      insertedRows: 0,
      rejectedRows: 0,
      ingestionId,
      sourceType,
      sourceName,
    };
  }

  const normalizedRows = [];
  const rejectedRows = [];

  for (const row of rows) {
    const normalized = normalizeMeasurement(row, { sourceType, sourceName, machineId: options.machineId });
    if (!normalized.ok) {
      rejectedRows.push(normalized);
      continue;
    }
    normalizedRows.push(normalized.value);
  }

  if (normalizedRows.length === 0) {
    ingestionStats.totalRowsRejected += rejectedRows.length;
    ingestionStats.consecutiveFailures += 1;
    ingestionStats.lastFailureAt = new Date().toISOString();
    ingestionStats.lastError = "all_rows_rejected";

    return {
      ok: false,
      error: "all_rows_rejected",
      message: "No valid measurement row could be written to TimescaleDB.",
      insertedRows: 0,
      rejectedRows: rejectedRows.length,
      rejectionSamples: rejectedRows.slice(0, 5),
    };
  }

  const dbPool = getPool();
  let client = null;

  try {
    client = await dbPool.connect();
  } catch (error) {
    ingestionStats.totalRowsRejected += rows.length;
    ingestionStats.consecutiveFailures += 1;
    ingestionStats.lastFailureAt = new Date().toISOString();
    ingestionStats.lastError = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      error: "timescale_connection_failed",
      message: error instanceof Error ? error.message : String(error),
      insertedRows: 0,
      rejectedRows: rows.length,
    };
  }

  let insertedRows = 0;

  try {
    await client.query("BEGIN");
    await ensureSchema(client);

    const chunkSize = Number(process.env.TIMESCALE_INSERT_CHUNK_SIZE || 500);
    for (let index = 0; index < normalizedRows.length; index += chunkSize) {
      const chunk = normalizedRows.slice(index, index + chunkSize);
      const query = buildInsertQuery(chunk, ingestionId);
      await client.query(query.sql, query.values);
      insertedRows += chunk.length;
    }

    await client.query("COMMIT");

    ingestionStats.totalWrites += 1;
    ingestionStats.totalRowsWritten += insertedRows;
    ingestionStats.totalRowsRejected += rejectedRows.length;
    ingestionStats.consecutiveFailures = 0;
    ingestionStats.lastWriteAt = new Date().toISOString();
    ingestionStats.lastError = null;

    return {
      ok: true,
      ingestionId,
      sourceType,
      sourceName,
      insertedRows,
      rejectedRows: rejectedRows.length,
      rejectionSamples: rejectedRows.slice(0, 5),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    ingestionStats.totalRowsRejected += rows.length;
    ingestionStats.consecutiveFailures += 1;
    ingestionStats.lastFailureAt = new Date().toISOString();
    ingestionStats.lastError = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      error: "timescale_write_failed",
      message: error instanceof Error ? error.message : String(error),
      insertedRows: 0,
      rejectedRows: rows.length,
    };
  } finally {
    if (client) {
      client.release();
    }
  }
}

async function checkTimescaleHealth() {
  if (!isDriverAvailable()) {
    return {
      status: "degraded",
      detail: "pg_driver_missing",
      reachable: false,
      table: DEFAULT_TABLE,
    };
  }

  const dbPool = getPool();
  const startedAt = Date.now();

  try {
    const result = await dbPool.query("SELECT NOW() AS now_utc, current_database() AS database_name");
    const row = result.rows && result.rows[0] ? result.rows[0] : {};
    return {
      status: "healthy",
      reachable: true,
      latencyMs: Date.now() - startedAt,
      table: DEFAULT_TABLE,
      database: row.database_name || null,
      serverTime: row.now_utc || null,
    };
  } catch (error) {
    return {
      status: "degraded",
      reachable: false,
      detail: error instanceof Error ? error.message : String(error),
      table: DEFAULT_TABLE,
      latencyMs: Date.now() - startedAt,
    };
  }
}

function getWriterStats() {
  return {
    ...ingestionStats,
    table: DEFAULT_TABLE,
    retentionDays: DEFAULT_RETENTION_DAYS,
    driverAvailable: isDriverAvailable(),
  };
}

module.exports = {
  writeMeasurements,
  checkTimescaleHealth,
  getWriterStats,
  isDriverAvailable,
};
