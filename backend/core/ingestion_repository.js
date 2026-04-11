const { getIntegrationMode } = require("./storage_router");
const { listMachines } = require("./store");

let pgModule = null;
try {
  pgModule = require("pg");
} catch (_) {
  pgModule = null;
}

const TIMESCALE_TABLE = String(process.env.TIMESCALE_MEASUREMENTS_TABLE || "machine_telemetry").trim();

let pool = null;
let tableFlavorCache = null;

function isDbAvailable() {
  return Boolean(pgModule && pgModule.Pool);
}

function isParallelModeEnabled() {
  return getIntegrationMode() !== "json_only";
}

function getPool() {
  if (!isDbAvailable()) {
    return null;
  }

  if (!pool) {
    const { Pool } = pgModule;
    pool = new Pool({
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
    });
  }

  return pool;
}

function getMachineMap() {
  const machineMap = new Map();
  for (const machine of listMachines()) {
    machineMap.set(Number(machine.id), machine);
  }
  return machineMap;
}

async function runQuery(sql, params = []) {
  if (!isParallelModeEnabled() || !isDbAvailable()) {
    return null;
  }

  const dbPool = getPool();
  try {
    return await dbPool.query(sql, params);
  } catch (_) {
    return null;
  }
}

async function resolveTableFlavor() {
  if (tableFlavorCache) {
    return tableFlavorCache;
  }

  const result = await runQuery(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    `,
    [TIMESCALE_TABLE],
  );

  if (!result || !Array.isArray(result.rows)) {
    tableFlavorCache = "legacy";
    return tableFlavorCache;
  }

  const columns = new Set(result.rows.map(row => String(row.column_name || "").toLowerCase()));
  if (columns.has("timestamp") && columns.has("label_anomalie") && columns.has("etat")) {
    tableFlavorCache = "machine_telemetry";
    return tableFlavorCache;
  }

  tableFlavorCache = "legacy";
  return tableFlavorCache;
}

function toPagedOrArray(items, filters = {}) {
  const limit = Number.isFinite(Number(filters.limit)) ? Math.max(1, Math.min(Number(filters.limit), 500)) : null;
  const offset = Number.isFinite(Number(filters.offset)) ? Math.max(0, Math.min(Number(filters.offset), 100000)) : 0;

  if (!Number.isFinite(limit)) {
    return items;
  }

  const pagedItems = items.slice(offset, offset + limit);
  if (filters.paginationMode === "meta") {
    return {
      items: pagedItems,
      total: items.length,
      count: pagedItems.length,
      limit,
      offset,
      hasNext: offset + pagedItems.length < items.length,
      hasPrevious: offset > 0,
    };
  }

  return pagedItems;
}

async function listDataQualitySummaryFromDb(filters = {}) {
  const siteId = filters.siteId ? String(filters.siteId) : null;
  const machineId = Number(filters.machineId || 0);

  const tableFlavor = await resolveTableFlavor();
  const tsColumn = tableFlavor === "machine_telemetry" ? "timestamp" : "ts";
  const sourceNameSelect = tableFlavor === "machine_telemetry"
    ? "NULL::text AS source_name"
    : "MAX(source_name) AS source_name";

  const conditions = [`${tsColumn} >= NOW() - INTERVAL '24 hours'`];
  const params = [];
  if (machineId > 0) {
    params.push(tableFlavor === "machine_telemetry" ? String(machineId) : machineId);
    conditions.push(`machine_id = $${params.length}`);
  }

  const result = await runQuery(
    `
    SELECT
      machine_id,
      COUNT(*)::int AS row_count,
      COUNT(*) FILTER (
        WHERE kwh IS NOT NULL AND kva IS NOT NULL AND kwh >= 0 AND kva >= 0
      )::int AS valid_row_count,
      COUNT(*) FILTER (
        WHERE (kwh < 0 OR kva < 0)
      )::int AS invalid_numeric_count,
      MAX(${tsColumn}) AS collected_at,
      ${sourceNameSelect}
    FROM ${TIMESCALE_TABLE}
    WHERE ${conditions.join(" AND ")}
    GROUP BY machine_id
    ORDER BY machine_id ASC
    `,
    params,
  );

  if (!result) {
    return null;
  }

  const machineMap = getMachineMap();

  const rows = result.rows.map(row => {
    const machine = machineMap.get(Number(row.machine_id));
    const rowCount = Number(row.row_count || 0);
    const validRowCount = Number(row.valid_row_count || 0);
    const invalidNumericCount = Number(row.invalid_numeric_count || 0);
    const qualityScore = rowCount > 0 ? Number(((validRowCount / rowCount) * 100).toFixed(1)) : 0;
    const status = qualityScore >= 98 ? "healthy" : qualityScore >= 90 ? "warning" : "failed";

    return {
      machineId: Number(String(row.machine_id)),
      machineCode: machine?.machineCode || `M-${row.machine_id}`,
      machineName: machine?.machineName || "Machine inconnue",
      siteId: machine?.siteId || null,
      siteName: machine?.siteName || null,
      sourceName: row.source_name || null,
      batchId: null,
      collectedAt: row.collected_at ? new Date(row.collected_at).toISOString() : null,
      rowCount,
      validRowCount,
      missingRatePct: 0,
      typeErrorRatePct: 0,
      duplicateRatePct: 0,
      outlierRatePct: rowCount > 0 ? Number(((invalidNumericCount / rowCount) * 100).toFixed(2)) : 0,
      qualityScore,
      status,
      openIssues: qualityScore >= 98 ? 0 : 1,
      majorIssues: qualityScore < 90 ? 1 : 0,
    };
  });

  return rows
    .filter(item => (siteId ? item.siteId === siteId : true))
    .filter(item => (machineId > 0 ? Number(item.machineId) === machineId : true));
}

async function listDataQualityIssuesFromDb(filters = {}) {
  const summary = await listDataQualitySummaryFromDb(filters);
  if (!summary) {
    return null;
  }

  const statusFilter = filters.status ? String(filters.status) : null;
  const severityFilter = filters.severity ? String(filters.severity) : null;

  const issues = [];
  for (const item of summary) {
    if (item.qualityScore >= 98) {
      continue;
    }

    const severity = item.qualityScore < 90 ? "major" : "minor";
    const issue = {
      id: Number(`${item.machineId}${String(Math.round(item.qualityScore)).padStart(3, "0")}`),
      machineId: item.machineId,
      category: item.qualityScore < 90 ? "import_failure" : "rejected_rows",
      field: "batch",
      severity,
      status: "open",
      description: `Qualité DB calculée: ${item.qualityScore}% sur les 24 dernières heures.`,
      sampleValue: item.sourceName || item.machineCode,
      batchId: `DB-${item.machineId}`,
      detectedAt: item.collectedAt,
      lastSeenAt: item.collectedAt,
      machineCode: item.machineCode,
      machineName: item.machineName,
      siteId: item.siteId,
      siteName: item.siteName,
    };

    issues.push(issue);
  }

  const filtered = issues
    .filter(item => (statusFilter ? item.status === statusFilter : true))
    .filter(item => (severityFilter ? item.severity === severityFilter : true))
    .sort((a, b) => Number(b.id) - Number(a.id));

  return toPagedOrArray(filtered, filters);
}

async function listDataRejectionsFromDb(filters = {}) {
  const issues = await listDataQualityIssuesFromDb({
    ...filters,
    paginationMode: null,
  });

  if (!issues) {
    return null;
  }

  const rejections = issues.map(issue => ({
    ...issue,
    rejectionCount: issue.severity === "major" ? 10 : 3,
    rejectionRatePct: issue.severity === "major" ? 10 : 3,
    recommendation: issue.severity === "major"
      ? "Rejouer l'import après correction des lignes invalides."
      : "Vérifier les lignes rejetées et rejouer le lot.",
  }));

  return toPagedOrArray(rejections, filters);
}

module.exports = {
  isParallelModeEnabled,
  listDataQualitySummaryFromDb,
  listDataQualityIssuesFromDb,
  listDataRejectionsFromDb,
};
