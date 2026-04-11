let influxModule = null;
try {
  influxModule = require("@influxdata/influxdb-client");
} catch (_) {
  influxModule = null;
}

const INFLUX_URL = String(process.env.INFLUX_HOST || "http://localhost:8086").trim();
const INFLUX_TOKEN = String(process.env.INFLUX_TOKEN || "").trim();
const INFLUX_ORG = String(process.env.INFLUX_ORG || "enms").trim();
const INFLUX_BUCKET = String(process.env.INFLUX_BUCKET || "measurements").trim();
const INFLUX_MEASUREMENT = String(process.env.INFLUX_MEASUREMENT || "machine_telemetry").trim();
const INFLUX_ENABLED = String(process.env.INFLUX_MIRROR_ENABLED || "true").trim().toLowerCase() !== "false";
const INFLUX_RETRY_ENABLED = String(process.env.INFLUX_RETRY_ENABLED || "true").trim().toLowerCase() !== "false";
const INFLUX_RETRY_MAX_QUEUE = Number(process.env.INFLUX_RETRY_MAX_QUEUE || 5000);
const INFLUX_RETRY_MAX_ATTEMPTS = Number(process.env.INFLUX_RETRY_MAX_ATTEMPTS || 5);
const INFLUX_RETRY_BASE_DELAY_MS = Number(process.env.INFLUX_RETRY_BASE_DELAY_MS || 2000);
const INFLUX_RETRY_FLUSH_INTERVAL_MS = Number(process.env.INFLUX_RETRY_FLUSH_INTERVAL_MS || 5000);
const INFLUX_RETRY_BATCH_SIZE = Number(process.env.INFLUX_RETRY_BATCH_SIZE || 300);

let writeApi = null;
let retryTimer = null;
let queueBusy = false;
const retryQueue = [];

const influxStats = {
  initializedAt: new Date().toISOString(),
  enabled: INFLUX_ENABLED,
  writes: 0,
  pointsWritten: 0,
  pointsRejected: 0,
  pointsQueued: 0,
  pointsDequeued: 0,
  retriedSuccess: 0,
  retriedFailures: 0,
  queueDropped: 0,
  lastQueueFlushAt: null,
  lastQueueFlushResult: null,
  consecutiveFailures: 0,
  lastWriteAt: null,
  lastFailureAt: null,
  lastError: null,
};

function isDriverAvailable() {
  return Boolean(influxModule && influxModule.InfluxDB && influxModule.Point);
}

function hasRequiredConfig() {
  return Boolean(INFLUX_URL && INFLUX_ORG && INFLUX_BUCKET && INFLUX_TOKEN);
}

function canWriteMirror() {
  return INFLUX_ENABLED && isDriverAvailable() && hasRequiredConfig();
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toDateOrNull(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function normalizeRow(row = {}, fallback = {}) {
  const ts = toDateOrNull(row.timestamp || row.ts || row.datetime || row.time);
  const machineId = Number(row.machineId || row.machine_id || fallback.machineId || 0);
  const kWh = toNumberOrNull(row.kWh ?? row.kwh);
  const kVA = toNumberOrNull(row.kVA ?? row.kva);

  if (!ts || !Number.isFinite(machineId) || machineId <= 0 || kWh === null || kVA === null) {
    return { ok: false, error: "invalid_influx_point" };
  }

  return {
    ok: true,
    value: {
      timestamp: ts,
      machineId,
      machineType: String(row.machineType || row.machine_type || fallback.machineType || "unknown"),
      kWh,
      kVA,
      cosPhiVoltage: toNumberOrNull(row.cosPhiVoltage ?? row.cos_phi_voltage),
      cosPhiCurrent: toNumberOrNull(row.cosPhiCurrent ?? row.cos_phi_current),
      thdVoltage: toNumberOrNull(row.thdVoltage ?? row.thd_voltage),
      thdCurrent: toNumberOrNull(row.thdCurrent ?? row.thd_current),
      oee: toNumberOrNull(row.oee),
      production: toNumberOrNull(row.production),
      sourceType: String(row.sourceType || fallback.sourceType || "synthetic_batch").toLowerCase(),
      sourceName: String(row.sourceName || fallback.sourceName || "synthetic_ingestion").trim() || "synthetic_ingestion",
    },
  };
}

function getWriteApi() {
  if (!canWriteMirror()) {
    return null;
  }

  if (writeApi) {
    return writeApi;
  }

  const influx = new influxModule.InfluxDB({ url: INFLUX_URL, token: INFLUX_TOKEN });
  writeApi = influx.getWriteApi(INFLUX_ORG, INFLUX_BUCKET, "ms");
  return writeApi;
}

function buildPoint(row) {
  const point = new influxModule.Point(INFLUX_MEASUREMENT)
    .tag("machine_id", String(row.machineId))
    .tag("machine_type", row.machineType)
    .tag("source_type", row.sourceType)
    .tag("source_name", row.sourceName)
    .floatField("kwh", row.kWh)
    .floatField("kva", row.kVA)
    .timestamp(row.timestamp);

  if (row.cosPhiVoltage !== null) point.floatField("cos_phi_voltage", row.cosPhiVoltage);
  if (row.cosPhiCurrent !== null) point.floatField("cos_phi_current", row.cosPhiCurrent);
  if (row.thdVoltage !== null) point.floatField("thd_voltage", row.thdVoltage);
  if (row.thdCurrent !== null) point.floatField("thd_current", row.thdCurrent);
  if (row.oee !== null) point.floatField("oee", row.oee);
  if (row.production !== null) point.floatField("production", row.production);

  return point;
}

async function writeNormalizedRows(normalizedRows) {
  const api = getWriteApi();
  for (const row of normalizedRows) {
    api.writePoint(buildPoint(row));
  }
  await api.flush();
}

function computeBackoffMs(attempt) {
  const safeAttempt = Math.max(1, Number(attempt) || 1);
  const capped = Math.min(safeAttempt, 8);
  return INFLUX_RETRY_BASE_DELAY_MS * (2 ** (capped - 1));
}

function enqueueRetryRows(normalizedRows, context = {}) {
  if (!INFLUX_RETRY_ENABLED || !Array.isArray(normalizedRows) || normalizedRows.length === 0) {
    return { accepted: 0, dropped: 0, queueSize: retryQueue.length };
  }

  let accepted = 0;
  let dropped = 0;
  const nowTs = Date.now();

  for (const row of normalizedRows) {
    if (retryQueue.length >= INFLUX_RETRY_MAX_QUEUE) {
      retryQueue.shift();
      dropped += 1;
      influxStats.queueDropped += 1;
    }

    retryQueue.push({
      row,
      attempt: 1,
      nextAttemptAt: nowTs + computeBackoffMs(1),
      reason: context.reason || "influx_write_failed",
      sourceType: context.sourceType || row.sourceType || "synthetic_batch",
      sourceName: context.sourceName || row.sourceName || "synthetic_ingestion",
      firstQueuedAt: new Date().toISOString(),
      lastError: context.errorMessage || null,
    });
    accepted += 1;
  }

  influxStats.pointsQueued += accepted;
  return { accepted, dropped, queueSize: retryQueue.length };
}

function extractDueQueueItems(maxItems, force = false) {
  if (retryQueue.length === 0) {
    return [];
  }

  const nowTs = Date.now();
  const selectedIndexes = [];
  for (let index = 0; index < retryQueue.length && selectedIndexes.length < maxItems; index += 1) {
    const item = retryQueue[index];
    if (force || item.nextAttemptAt <= nowTs) {
      selectedIndexes.push(index);
    }
  }

  if (selectedIndexes.length === 0) {
    return [];
  }

  const picked = [];
  for (let offset = selectedIndexes.length - 1; offset >= 0; offset -= 1) {
    const queueIndex = selectedIndexes[offset];
    const [item] = retryQueue.splice(queueIndex, 1);
    if (item) {
      picked.push(item);
    }
  }

  return picked.reverse();
}

async function flushRetryQueue(options = {}) {
  const force = Boolean(options.force);
  const maxItems = Math.max(1, Math.min(Number(options.maxItems || INFLUX_RETRY_BATCH_SIZE), INFLUX_RETRY_MAX_QUEUE));

  if (!INFLUX_RETRY_ENABLED) {
    return {
      ok: false,
      skipped: true,
      reason: "retry_disabled",
      queueSize: retryQueue.length,
    };
  }

  if (queueBusy) {
    return {
      ok: true,
      skipped: true,
      reason: "queue_busy",
      queueSize: retryQueue.length,
    };
  }

  const dueItems = extractDueQueueItems(maxItems, force);
  if (dueItems.length === 0) {
    influxStats.lastQueueFlushAt = new Date().toISOString();
    influxStats.lastQueueFlushResult = "noop";
    return {
      ok: true,
      flushed: 0,
      requeued: 0,
      dropped: 0,
      queueSize: retryQueue.length,
    };
  }

  queueBusy = true;
  let flushed = 0;
  let requeued = 0;
  let dropped = 0;

  try {
    for (const item of dueItems) {
      try {
        await writeNormalizedRows([item.row]);
        flushed += 1;
        influxStats.retriedSuccess += 1;
        influxStats.pointsDequeued += 1;
      } catch (error) {
        const nextAttempt = Number(item.attempt || 0) + 1;
        if (nextAttempt > INFLUX_RETRY_MAX_ATTEMPTS) {
          dropped += 1;
          influxStats.queueDropped += 1;
          influxStats.retriedFailures += 1;
          influxStats.lastFailureAt = new Date().toISOString();
          influxStats.lastError = error instanceof Error ? error.message : String(error);
          continue;
        }

        item.attempt = nextAttempt;
        item.nextAttemptAt = Date.now() + computeBackoffMs(nextAttempt);
        item.lastError = error instanceof Error ? error.message : String(error);
        retryQueue.push(item);
        requeued += 1;
      }
    }

    influxStats.lastQueueFlushAt = new Date().toISOString();
    influxStats.lastQueueFlushResult = `flushed:${flushed};requeued:${requeued};dropped:${dropped}`;

    return {
      ok: true,
      flushed,
      requeued,
      dropped,
      queueSize: retryQueue.length,
    };
  } finally {
    queueBusy = false;
  }
}

function startRetryWorker() {
  if (!INFLUX_RETRY_ENABLED || retryTimer) {
    return;
  }

  retryTimer = setInterval(() => {
    flushRetryQueue({ force: false, maxItems: INFLUX_RETRY_BATCH_SIZE }).catch(() => {});
  }, Math.max(1000, INFLUX_RETRY_FLUSH_INTERVAL_MS));

  if (retryTimer && typeof retryTimer.unref === "function") {
    retryTimer.unref();
  }
}

async function writeMirror(rows = [], options = {}) {
  if (!INFLUX_ENABLED) {
    return {
      ok: false,
      skipped: true,
      error: "influx_mirror_disabled",
      insertedRows: 0,
      rejectedRows: Array.isArray(rows) ? rows.length : 0,
    };
  }

  if (!isDriverAvailable()) {
    influxStats.pointsRejected += Array.isArray(rows) ? rows.length : 0;
    influxStats.consecutiveFailures += 1;
    influxStats.lastFailureAt = new Date().toISOString();
    influxStats.lastError = "influx_driver_unavailable";
    return {
      ok: false,
      error: "influx_driver_unavailable",
      message: "Influx client package is not installed.",
      insertedRows: 0,
      rejectedRows: Array.isArray(rows) ? rows.length : 0,
      queuedRows: 0,
    };
  }

  if (!hasRequiredConfig()) {
    influxStats.pointsRejected += Array.isArray(rows) ? rows.length : 0;
    influxStats.consecutiveFailures += 1;
    influxStats.lastFailureAt = new Date().toISOString();
    influxStats.lastError = "influx_config_missing";
    return {
      ok: false,
      error: "influx_config_missing",
      message: "Missing required Influx configuration.",
      insertedRows: 0,
      rejectedRows: Array.isArray(rows) ? rows.length : 0,
      queuedRows: 0,
    };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      ok: true,
      insertedRows: 0,
      rejectedRows: 0,
      queuedRows: 0,
    };
  }

  const sourceType = String(options.sourceType || "synthetic_batch").toLowerCase();
  const sourceName = String(options.sourceName || "synthetic_ingestion").trim() || "synthetic_ingestion";

  const normalizedRows = [];
  for (const row of rows) {
    const normalized = normalizeRow(row, {
      sourceType,
      sourceName,
      machineId: options.machineId,
    });
    if (normalized.ok) {
      normalizedRows.push(normalized.value);
    }
  }

  const rejectedRows = rows.length - normalizedRows.length;

  if (normalizedRows.length === 0) {
    influxStats.pointsRejected += rejectedRows;
    influxStats.consecutiveFailures += 1;
    influxStats.lastFailureAt = new Date().toISOString();
    influxStats.lastError = "all_points_rejected";
    return {
      ok: false,
      error: "all_points_rejected",
      insertedRows: 0,
      rejectedRows,
      queuedRows: 0,
    };
  }

  try {
    await writeNormalizedRows(normalizedRows);

    influxStats.writes += 1;
    influxStats.pointsWritten += normalizedRows.length;
    influxStats.pointsRejected += rejectedRows;
    influxStats.consecutiveFailures = 0;
    influxStats.lastWriteAt = new Date().toISOString();
    influxStats.lastError = null;

    return {
      ok: true,
      insertedRows: normalizedRows.length,
      rejectedRows,
      queuedRows: 0,
    };
  } catch (error) {
    const queueResult = enqueueRetryRows(normalizedRows, {
      sourceType,
      sourceName,
      reason: "influx_write_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    influxStats.pointsRejected += rows.length;
    influxStats.consecutiveFailures += 1;
    influxStats.lastFailureAt = new Date().toISOString();
    influxStats.lastError = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      error: "influx_write_failed",
      message: error instanceof Error ? error.message : String(error),
      insertedRows: 0,
      rejectedRows: rows.length,
      queuedRows: queueResult.accepted,
      droppedRows: queueResult.dropped,
      queueSize: queueResult.queueSize,
    };
  }
}

async function checkInfluxHealth() {
  if (!INFLUX_ENABLED) {
    return {
      status: "disabled",
      enabled: false,
      reachable: false,
      detail: "influx_mirror_disabled",
    };
  }

  if (!isDriverAvailable()) {
    return {
      status: "degraded",
      enabled: true,
      reachable: false,
      detail: "influx_driver_unavailable",
    };
  }

  if (!hasRequiredConfig()) {
    return {
      status: "degraded",
      enabled: true,
      reachable: false,
      detail: "influx_config_missing",
    };
  }

  const startedAt = Date.now();
  try {
    const healthEndpoint = `${INFLUX_URL.replace(/\/$/, "")}/health`;
    const response = await fetch(healthEndpoint, {
      method: "GET",
      headers: {
        Authorization: `Token ${INFLUX_TOKEN}`,
      },
    });

    if (!response.ok) {
      return {
        status: "degraded",
        enabled: true,
        reachable: false,
        detail: `influx_health_status_${response.status}`,
        latencyMs: Date.now() - startedAt,
      };
    }

    const body = await response.json().catch(() => ({}));
    return {
      status: "healthy",
      enabled: true,
      reachable: true,
      latencyMs: Date.now() - startedAt,
      detail: body?.status || "pass",
    };
  } catch (error) {
    return {
      status: "degraded",
      enabled: true,
      reachable: false,
      detail: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

function getInfluxWriterStats() {
  return {
    ...influxStats,
    enabled: INFLUX_ENABLED,
    driverAvailable: isDriverAvailable(),
    measurement: INFLUX_MEASUREMENT,
    org: INFLUX_ORG,
    bucket: INFLUX_BUCKET,
    hasConfig: hasRequiredConfig(),
    retry: {
      enabled: INFLUX_RETRY_ENABLED,
      queueSize: retryQueue.length,
      queueBusy,
      maxQueue: INFLUX_RETRY_MAX_QUEUE,
      maxAttempts: INFLUX_RETRY_MAX_ATTEMPTS,
      baseDelayMs: INFLUX_RETRY_BASE_DELAY_MS,
      flushIntervalMs: INFLUX_RETRY_FLUSH_INTERVAL_MS,
      batchSize: INFLUX_RETRY_BATCH_SIZE,
    },
  };
}

startRetryWorker();

module.exports = {
  writeMirror,
  checkInfluxHealth,
  getInfluxWriterStats,
  flushRetryQueue,
};
