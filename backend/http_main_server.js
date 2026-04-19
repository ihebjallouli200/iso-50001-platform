const http = require("http");
const fs = require("fs");
const path = require("path");
const { getIntegrationMode } = require("./core/storage_router");
const {
  isParallelModeEnabled,
  listDataQualitySummaryFromDb,
  listDataQualityIssuesFromDb,
  listDataRejectionsFromDb,
} = require("./core/ingestion_repository");
const { loadSyntheticCsvBatch } = require("./ingestion/synthetic_batch_loader");
const { writeMeasurements, checkTimescaleHealth, getWriterStats } = require("./ingestion/timescale_writer");
const { writeMirror, checkInfluxHealth, getInfluxWriterStats, flushRetryQueue } = require("./ingestion/influx_writer");
const { pushEvent, getIngestionHealthSnapshot } = require("./ingestion/ingestion_health");
const {
  SYNTHETIC_ONLY_MODE,
  SYNTHETIC_ALLOWED_SOURCE_TYPES,
  validateSyntheticImportPayload,
} = require("./core/synthetic_guard");

const { canRoleExecuteMutation, canWriteEndpoint } = require("./core/rbac");
const {
  login,
  getSessionUser,
  revokeSession,
  listMachines,
  createMachine,
  getUnreadAlerts,
  markAlertAsRead,
  listMachineLiveSnapshot,
  listAnomalies,
  acknowledgeAnomaly,
  createAnomaly,
  listSites,
  listSiteComparison,
  listEnergyTimeline,
  listCauseActionCorrelations,
  listRecommendations,
  createRecommendationFromAnomaly,
  decideRecommendation,
  listRecommendationDecisionHistory,
  getRecommendationAdoptionSummary,
  getRecommendationExplainability,
  listDataQualitySummary,
  listDataQualityIssues,
  listDataRejections,
  resolveDataRejection,
  listTechnicalIncidents,
  acknowledgeTechnicalIncident,
  escalateTechnicalIncident,
  getSloDashboard,
  listImportJournal,
  createImportJournalEntry,
  getPlatformHealthSummary,
  addGovernanceEvent,
  listGovernanceEvents,
  listPdcaCycles,
  getPdcaCycleById,
  createPdcaCycle,
  updatePdcaCycle,
  closePdcaCycle,
  getEnbBaselineSnapshot,
  getEnpiCurrentSnapshot,
  transitionPdcaCycle,
  getPdcaStatus,
  listApprovals,
  decideApproval,
  listDocumentVersions,
  diffDocumentVersions,
  listAuditMatrix,
  listAuditEvidenceByClause,
  getAuditEvidenceById,
  listNonConformities,
  createNonConformity,
  updateCorrectiveAction,
  generatePreAuditExport,
  listPreAuditExports,
  loadStore,
  updateMachineLiveFromMqtt,
} = require("./core/store");
const { runAnomalyInference } = require("./inference/anomaly_inference_client");
const mqttConsumer = require("./ingestion/mqtt_consumer");
const { listModelVersions, activateModelVersion, getActiveModelPointer } = require("./inference/model_version_manager");

const API_PREFIX = "/api";
const API_CONTRACT_VERSION = "2026-04-v1";
const LEGACY_RESPONSE_MODE_SUNSET = "Wed, 31 Dec 2026 23:59:59 GMT";
const LEGACY_RESPONSE_MODE_POLICY = String(process.env.LEGACY_RESPONSE_MODE_POLICY || "warn").trim().toLowerCase();
const LEGACY_RESPONSE_MODE_AUTO_DENY_AT = String(process.env.LEGACY_RESPONSE_MODE_AUTO_DENY_AT || "2026-12-31T23:59:59.000Z").trim();
const LEGACY_USAGE_METRICS_FILE = path.join(__dirname, "data", "legacy_usage_metrics.json");
const LEGACY_USAGE_RESET_HISTORY_LIMIT = Number(process.env.LEGACY_USAGE_RESET_HISTORY_LIMIT || 200);
const LEGACY_USAGE_RESET_HISTORY_TTL_DAYS = Number(process.env.LEGACY_USAGE_RESET_HISTORY_TTL_DAYS || 365);
const MEASUREMENTS_RETENTION_DAYS = Number(process.env.MEASUREMENTS_RETENTION_DAYS || 90);
const FRONTEND_TARGET = process.env.FRONTEND_TARGET || "http://localhost:5173";
const PORT = Number(process.env.PORT || 4001);
const STATIC_DIR = path.join(__dirname, "public");
const SERVER_BOOT_TS = Date.now();
const MAX_JSON_BODY_BYTES = Number(process.env.MAX_JSON_BODY_BYTES || 1024 * 1024);

if (!["warn", "deny"].includes(LEGACY_RESPONSE_MODE_POLICY)) {
  throw new Error("LEGACY_RESPONSE_MODE_POLICY must be 'warn' or 'deny'");
}

const LEGACY_RESPONSE_MODE_AUTO_DENY_TS = Date.parse(LEGACY_RESPONSE_MODE_AUTO_DENY_AT);
if (!Number.isFinite(LEGACY_RESPONSE_MODE_AUTO_DENY_TS)) {
  throw new Error("LEGACY_RESPONSE_MODE_AUTO_DENY_AT must be a valid ISO-8601 date-time");
}

if (!Number.isFinite(LEGACY_USAGE_RESET_HISTORY_TTL_DAYS) || LEGACY_USAGE_RESET_HISTORY_TTL_DAYS < 1) {
  throw new Error("LEGACY_USAGE_RESET_HISTORY_TTL_DAYS must be a number >= 1");
}

if (!Number.isFinite(MEASUREMENTS_RETENTION_DAYS) || MEASUREMENTS_RETENTION_DAYS < 1) {
  throw new Error("MEASUREMENTS_RETENTION_DAYS must be a number >= 1");
}

const legacyUsageByEndpoint = Object.create(null);
const legacyResetHistory = [];

function getResetHistoryTtlCutoffTs(nowTs = Date.now()) {
  return nowTs - Math.floor(LEGACY_USAGE_RESET_HISTORY_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function pruneLegacyResetHistoryByTtl(nowTs = Date.now()) {
  const cutoffTs = getResetHistoryTtlCutoffTs(nowTs);
  const before = legacyResetHistory.length;

  for (let index = legacyResetHistory.length - 1; index >= 0; index -= 1) {
    const resetTs = Date.parse(legacyResetHistory[index].resetAt);
    if (!Number.isFinite(resetTs) || resetTs < cutoffTs) {
      legacyResetHistory.splice(index, 1);
    }
  }

  return legacyResetHistory.length !== before;
}

function loadLegacyUsageMetricsFromDisk() {
  if (!fs.existsSync(LEGACY_USAGE_METRICS_FILE)) {
    return;
  }

  try {
    const raw = fs.readFileSync(LEGACY_USAGE_METRICS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed?.perEndpoint) ? parsed.perEndpoint : [];
    const resetHistoryEntries = Array.isArray(parsed?.resetHistory) ? parsed.resetHistory : [];

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const endpoint = String(entry.endpoint || "").trim();
      const count = Number(entry.count);
      const lastUsedAt = typeof entry.lastUsedAt === "string" ? entry.lastUsedAt : null;

      if (!endpoint || !Number.isFinite(count) || count < 0) {
        continue;
      }

      legacyUsageByEndpoint[endpoint] = {
        endpoint,
        count,
        lastUsedAt,
      };
    }

    for (const resetEntry of resetHistoryEntries) {
      if (!resetEntry || typeof resetEntry !== "object") {
        continue;
      }

      const id = String(resetEntry.id || "").trim();
      const resetAt = typeof resetEntry.resetAt === "string" ? resetEntry.resetAt : null;
      const reason = typeof resetEntry.reason === "string" ? resetEntry.reason : null;
      const resetBy = resetEntry.resetBy && typeof resetEntry.resetBy === "object"
        ? {
            userId: resetEntry.resetBy.userId,
            userName: resetEntry.resetBy.userName,
            role: resetEntry.resetBy.role,
          }
        : null;

      if (!id || !resetAt || !resetBy || !resetBy.role) {
        continue;
      }

      legacyResetHistory.push({
        id,
        resetAt,
        reason,
        resetBy,
        beforeTotalCount: Number(resetEntry.beforeTotalCount) || 0,
        beforeEndpointsTouched: Number(resetEntry.beforeEndpointsTouched) || 0,
      });
    }

    if (legacyResetHistory.length > LEGACY_USAGE_RESET_HISTORY_LIMIT) {
      legacyResetHistory.splice(0, legacyResetHistory.length - LEGACY_USAGE_RESET_HISTORY_LIMIT);
    }

    pruneLegacyResetHistoryByTtl();
  } catch (error) {
    console.warn(`[legacy-metrics] failed to load ${LEGACY_USAGE_METRICS_FILE}:`, error.message);
  }
}

function persistLegacyUsageMetricsToDisk() {
  const payload = {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    perEndpoint: Object.values(legacyUsageByEndpoint)
      .map(entry => ({
        endpoint: entry.endpoint,
        count: entry.count,
        lastUsedAt: entry.lastUsedAt,
      }))
      .sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
    resetHistory: legacyResetHistory,
  };

  try {
    fs.mkdirSync(path.dirname(LEGACY_USAGE_METRICS_FILE), { recursive: true });
    fs.writeFileSync(LEGACY_USAGE_METRICS_FILE, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.warn(`[legacy-metrics] failed to persist ${LEGACY_USAGE_METRICS_FILE}:`, error.message);
  }
}

function sendJson(response, statusCode, payload) {
  let body = payload;
  if (
    statusCode >= 400
    && payload
    && typeof payload === "object"
    && typeof payload.error === "string"
  ) {
    body = {
      error: payload.error,
      message: payload.message || payload.error,
    };

    if (typeof payload.details !== "undefined") {
      body.details = payload.details;
    }

    const extraKeys = Object.keys(payload).filter(key => !["error", "message", "details"].includes(key));
    for (const key of extraKeys) {
      body[key] = payload[key];
    }
  } else if (statusCode < 400) {
    const isAlreadyEnvelope = (
      payload
      && typeof payload === "object"
      && Object.prototype.hasOwnProperty.call(payload, "data")
      && Object.prototype.hasOwnProperty.call(payload, "meta")
    );

    if (!isAlreadyEnvelope) {
      body = {
        data: payload,
        meta: {},
      };
    }
  }

  if (body && typeof body === "object") {
    if (!body.meta || typeof body.meta !== "object" || Array.isArray(body.meta)) {
      body.meta = {};
    }
    if (!body.meta.contractVersion) {
      body.meta.contractVersion = API_CONTRACT_VERSION;
    }
  }

  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function createHttpError(statusCode, errorCode, message, details) {
  const error = new Error(message || errorCode);
  error.statusCode = statusCode;
  error.errorCode = errorCode;
  error.details = details;
  return error;
}

function sendApiError(response, statusCode, errorCode, message, details) {
  const payload = {
    error: errorCode,
    message: message || errorCode,
  };
  if (typeof details !== "undefined") {
    payload.details = details;
  }
  sendJson(response, statusCode, payload);
}

function sendListSuccess(response, statusCode, payload, meta = {}) {
  if (payload && typeof payload === "object" && !Array.isArray(payload) && Array.isArray(payload.items)) {
    const {
      items,
      total,
      count,
      limit,
      offset,
      hasNext,
      hasPrevious,
      ...restMeta
    } = payload;

    sendJson(response, statusCode, {
      data: items,
      meta: {
        total: Number.isFinite(Number(total)) ? Number(total) : items.length,
        count: Number.isFinite(Number(count)) ? Number(count) : items.length,
        limit: Number.isFinite(Number(limit)) ? Number(limit) : items.length,
        offset: Number.isFinite(Number(offset)) ? Number(offset) : 0,
        hasNext: Boolean(hasNext),
        hasPrevious: Boolean(hasPrevious),
        ...restMeta,
        ...meta,
      },
    });
    return;
  }

  const items = Array.isArray(payload) ? payload : [];
  sendJson(response, statusCode, {
    data: items,
    meta: {
      count: items.length,
      ...meta,
    },
  });
}

async function parseJsonBody(request) {
  const contentLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    throw createHttpError(413, "payload_too_large", `Request body exceeds ${MAX_JSON_BODY_BYTES} bytes`);
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const bufferChunk = Buffer.from(chunk);
    totalBytes += bufferChunk.length;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw createHttpError(413, "payload_too_large", `Request body exceeds ${MAX_JSON_BODY_BYTES} bytes`);
    }
    chunks.push(bufferChunk);
  }
  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf-8"));
  } catch {
    throw createHttpError(400, "invalid_json_body", "Malformed JSON body");
  }
}

function extractBearerToken(request) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length).trim();
}

function getQueryParam(urlString, key) {
  const url = new URL(urlString, "http://localhost");
  return url.searchParams.get(key);
}

function hasQueryParam(urlString, key) {
  const url = new URL(urlString, "http://localhost");
  return url.searchParams.has(key);
}

function parseBoundedIntegerQuery(urlString, key, options = {}) {
  const { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, defaultValue } = options;
  const raw = getQueryParam(urlString, key);

  if (raw === null || raw === "") {
    return { ok: true, value: defaultValue };
  }

  if (!/^[-]?\d+$/.test(String(raw))) {
    return { ok: false, error: `${key}_invalid` };
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `${key}_out_of_range` };
  }

  return { ok: true, value };
}

function resolvePaginationRequest(urlString, options = {}) {
  const {
    defaultLimit = 50,
    maxLimit = 200,
    endpointName = "unknown",
  } = options;

  const hasLimitParam = hasQueryParam(urlString, "limit");
  const hasOffsetParam = hasQueryParam(urlString, "offset");

  const rawMode = getQueryParam(urlString, "responseMode");
  const responseMode = rawMode ? String(rawMode).trim().toLowerCase() : null;
  if (responseMode && !["legacy", "paginated"].includes(responseMode)) {
    return {
      ok: false,
      status: 400,
      error: "responseMode_invalid",
      message: "responseMode must be 'legacy' or 'paginated'",
    };
  }

  const wantsPagination = hasLimitParam || hasOffsetParam || responseMode === "paginated";

  const limitResult = parseBoundedIntegerQuery(urlString, "limit", {
    min: 1,
    max: maxLimit,
    defaultValue: wantsPagination ? defaultLimit : undefined,
  });
  if (!limitResult.ok) {
    return {
      ok: false,
      status: 400,
      error: limitResult.error,
      message: `limit must be an integer between 1 and ${maxLimit}`,
    };
  }

  const offsetResult = parseBoundedIntegerQuery(urlString, "offset", {
    min: 0,
    max: 100000,
    defaultValue: wantsPagination ? 0 : undefined,
  });
  if (!offsetResult.ok) {
    return {
      ok: false,
      status: 400,
      error: offsetResult.error,
      message: "offset must be an integer between 0 and 100000",
    };
  }

  const isLegacyMode = responseMode === "legacy" || responseMode === null;
  const autoDenyEnabled = Number.isFinite(LEGACY_RESPONSE_MODE_AUTO_DENY_TS);
  const autoDenyActive = autoDenyEnabled && Date.now() >= LEGACY_RESPONSE_MODE_AUTO_DENY_TS;
  const enforcementMode = autoDenyActive
    ? "auto_deny"
    : (LEGACY_RESPONSE_MODE_POLICY === "deny" ? "policy_deny" : "warn");

  if (isLegacyMode && enforcementMode !== "warn") {
    return {
      ok: false,
      status: 410,
      error: "responseMode_legacy_removed",
      message: "Legacy list response mode has been removed; use responseMode=paginated.",
      details: {
        enforcementMode,
        endpoint: endpointName,
        autoDenyAt: new Date(LEGACY_RESPONSE_MODE_AUTO_DENY_TS).toISOString(),
        replacement: "responseMode=paginated",
      },
    };
  }

  return {
    ok: true,
    wantsPagination,
    limit: limitResult.value,
    offset: offsetResult.value,
    responseMode: responseMode || "legacy",
    deprecation: isLegacyMode
      ? {
          code: "response_mode_legacy_deprecated",
          message: "Legacy list response mode is deprecated; use responseMode=paginated.",
          replacement: "responseMode=paginated",
          policy: LEGACY_RESPONSE_MODE_POLICY,
          enforcementMode,
          sunsetAt: LEGACY_RESPONSE_MODE_SUNSET,
          autoDenyAt: new Date(LEGACY_RESPONSE_MODE_AUTO_DENY_TS).toISOString(),
        }
      : null,
  };
}

function recordLegacyUsage(endpointName) {
  const key = endpointName || "unknown";
  if (!legacyUsageByEndpoint[key]) {
    legacyUsageByEndpoint[key] = {
      endpoint: key,
      count: 0,
      lastUsedAt: null,
    };
  }

  legacyUsageByEndpoint[key].count += 1;
  legacyUsageByEndpoint[key].lastUsedAt = new Date().toISOString();
  persistLegacyUsageMetricsToDisk();
}

function resetLegacyUsageMetrics() {
  for (const key of Object.keys(legacyUsageByEndpoint)) {
    delete legacyUsageByEndpoint[key];
  }

  persistLegacyUsageMetricsToDisk();
}

function appendLegacyResetHistory(entry) {
  legacyResetHistory.push(entry);
  pruneLegacyResetHistoryByTtl();
  if (legacyResetHistory.length > LEGACY_USAGE_RESET_HISTORY_LIMIT) {
    legacyResetHistory.splice(0, legacyResetHistory.length - LEGACY_USAGE_RESET_HISTORY_LIMIT);
  }
  persistLegacyUsageMetricsToDisk();
}

function listLegacyResetHistory(options = {}) {
  const {
    limit = 50,
    offset = 0,
  } = options;

  const ttlChanged = pruneLegacyResetHistoryByTtl();
  if (ttlChanged) {
    persistLegacyUsageMetricsToDisk();
  }

  const ordered = [...legacyResetHistory].sort((a, b) => String(b.resetAt).localeCompare(String(a.resetAt)));
  const items = ordered.slice(offset, offset + limit);
  const total = ordered.length;

  return {
    items,
    total,
    count: items.length,
    limit,
    offset,
    hasNext: offset + items.length < total,
    hasPrevious: offset > 0,
  };
}

function getLegacyResetHistorySummary() {
  const ttlChanged = pruneLegacyResetHistoryByTtl();
  if (ttlChanged) {
    persistLegacyUsageMetricsToDisk();
  }

  const count = legacyResetHistory.length;
  const lastResetAt = count > 0
    ? [...legacyResetHistory].map(entry => entry.resetAt).sort().slice(-1)[0]
    : null;

  return {
    count,
    lastResetAt,
    ttlDays: LEGACY_USAGE_RESET_HISTORY_TTL_DAYS,
  };
}

function escapeCsvValue(value) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  const asString = String(value);
  if (!/[",\n\r]/.test(asString)) {
    return asString;
  }

  return `"${asString.replace(/"/g, '""')}"`;
}

function buildLegacyResetHistoryCsv() {
  const ttlChanged = pruneLegacyResetHistoryByTtl();
  if (ttlChanged) {
    persistLegacyUsageMetricsToDisk();
  }

  const rows = [
    [
      "id",
      "resetAt",
      "reason",
      "resetByUserId",
      "resetByUserName",
      "resetByRole",
      "beforeTotalCount",
      "beforeEndpointsTouched",
    ],
  ];

  const ordered = [...legacyResetHistory].sort((a, b) => String(b.resetAt).localeCompare(String(a.resetAt)));
  for (const entry of ordered) {
    rows.push([
      entry.id,
      entry.resetAt,
      entry.reason || "",
      entry.resetBy?.userId,
      entry.resetBy?.userName,
      entry.resetBy?.role,
      entry.beforeTotalCount,
      entry.beforeEndpointsTouched,
    ]);
  }

  return rows.map(row => row.map(escapeCsvValue).join(",")).join("\n");
}

function getLegacyUsageSummary() {
  const perEndpoint = Object.values(legacyUsageByEndpoint)
    .map(entry => ({
      endpoint: entry.endpoint,
      count: entry.count,
      lastUsedAt: entry.lastUsedAt,
    }))
    .sort((a, b) => b.count - a.count || a.endpoint.localeCompare(b.endpoint));

  const totalCount = perEndpoint.reduce((sum, entry) => sum + entry.count, 0);
  const endpointsTouched = perEndpoint.length;
  const lastUsedAt = perEndpoint
    .map(entry => entry.lastUsedAt)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;

  return {
    totalCount,
    endpointsTouched,
    lastUsedAt,
    perEndpoint,
  };
}

function applyLegacyDeprecationHeaders(response) {
  response.setHeader("Deprecation", "true");
  response.setHeader("Sunset", LEGACY_RESPONSE_MODE_SUNSET);
}

function ensureAdminAccess(user, response) {
  if (!user) {
    sendJson(response, 401, { error: "authentication_required" });
    return false;
  }

  if (user.role !== "ADMIN_ENERGIE") {
    sendJson(response, 403, { error: "forbidden:admin_only" });
    return false;
  }

  return true;
}

function ensureWriteAccess(user, mutationName, response) {
  if (!user) {
    sendJson(response, 401, { error: "authentication_required" });
    return false;
  }

  if (!canRoleExecuteMutation(user.role, mutationName)) {
    sendJson(response, 403, { error: `forbidden:${mutationName}` });
    return false;
  }

  return true;
}

async function authenticateRequest(request) {
  const bearerToken = extractBearerToken(request);
  if (bearerToken) {
    return getSessionUser(bearerToken);
  }

  return null;
}

function validatePdcaPayload(body) {
  const errors = [];

  if (!body.title || String(body.title).trim().length < 3) {
    errors.push("title_min_3");
  }
  if (!body.objective || String(body.objective).trim().length < 5) {
    errors.push("objective_min_5");
  }
  if (!Number.isFinite(Number(body.machineId)) || Number(body.machineId) <= 0) {
    errors.push("machineId_invalid");
  }
  if (!Number.isFinite(Number(body.targetEnpi)) || Number(body.targetEnpi) <= 0) {
    errors.push("targetEnpi_invalid");
  }

  return errors;
}

const AI_ISO_COUPLING_RULES = {
  anomalyToPdcaMinScoreDelta: 0.0,
  enpiWindowHours: 24,
  enpiReferenceWindowHours: 24,
};

function findLatestOpenPdcaCycleForMachine(machineId) {
  const cycles = listPdcaCycles()
    .filter(item => Number(item.machineId) === Number(machineId))
    .sort((a, b) => Number(b.id) - Number(a.id));

  return cycles.find(item => {
    const status = String(item.status || "").toLowerCase();
    return status !== "clôturé" && status !== "cloture";
  }) || null;
}

function createGovernanceWho(user) {
  return {
    userId: user.id,
    userName: user.fullName,
    role: user.role,
  };
}

function appendCouplingEnpiRecalculation(machineId, reason, user, couplingActions) {
  const beforeBaseline = getEnbBaselineSnapshot({
    machineId,
    referenceWindowHours: AI_ISO_COUPLING_RULES.enpiReferenceWindowHours,
  });

  const snapshot = getEnpiCurrentSnapshot({
    machineId,
    windowHours: AI_ISO_COUPLING_RULES.enpiWindowHours,
    referenceWindowHours: AI_ISO_COUPLING_RULES.enpiReferenceWindowHours,
  });

  if (!snapshot) {
    return;
  }

  addGovernanceEvent("enpiRecalculated", {
    who: createGovernanceWho(user),
    what: "enpi_recalculation",
    why: reason,
    before_value: {
      baselineEnpi: beforeBaseline ? Number(beforeBaseline.baselineEnpi) : null,
      sampleSize: beforeBaseline ? Number(beforeBaseline.sampleSize) : 0,
    },
    after_value: {
      enpiValue: snapshot.enpiValue,
      enpiNormalized: snapshot.enpiNormalized,
      enpiDeviationPct: snapshot.enpiDeviationPct,
      status: snapshot.status,
    },
    machineId,
    diagnostics: snapshot.diagnostics,
  }, user);

  couplingActions.push({
    action: "enpiRecalculated",
    machineId,
    reason,
    enpiNormalized: snapshot.enpiNormalized,
    enpiDeviationPct: snapshot.enpiDeviationPct,
    status: snapshot.status,
  });
}

function applyAiIsoCouplingFromInference({ user, machineId, inference, anomaly, recommendation }) {
  const couplingActions = [];
  if (!inference || !inference.predicted || !anomaly) {
    return couplingActions;
  }

  const score = Number(inference.anomalyScore || 0);
  const threshold = Number(inference.threshold || 0);
  const isStrongAnomaly = score >= threshold + AI_ISO_COUPLING_RULES.anomalyToPdcaMinScoreDelta;
  if (!isStrongAnomaly) {
    return couplingActions;
  }

  const cycle = findLatestOpenPdcaCycleForMachine(machineId);
  if (cycle && String(cycle.phase || "Plan") === "Plan") {
    const transitioned = transitionPdcaCycle(cycle.id, {
      toPhase: "Do",
      reason: "AI anomaly strong score triggered Plan->Do",
      linkedAnomalyId: Number(anomaly.id) || null,
      linkedRecommendationId: recommendation ? Number(recommendation.id) : null,
    }, user);

    if (!transitioned.error) {
      const event = addGovernanceEvent("pdcaTransition", {
        who: createGovernanceWho(user),
        what: "pdca_transition",
        why: "ai_anomaly_trigger",
        before_value: transitioned.beforeValue,
        after_value: transitioned.afterValue,
        pdcaCycleId: cycle.id,
        linkedAnomalyId: Number(anomaly.id) || null,
        linkedRecommendationId: recommendation ? Number(recommendation.id) : null,
        transition: transitioned.transition,
      }, user);

      couplingActions.push({
        action: "pdcaTransition",
        pdcaCycleId: cycle.id,
        fromPhase: transitioned.transition.fromPhase,
        toPhase: transitioned.transition.toPhase,
        governanceEventId: Number(event.id),
      });
    }
  }

  appendCouplingEnpiRecalculation(machineId, "ai_anomaly_trigger", user, couplingActions);

  if (couplingActions.length > 0) {
    addGovernanceEvent("aiIsoCouplingApplied", {
      who: createGovernanceWho(user),
      what: "ai_iso_coupling",
      why: "ai_anomaly_trigger",
      machineId,
      inferenceId: inference.inferenceId || null,
      modelVersion: inference.modelVersion || null,
      score,
      threshold,
      actions: couplingActions,
    }, user);
  }

  return couplingActions;
}

function applyAiIsoCouplingFromRecommendationDecision({ user, decidedRecommendation, decision }) {
  const couplingActions = [];
  if (!decidedRecommendation || decision !== "accepted") {
    return couplingActions;
  }

  const recommendationEntity = decidedRecommendation.recommendation && typeof decidedRecommendation.recommendation === "object"
    ? decidedRecommendation.recommendation
    : decidedRecommendation;

  const machineId = Number(recommendationEntity.machineId || 0);
  if (!Number.isFinite(machineId) || machineId <= 0) {
    return couplingActions;
  }

  const cycle = findLatestOpenPdcaCycleForMachine(machineId);
  if (cycle && String(cycle.phase || "") === "Do") {
    const transitioned = transitionPdcaCycle(cycle.id, {
      toPhase: "Check",
      reason: "Recommendation accepted triggered Do->Check",
      linkedRecommendationId: Number(recommendationEntity.id) || null,
    }, user);

    if (!transitioned.error) {
      const event = addGovernanceEvent("pdcaTransition", {
        who: createGovernanceWho(user),
        what: "pdca_transition",
        why: "recommendation_accepted",
        before_value: transitioned.beforeValue,
        after_value: transitioned.afterValue,
        pdcaCycleId: cycle.id,
        linkedAnomalyId: null,
        linkedRecommendationId: Number(recommendationEntity.id) || null,
        transition: transitioned.transition,
      }, user);

      couplingActions.push({
        action: "pdcaTransition",
        pdcaCycleId: cycle.id,
        fromPhase: transitioned.transition.fromPhase,
        toPhase: transitioned.transition.toPhase,
        governanceEventId: Number(event.id),
      });
    }
  }

  appendCouplingEnpiRecalculation(machineId, "recommendation_accepted", user, couplingActions);

  if (couplingActions.length > 0) {
    addGovernanceEvent("aiIsoCouplingApplied", {
      who: createGovernanceWho(user),
      what: "ai_iso_coupling",
      why: "recommendation_accepted",
      machineId,
      recommendationId: Number(recommendationEntity.id) || null,
      actions: couplingActions,
    }, user);
  }

  return couplingActions;
}

async function persistMeasurementsWithFallback(measurements, options = {}) {
  const mode = getIntegrationMode();
  const sourceType = String(options.sourceType || "synthetic_batch").toLowerCase();
  const sourceName = String(options.sourceName || "synthetic_ingestion").trim() || "synthetic_ingestion";

  if (!Array.isArray(measurements) || measurements.length === 0) {
    return {
      ok: true,
      skipped: true,
      mode,
      insertedRows: 0,
      rejectedRows: 0,
      fallbackUsed: false,
      sourceType,
      sourceName,
    };
  }

  if (mode === "json_only") {
    pushEvent("json_fallback_write", {
      sourceType,
      sourceName,
      reason: "integration_mode_json_only",
      rowCount: measurements.length,
    });
    return {
      ok: true,
      skipped: true,
      mode,
      insertedRows: 0,
      rejectedRows: 0,
      fallbackUsed: true,
      sourceType,
      sourceName,
    };
  }

  const writeResult = await writeMeasurements(measurements, {
    sourceType,
    sourceName,
    machineId: options.machineId,
  });

  if (writeResult.ok) {
    const mirrorResult = await writeMirror(measurements, {
      sourceType,
      sourceName,
      machineId: options.machineId,
    });

    if (mirrorResult.ok) {
      pushEvent("influx_mirror_write_success", {
        sourceType,
        sourceName,
        insertedRows: Number(mirrorResult.insertedRows || 0),
        rejectedRows: Number(mirrorResult.rejectedRows || 0),
      });
    } else if (!mirrorResult.skipped) {
      pushEvent("influx_mirror_write_failed", {
        sourceType,
        sourceName,
        reason: mirrorResult.error || "influx_write_failed",
        detail: mirrorResult.message || null,
        queuedRows: Number(mirrorResult.queuedRows || 0),
        queueSize: Number(mirrorResult.queueSize || 0),
      });
    }

    pushEvent("timescale_write_success", {
      sourceType,
      sourceName,
      insertedRows: writeResult.insertedRows,
      rejectedRows: writeResult.rejectedRows,
      ingestionId: writeResult.ingestionId || null,
    });
    return {
      ok: true,
      mode,
      fallbackUsed: false,
      sourceType,
      sourceName,
      insertedRows: Number(writeResult.insertedRows || 0),
      rejectedRows: Number(writeResult.rejectedRows || 0),
      ingestionId: writeResult.ingestionId || null,
      mirror: {
        ok: Boolean(mirrorResult.ok),
        skipped: Boolean(mirrorResult.skipped),
        error: mirrorResult.error || null,
      },
    };
  }

  pushEvent("timescale_write_failed", {
    sourceType,
    sourceName,
    reason: writeResult.error || "timescale_write_failed",
    detail: writeResult.message || null,
  });

  if (mode === "parallel_fallback_json") {
    pushEvent("json_fallback_write", {
      sourceType,
      sourceName,
      reason: writeResult.error || "timescale_write_failed",
      rowCount: measurements.length,
    });
    return {
      ok: true,
      mode,
      fallbackUsed: true,
      sourceType,
      sourceName,
      insertedRows: 0,
      rejectedRows: measurements.length,
      dbError: {
        error: writeResult.error || "timescale_write_failed",
        message: writeResult.message || writeResult.error || "timescale write failed",
      },
    };
  }

  return {
    ok: false,
    mode,
    fallbackUsed: false,
    sourceType,
    sourceName,
    insertedRows: 0,
    rejectedRows: measurements.length,
    dbError: {
      error: writeResult.error || "timescale_write_failed",
      message: writeResult.message || writeResult.error || "timescale write failed",
    },
  };
}

async function handleApi(request, response) {
  const method = request.method || "GET";
  const url = request.url || "/";

  if (method === "GET" && url === "/api/health") {
    sendJson(response, 200, {
      service: "enms-main-http",
      status: "ok",
      frontendTarget: FRONTEND_TARGET,
    });
    return true;
  }

  if (method === "GET" && url === "/api/contract") {
    const autoDenyAtIso = new Date(LEGACY_RESPONSE_MODE_AUTO_DENY_TS).toISOString();
    const autoDenyActive = Date.now() >= LEGACY_RESPONSE_MODE_AUTO_DENY_TS;
    const effectiveLegacyMode = autoDenyActive
      ? "deny"
      : LEGACY_RESPONSE_MODE_POLICY;

    sendJson(response, 200, {
      contractVersion: API_CONTRACT_VERSION,
      responseEnvelope: {
        success: "{ data, meta }",
        error: "{ error, message, details?, meta }",
      },
      listResponseModes: {
        supported: ["paginated", "legacy"],
        default: "legacy",
        legacyPolicy: LEGACY_RESPONSE_MODE_POLICY,
        legacyEffectivePolicy: effectiveLegacyMode,
        legacySunsetAt: LEGACY_RESPONSE_MODE_SUNSET,
        legacyAutoDenyAt: autoDenyAtIso,
        legacyAutoDenyActive: autoDenyActive,
        replacement: "responseMode=paginated",
      },
      telemetry: {
        legacyUsage: getLegacyUsageSummary(),
        resetHistory: getLegacyResetHistorySummary(),
      },
      ingestion: {
        syntheticOnlyMode: SYNTHETIC_ONLY_MODE,
        allowedSourceTypes: SYNTHETIC_ALLOWED_SOURCE_TYPES,
        integrationMode: getIntegrationMode(),
        measurementsRetentionDays: MEASUREMENTS_RETENTION_DAYS,
        broker: "mosquitto",
        topology: "timescaledb+influxdb_parallel_json_fallback",
        batchLoaderEndpoint: "/api/ingestion/batch/load",
        healthEndpoints: ["/api/ingestion/health", "/api/ingestion/health/events", "/api/ingestion/readiness"],
        readinessEndpoint: "/api/ingestion/readiness",
        adminEndpoints: ["/api/admin/ingestion/influx/flush"],
        mirrorWriter: {
          backend: "influxdb",
          role: "best_effort_mirror",
        },
      },
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/admin/contract/metrics/resets")) {
    if (url.startsWith("/api/admin/contract/metrics/resets/export.csv")) {
      const user = await authenticateRequest(request);
      if (!ensureAdminAccess(user, response)) {
        return true;
      }

      const csvContent = buildLegacyResetHistoryCsv();
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/csv; charset=utf-8");
      response.setHeader("Content-Disposition", `attachment; filename=legacy_reset_history_${new Date().toISOString().slice(0, 10)}.csv`);
      response.end(csvContent);
      return true;
    }

    const user = await authenticateRequest(request);
    if (!ensureAdminAccess(user, response)) {
      return true;
    }

    const limitResult = parseBoundedIntegerQuery(url, "limit", {
      min: 1,
      max: 500,
      defaultValue: 50,
    });
    if (!limitResult.ok) {
      sendApiError(response, 400, limitResult.error, "limit must be an integer between 1 and 500");
      return true;
    }

    const offsetResult = parseBoundedIntegerQuery(url, "offset", {
      min: 0,
      max: 100000,
      defaultValue: 0,
    });
    if (!offsetResult.ok) {
      sendApiError(response, 400, offsetResult.error, "offset must be an integer between 0 and 100000");
      return true;
    }

    const page = listLegacyResetHistory({
      limit: limitResult.value,
      offset: offsetResult.value,
    });

    sendListSuccess(response, 200, page);
    return true;
  }

  if (method === "POST" && url === "/api/admin/contract/metrics/reset") {
    const user = await authenticateRequest(request);
    if (!ensureAdminAccess(user, response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const before = getLegacyUsageSummary();
    const reason = String(body.reason || "").trim();

    resetLegacyUsageMetrics();
    const after = getLegacyUsageSummary();
    const resetEvent = {
      id: `legacy_reset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      resetAt: new Date().toISOString(),
      reason: reason || null,
      resetBy: {
        userId: user.userId,
        userName: user.name,
        role: user.role,
      },
      beforeTotalCount: before.totalCount,
      beforeEndpointsTouched: before.endpointsTouched,
    };
    appendLegacyResetHistory(resetEvent);

    sendJson(response, 200, {
      success: true,
      resetAt: resetEvent.resetAt,
      reason: reason || null,
      resetBy: {
        userId: user.userId,
        userName: user.name,
        role: user.role,
      },
      audit: resetEvent,
      before,
      after,
    });
    return true;
  }

  if (method === "POST" && url === "/api/admin/ingestion/influx/flush") {
    const user = await authenticateRequest(request);
    if (!ensureAdminAccess(user, response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const maxItems = Number(body.maxItems || 300);
    const force = body.force === true;

    if (!Number.isFinite(maxItems) || maxItems < 1 || maxItems > 5000) {
      sendApiError(response, 400, "maxItems_invalid", "maxItems must be an integer between 1 and 5000");
      return true;
    }

    const result = await flushRetryQueue({
      force,
      maxItems,
    });

    addGovernanceEvent("influxMirrorFlush", {
      force,
      maxItems,
      result,
    }, user);

    sendJson(response, 200, {
      force,
      maxItems,
      result,
    });
    return true;
  }

  if (method === "POST" && url === "/api/auth/login") {
    const body = await parseJsonBody(request);
    if (!body.username || !body.password) {
      sendJson(response, 400, { error: "username and password are required" });
      return true;
    }

    const session = login(body.username, body.password, {
      userAgent: request.headers["user-agent"],
      ipAddress: request.socket.remoteAddress,
    });

    if (!session) {
      sendJson(response, 401, { error: "invalid credentials" });
      return true;
    }

    sendJson(response, 200, session);
    return true;
  }

  if (method === "GET" && url.startsWith("/api/auth/meByToken")) {
    const sessionToken = extractBearerToken(request);
    if (!sessionToken) {
      sendJson(response, 400, { error: "authorization_bearer_required" });
      return true;
    }

    const user = getSessionUser(sessionToken);
    if (!user) {
      sendJson(response, 401, { error: "session not found or expired" });
      return true;
    }

    sendJson(response, 200, user);
    return true;
  }

  if (method === "POST" && url === "/api/auth/logoutByToken") {
    const body = await parseJsonBody(request);
    const sessionToken = body.sessionToken || extractBearerToken(request);

    if (!sessionToken) {
      sendJson(response, 400, { error: "sessionToken is required" });
      return true;
    }

    revokeSession(sessionToken);
    sendJson(response, 200, { success: true });
    return true;
  }

  if (method === "GET" && url === "/api/machines") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    sendListSuccess(response, 200, listMachines());
    return true;
  }

  if (method === "GET" && url === "/api/sites") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    sendListSuccess(response, 200, listSites());
    return true;
  }

  if (method === "GET" && url.startsWith("/api/machines/live")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const siteId = getQueryParam(url, "siteId");
    const machineId = Number(getQueryParam(url, "machineId") || 0);

    sendListSuccess(response, 200, listMachineLiveSnapshot({
      siteId: siteId || null,
      machineId: machineId > 0 ? machineId : null,
    }));
    return true;
  }

  if (method === "POST" && url === "/api/machines") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "machines.create", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const machine = createMachine(body);
    sendJson(response, 201, machine);
    return true;
  }

  if (method === "GET" && url === "/api/alerts/unread") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    sendListSuccess(response, 200, getUnreadAlerts());
    return true;
  }

  if (method === "GET" && url.startsWith("/api/anomalies")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const status = getQueryParam(url, "status");
    const siteId = getQueryParam(url, "siteId");
    const machineId = Number(getQueryParam(url, "machineId") || 0);

    sendListSuccess(response, 200, listAnomalies({
      status: status || null,
      siteId: siteId || null,
      machineId: machineId > 0 ? machineId : null,
    }));
    return true;
  }

  if (method === "POST" && url === "/api/anomalies/acknowledge") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "anomalies.acknowledge", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const anomalyId = Number(body.anomalyId);
    const note = String(body.note || "").trim();

    if (!Number.isFinite(anomalyId) || anomalyId <= 0) {
      sendJson(response, 400, { error: "anomalyId_invalid" });
      return true;
    }
    if (note.length < 3) {
      sendJson(response, 400, { error: "note_required_min_3" });
      return true;
    }

    const updated = acknowledgeAnomaly(anomalyId, note, user);
    if (!updated) {
      sendJson(response, 404, { error: "anomaly_not_found" });
      return true;
    }

    sendJson(response, 200, updated);
    return true;
  }

  if (method === "POST" && url === "/api/inference/anomaly") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "inference.anomaly", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const machineId = Number(body.machineId || 0);
    if (!Number.isFinite(machineId) || machineId <= 0) {
      sendJson(response, 400, { error: "machineId_invalid" });
      return true;
    }

    let inference = null;
    try {
      inference = await runAnomalyInference({
        machineId,
        timestamp: body.timestamp || new Date().toISOString(),
        features: body.features,
        sequence: body.sequence,
      });
    } catch (error) {
      const statusCode = Number(error.statusCode) >= 400 ? Number(error.statusCode) : 503;
      sendJson(response, statusCode, {
        error: "inference_unavailable",
        details: error.payload || { message: error.message || "inference_failed" },
      });
      return true;
    }

    const autoCreateRecords = body.autoCreateRecords !== false;
    const autoCreateRecommendation = body.autoCreateRecommendation !== false;
    let anomaly = null;
    let recommendation = null;

    if (inference.predicted && autoCreateRecords) {
      const severity = Number(inference.anomalyScore) >= Math.max(0.8, Number(inference.threshold) + 0.2)
        ? "major"
        : "minor";
      anomaly = createAnomaly({
        machineId,
        type: "ml_sequential_drift",
        severity,
        title: `Anomalie ML detectee (${inference.model || "sequential"})`,
        message: `Score ${Number(inference.anomalyScore).toFixed(3)} > seuil ${Number(inference.threshold).toFixed(3)}.`,
        metric: "ml_anomaly_score",
        observedValue: Number(inference.anomalyScore),
        threshold: Number(inference.threshold),
        detectedAt: body.timestamp || new Date().toISOString(),
        modelVersion: inference.modelVersion || null,
        inferenceId: inference.inferenceId || null,
        explainability: inference.explainability || null,
      });

      if (anomaly && autoCreateRecommendation) {
        recommendation = createRecommendationFromAnomaly(anomaly, user);
      }

      addGovernanceEvent("anomalyDetected_ml_model", {
        anomalyId: anomaly ? anomaly.id : null,
        recommendationId: recommendation ? recommendation.id : null,
        machineId,
        score: Number(inference.anomalyScore),
        threshold: Number(inference.threshold),
        modelVersion: inference.modelVersion || null,
        inferenceId: inference.inferenceId || null,
      }, user);
    } else {
      addGovernanceEvent("anomalyInference_ml_model", {
        machineId,
        predicted: Boolean(inference.predicted),
        score: Number(inference.anomalyScore),
        threshold: Number(inference.threshold),
        modelVersion: inference.modelVersion || null,
        inferenceId: inference.inferenceId || null,
      }, user);
    }

    const couplingActions = applyAiIsoCouplingFromInference({
      user,
      machineId,
      inference,
      anomaly,
      recommendation,
    });

    sendJson(response, 200, {
      inference,
      autoCreateRecords,
      createdAnomaly: anomaly,
      createdRecommendation: recommendation,
      coupling: {
        applied: couplingActions.length > 0,
        actions: couplingActions,
      },
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/analytics/energy-timeline")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const machineId = Number(getQueryParam(url, "machineId"));
    const parsedWindow = parseBoundedIntegerQuery(url, "windowHours", { min: 1, max: 168, defaultValue: 24 });
    if (!parsedWindow.ok) {
      sendApiError(response, 400, parsedWindow.error, "windowHours must be an integer between 1 and 168");
      return true;
    }
    if (!Number.isFinite(machineId) || machineId <= 0) {
      sendJson(response, 400, { error: "machineId_invalid" });
      return true;
    }

    sendListSuccess(response, 200, listEnergyTimeline(machineId, parsedWindow.value));
    return true;
  }

  if (method === "GET" && url.startsWith("/api/analytics/cause-action-correlation")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const machineId = Number(getQueryParam(url, "machineId"));
    if (!Number.isFinite(machineId) || machineId <= 0) {
      sendJson(response, 400, { error: "machineId_invalid" });
      return true;
    }

    sendListSuccess(response, 200, listCauseActionCorrelations(machineId));
    return true;
  }

  if (method === "GET" && url.startsWith("/api/analytics/site-comparison")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const parsedWindow = parseBoundedIntegerQuery(url, "windowHours", { min: 1, max: 168, defaultValue: 24 });
    if (!parsedWindow.ok) {
      sendApiError(response, 400, parsedWindow.error, "windowHours must be an integer between 1 and 168");
      return true;
    }

    sendListSuccess(response, 200, listSiteComparison(parsedWindow.value));
    return true;
  }

  if (method === "GET" && (url === "/api/recommendations" || url.startsWith("/api/recommendations?"))) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const machineId = Number(getQueryParam(url, "machineId") || 0);
    const status = getQueryParam(url, "status");
    sendListSuccess(response, 200, listRecommendations({
      machineId: machineId > 0 ? machineId : null,
      status: status || null,
    }));
    return true;
  }

  if (method === "POST" && url === "/api/recommendations/decide") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "recommendations.decide", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const recommendationId = Number(body.recommendationId);
    const decision = String(body.decision || "").trim();
    const comment = String(body.comment || "").trim();

    if (!Number.isFinite(recommendationId) || recommendationId <= 0) {
      sendJson(response, 400, { error: "recommendationId_invalid" });
      return true;
    }
    if (!["accepted", "rejected", "deferred"].includes(decision)) {
      sendJson(response, 400, { error: "decision_invalid" });
      return true;
    }
    if (comment.length < 3) {
      sendJson(response, 400, { error: "comment_required_min_3" });
      return true;
    }

    const decided = decideRecommendation(recommendationId, decision, comment, user);
    if (!decided) {
      sendJson(response, 404, { error: "recommendation_not_found" });
      return true;
    }

    addGovernanceEvent("recommendationDecision", {
      recommendationId,
      decision,
    }, user);

    const couplingActions = applyAiIsoCouplingFromRecommendationDecision({
      user,
      decidedRecommendation: decided,
      decision,
    });

    sendJson(response, 200, {
      recommendation: decided,
      coupling: {
        applied: couplingActions.length > 0,
        actions: couplingActions,
      },
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/recommendations/history")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const machineId = Number(getQueryParam(url, "machineId") || 0);
    sendListSuccess(response, 200, listRecommendationDecisionHistory({
      machineId: machineId > 0 ? machineId : null,
    }));
    return true;
  }

  if (method === "GET" && url.startsWith("/api/recommendations/adoption")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const machineId = Number(getQueryParam(url, "machineId") || 0);
    sendJson(response, 200, getRecommendationAdoptionSummary({
      machineId: machineId > 0 ? machineId : null,
    }));
    return true;
  }

  if (method === "GET" && url.startsWith("/api/recommendations/explainability")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const recommendationId = Number(getQueryParam(url, "recommendationId") || 0);
    if (!Number.isFinite(recommendationId) || recommendationId <= 0) {
      sendJson(response, 400, { error: "recommendationId_invalid" });
      return true;
    }

    const explainability = getRecommendationExplainability(recommendationId);
    if (!explainability) {
      sendJson(response, 404, { error: "recommendation_not_found" });
      return true;
    }

    sendJson(response, 200, explainability);
    return true;
  }

  if (method === "GET" && url.startsWith("/api/governance/events")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const type = getQueryParam(url, "type");
    const limit = Number(getQueryParam(url, "limit") || 50);
    sendListSuccess(response, 200, listGovernanceEvents({
      type: type || null,
      limit,
    }));
    return true;
  }

  if (method === "GET" && url.startsWith("/api/models/versions")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const versions = listModelVersions();
    const active = getActiveModelPointer();
    sendJson(response, 200, {
      items: versions,
      active,
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/enb/baseline")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const machineId = Number(getQueryParam(url, "machineId") || 0);
    const referenceWindowHours = Number(getQueryParam(url, "referenceWindowHours") || 24);
    if (!Number.isFinite(machineId) || machineId <= 0) {
      sendJson(response, 400, { error: "machineId_invalid" });
      return true;
    }

    const baseline = getEnbBaselineSnapshot({ machineId, referenceWindowHours });
    if (!baseline) {
      sendJson(response, 404, { error: "baseline_not_found" });
      return true;
    }

    sendJson(response, 200, baseline);
    return true;
  }

  if (method === "GET" && url.startsWith("/api/enpi/current")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const machineId = Number(getQueryParam(url, "machineId") || 0);
    const windowHours = Number(getQueryParam(url, "windowHours") || 24);
    const referenceWindowHours = Number(getQueryParam(url, "referenceWindowHours") || windowHours);
    const regressionR2 = Number(getQueryParam(url, "regressionR2"));
    const reason = String(getQueryParam(url, "reason") || "runtime_monitoring").trim();

    if (!Number.isFinite(machineId) || machineId <= 0) {
      sendJson(response, 400, { error: "machineId_invalid" });
      return true;
    }

    const beforeBaseline = getEnbBaselineSnapshot({ machineId, referenceWindowHours });
    const beforeValue = {
      baselineEnpi: beforeBaseline ? Number(beforeBaseline.baselineEnpi) : null,
      sampleSize: beforeBaseline ? Number(beforeBaseline.sampleSize) : 0,
    };

    const snapshot = getEnpiCurrentSnapshot({
      machineId,
      windowHours,
      referenceWindowHours,
      regressionR2,
    });
    if (!snapshot) {
      sendJson(response, 404, { error: "enpi_snapshot_not_found" });
      return true;
    }

    addGovernanceEvent("enpiRecalculated", {
      who: {
        userId: user.id,
        userName: user.fullName,
        role: user.role,
      },
      what: "enpi_recalculation",
      why: reason || "runtime_monitoring",
      before_value: beforeValue,
      after_value: {
        enpiValue: snapshot.enpiValue,
        enpiNormalized: snapshot.enpiNormalized,
        enpiDeviationPct: snapshot.enpiDeviationPct,
        status: snapshot.status,
      },
      machineId,
      diagnostics: snapshot.diagnostics,
    }, user);

    sendJson(response, 200, snapshot);
    return true;
  }

  if (method === "POST" && url === "/api/models/activate-version") {
    const user = await authenticateRequest(request);
    if (!ensureAdminAccess(user, response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const version = String(body.version || "").trim();
    if (!version) {
      sendJson(response, 400, { error: "version_required" });
      return true;
    }

    let active = null;
    try {
      active = activateModelVersion(version);
    } catch (error) {
      if (error && error.code === "model_version_not_found") {
        sendJson(response, 404, { error: "model_version_not_found" });
        return true;
      }
      sendJson(response, 400, { error: error && error.code ? error.code : "model_activation_failed" });
      return true;
    }

    const event = addGovernanceEvent("modelVersionActivated", {
      version: active.version,
      model: active.model,
      threshold: active.threshold,
      artifactDir: active.artifact_dir,
    }, user);

    sendJson(response, 200, {
      success: true,
      active,
      event,
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/data-quality/summary")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const siteId = getQueryParam(url, "siteId");
    const machineId = Number(getQueryParam(url, "machineId") || 0);

    const filters = {
      siteId: siteId || null,
      machineId: machineId > 0 ? machineId : null,
    };

    let payload = null;
    if (isParallelModeEnabled()) {
      payload = await listDataQualitySummaryFromDb(filters);
    }
    if (!payload) {
      payload = listDataQualitySummary(filters);
    }

    sendListSuccess(response, 200, payload, {
      repository: Array.isArray(payload) && isParallelModeEnabled() ? "db_parallel_or_fallback" : "json_fallback",
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/data-quality/issues")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const siteId = getQueryParam(url, "siteId");
    const machineId = Number(getQueryParam(url, "machineId") || 0);
    const status = getQueryParam(url, "status");
    const severity = getQueryParam(url, "severity");

    const pagination = resolvePaginationRequest(url, {
      defaultLimit: 50,
      maxLimit: 500,
      endpointName: "/api/data-quality/issues",
    });
    if (!pagination.ok) {
      sendApiError(response, pagination.status, pagination.error, pagination.message, pagination.details);
      return true;
    }

    if (pagination.deprecation) {
      recordLegacyUsage("/api/data-quality/issues");
      applyLegacyDeprecationHeaders(response);
    }

    const filters = {
      siteId: siteId || null,
      machineId: machineId > 0 ? machineId : null,
      status: status || null,
      severity: severity || null,
      limit: pagination.limit,
      offset: pagination.offset,
      paginationMode: pagination.wantsPagination ? "meta" : null,
    };

    let payload = null;
    if (isParallelModeEnabled()) {
      payload = await listDataQualityIssuesFromDb(filters);
    }
    if (!payload) {
      payload = listDataQualityIssues(filters);
    }

    sendListSuccess(response, 200, payload, {
      responseMode: pagination.wantsPagination ? "paginated" : "legacy",
      deprecation: pagination.deprecation,
      repository: isParallelModeEnabled() ? "db_parallel_or_fallback" : "json_fallback",
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/imports/journal")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const status = getQueryParam(url, "status");
    const sourceType = getQueryParam(url, "sourceType");

    const pagination = resolvePaginationRequest(url, {
      defaultLimit: 50,
      maxLimit: 500,
      endpointName: "/api/imports/journal",
    });
    if (!pagination.ok) {
      sendApiError(response, pagination.status, pagination.error, pagination.message, pagination.details);
      return true;
    }

    if (pagination.deprecation) {
      recordLegacyUsage("/api/imports/journal");
      applyLegacyDeprecationHeaders(response);
    }

    sendListSuccess(response, 200, listImportJournal({
      status: status || null,
      sourceType: sourceType || null,
      limit: pagination.limit,
      offset: pagination.offset,
      paginationMode: pagination.wantsPagination ? "meta" : null,
    }), {
      responseMode: pagination.wantsPagination ? "paginated" : "legacy",
      deprecation: pagination.deprecation,
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/data-quality/rejections")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const siteId = getQueryParam(url, "siteId");
    const machineId = Number(getQueryParam(url, "machineId") || 0);
    const pagination = resolvePaginationRequest(url, {
      defaultLimit: 50,
      maxLimit: 500,
      endpointName: "/api/data-quality/rejections",
    });
    if (!pagination.ok) {
      sendApiError(response, pagination.status, pagination.error, pagination.message, pagination.details);
      return true;
    }

    if (pagination.deprecation) {
      recordLegacyUsage("/api/data-quality/rejections");
      applyLegacyDeprecationHeaders(response);
    }

    const filters = {
      siteId: siteId || null,
      machineId: machineId > 0 ? machineId : null,
      limit: pagination.limit,
      offset: pagination.offset,
      paginationMode: pagination.wantsPagination ? "meta" : null,
    };

    let payload = null;
    if (isParallelModeEnabled()) {
      payload = await listDataRejectionsFromDb(filters);
    }
    if (!payload) {
      payload = listDataRejections(filters);
    }

    sendListSuccess(response, 200, payload, {
      responseMode: pagination.wantsPagination ? "paginated" : "legacy",
      deprecation: pagination.deprecation,
      repository: isParallelModeEnabled() ? "db_parallel_or_fallback" : "json_fallback",
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/incidents")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const status = getQueryParam(url, "status");
    const severity = getQueryParam(url, "severity");
    const component = getQueryParam(url, "component");
    const pagination = resolvePaginationRequest(url, {
      defaultLimit: 50,
      maxLimit: 200,
      endpointName: "/api/incidents",
    });
    if (!pagination.ok) {
      sendApiError(response, pagination.status, pagination.error, pagination.message, pagination.details);
      return true;
    }

    if (pagination.deprecation) {
      recordLegacyUsage("/api/incidents");
      applyLegacyDeprecationHeaders(response);
    }

    sendListSuccess(response, 200, listTechnicalIncidents({
      status: status || null,
      severity: severity || null,
      component: component || null,
      limit: pagination.limit,
      offset: pagination.offset,
      paginationMode: pagination.wantsPagination ? "meta" : null,
    }), {
      responseMode: pagination.wantsPagination ? "paginated" : "legacy",
      deprecation: pagination.deprecation,
    });
    return true;
  }

  if (method === "POST" && url === "/api/incidents/ack") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "incidents.ack", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const incidentId = Number(body.incidentId);
    const note = String(body.note || "").trim();

    if (!Number.isFinite(incidentId) || incidentId <= 0) {
      sendJson(response, 400, { error: "incidentId_invalid" });
      return true;
    }
    if (note.length < 3) {
      sendJson(response, 400, { error: "note_required_min_3" });
      return true;
    }

    const updated = acknowledgeTechnicalIncident(incidentId, note, user);
    if (!updated) {
      sendJson(response, 404, { error: "incident_not_found" });
      return true;
    }

    addGovernanceEvent("incidentAcknowledged", {
      incidentId,
    }, user);

    sendJson(response, 200, updated);
    return true;
  }

  if (method === "POST" && url === "/api/incidents/escalate") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "incidents.escalate", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const incidentId = Number(body.incidentId);
    const reason = String(body.reason || "").trim();
    const targetTeam = String(body.targetTeam || "").trim();

    if (!Number.isFinite(incidentId) || incidentId <= 0) {
      sendJson(response, 400, { error: "incidentId_invalid" });
      return true;
    }
    if (reason.length < 5) {
      sendJson(response, 400, { error: "reason_required_min_5" });
      return true;
    }
    if (targetTeam.length < 2) {
      sendJson(response, 400, { error: "targetTeam_required_min_2" });
      return true;
    }

    const updated = escalateTechnicalIncident(incidentId, reason, targetTeam, user);
    if (!updated) {
      sendJson(response, 404, { error: "incident_not_found" });
      return true;
    }

    addGovernanceEvent("incidentEscalated", {
      incidentId,
      targetTeam,
    }, user);

    sendJson(response, 200, updated);
    return true;
  }

  if (method === "POST" && url === "/api/data-quality/rejections/resolve") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "dataQuality.resolve", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const issueId = Number(body.issueId);
    const resolutionCode = String(body.resolutionCode || "").trim();
    const resolutionNote = String(body.resolutionNote || "").trim();

    if (!Number.isFinite(issueId) || issueId <= 0) {
      sendJson(response, 400, { error: "issueId_invalid" });
      return true;
    }
    if (!resolutionCode) {
      sendJson(response, 400, { error: "resolutionCode_required" });
      return true;
    }
    if (resolutionNote.length < 3) {
      sendJson(response, 400, { error: "resolutionNote_required_min_3" });
      return true;
    }

    const resolved = resolveDataRejection(issueId, resolutionCode, resolutionNote, user);
    if (!resolved) {
      sendJson(response, 404, { error: "data_rejection_not_found" });
      return true;
    }

    addGovernanceEvent("dataRejectionResolved", {
      issueId,
      resolutionCode,
    }, user);

    sendJson(response, 200, resolved);
    return true;
  }

  if (method === "GET" && url === "/api/platform/health") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const businessHealth = getPlatformHealthSummary();
    const uptimeSeconds = Math.max(0, Math.round((Date.now() - SERVER_BOOT_TS) / 1000));

    sendJson(response, 200, {
      service: "enms-main-http",
      status: "healthy",
      api: {
        status: "healthy",
        uptimeSeconds,
        startedAt: new Date(SERVER_BOOT_TS).toISOString(),
        nodeVersion: process.version,
      },
      ingestion: businessHealth.ingestion,
      workerAudit: businessHealth.workerAudit,
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/ingestion/health/events")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const limitResult = parseBoundedIntegerQuery(url, "limit", {
      min: 1,
      max: 200,
      defaultValue: 25,
    });
    if (!limitResult.ok) {
      sendApiError(response, 400, limitResult.error, "limit must be an integer between 1 and 200");
      return true;
    }

    sendJson(response, 200, getIngestionHealthSnapshot(limitResult.value));
    return true;
  }

  if (method === "GET" && url === "/api/ingestion/health") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const timescaleHealth = await checkTimescaleHealth();
    const writerStats = getWriterStats();
    const influxHealth = await checkInfluxHealth();
    const influxWriterStats = getInfluxWriterStats();
    const snapshot = getIngestionHealthSnapshot(5);

    sendJson(response, 200, {
      status: timescaleHealth.status === "healthy" ? "healthy" : "degraded",
      integrationMode: getIntegrationMode(),
      syntheticOnlyMode: SYNTHETIC_ONLY_MODE,
      retentionDays: MEASUREMENTS_RETENTION_DAYS,
      broker: {
        type: "mosquitto",
        url: process.env.MQTT_BROKER_URL || "mqtt://localhost:1883",
        topic: process.env.MQTT_TOPIC_MEASUREMENTS || "energy/machine/+",
      },
      components: {
        timescale: timescaleHealth,
        writer: writerStats,
        influxMirror: {
          health: influxHealth,
          writer: influxWriterStats,
        },
      },
      activity: {
        lastBatchRunAt: snapshot.lastBatchRunAt,
        lastMqttMessageAt: snapshot.lastMqttMessageAt,
        counters: snapshot.counters,
        influxRetry: influxWriterStats.retry,
      },
    });
    return true;
  }

  if (method === "GET" && url === "/api/ingestion/readiness") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const integrationMode = getIntegrationMode();
    const timescaleHealth = await checkTimescaleHealth();
    const influxHealth = await checkInfluxHealth();

    const strictTimescalePrimary = integrationMode === "timescale_primary";
    const isTimescaleUp = timescaleHealth.status === "healthy";
    const readinessStatus = strictTimescalePrimary && !isTimescaleUp ? "not_ready" : "ready";
    const statusCode = readinessStatus === "ready" ? 200 : 503;

    sendJson(response, statusCode, {
      status: readinessStatus,
      strict: strictTimescalePrimary,
      integrationMode,
      checks: {
        timescale: {
          required: strictTimescalePrimary,
          healthy: isTimescaleUp,
          detail: timescaleHealth,
        },
        influxMirror: {
          required: false,
          healthy: influxHealth.status === "healthy" || influxHealth.status === "disabled",
          detail: influxHealth,
        },
      },
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/slo/dashboard")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const parsedWindow = parseBoundedIntegerQuery(url, "windowHours", { min: 1, max: 168, defaultValue: 24 });
    if (!parsedWindow.ok) {
      sendApiError(response, 400, parsedWindow.error, "windowHours must be an integer between 1 and 168");
      return true;
    }

    sendJson(response, 200, getSloDashboard(parsedWindow.value));
    return true;
  }

  if (method === "POST" && url === "/api/imports/run") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "imports.run", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const syntheticValidation = validateSyntheticImportPayload(body);
    if (!syntheticValidation.ok) {
      sendApiError(response, 400, syntheticValidation.error, syntheticValidation.message, syntheticValidation.details);
      return true;
    }

    const sourceName = String(body.sourceName || "").trim();
    const rowCount = Number(body.rowCount || 0);
    const machineId = Number(body.machineId || 0);

    if (sourceName.length < 3) {
      sendJson(response, 400, { error: "sourceName_required_min_3" });
      return true;
    }
    if (!Number.isFinite(rowCount) || rowCount <= 0) {
      sendJson(response, 400, { error: "rowCount_invalid" });
      return true;
    }
    if (!Number.isFinite(machineId) || machineId <= 0) {
      sendJson(response, 400, { error: "machineId_invalid" });
      return true;
    }

    const measurements = Array.isArray(body.measurements) ? body.measurements : [];
    const persistence = await persistMeasurementsWithFallback(measurements, {
      sourceType: body.sourceType,
      sourceName,
      machineId,
    });

    if (!persistence.ok) {
      sendApiError(response, 503, persistence.dbError.error, persistence.dbError.message, {
        integrationMode: persistence.mode,
        sourceType: persistence.sourceType,
        sourceName: persistence.sourceName,
      });
      return true;
    }

    const computedRejectedRows = Number.isFinite(Number(body.rejectedRows))
      ? Number(body.rejectedRows)
      : Number(persistence.rejectedRows || 0);

    const computedRowCount = Number.isFinite(Number(body.rowCount)) && Number(body.rowCount) > 0
      ? Number(body.rowCount)
      : (measurements.length > 0 ? measurements.length : 0);

    const importPayload = {
      ...body,
      rowCount: computedRowCount,
      rejectedRows: Math.max(0, Math.min(computedRejectedRows, computedRowCount)),
      note: [
        String(body.note || "").trim() || null,
        persistence.fallbackUsed ? `timescale_fallback_json mode=${persistence.mode}` : null,
      ].filter(Boolean).join(" | ") || null,
    };

    const entry = createImportJournalEntry(importPayload, user);
    addGovernanceEvent("importRun", {
      importId: entry.id,
      sourceName: entry.sourceName,
      status: entry.status,
      rowCount: entry.rowCount,
      rejectedRows: entry.rejectedRows,
      integrationMode: persistence.mode,
      fallbackUsed: persistence.fallbackUsed,
      dbIngestionId: persistence.ingestionId || null,
    }, user);

    if (persistence.fallbackUsed) {
      pushEvent("json_fallback_write", {
        sourceType: String(body.sourceType || "manual").toLowerCase(),
        sourceName,
        reason: "imports_run_fallback",
        rowCount: importPayload.rowCount,
      });
    }

    sendJson(response, 201, {
      ...entry,
      persistence: {
        integrationMode: persistence.mode,
        fallbackUsed: persistence.fallbackUsed,
        dbIngestionId: persistence.ingestionId || null,
      },
    });
    return true;
  }

  if (method === "POST" && url === "/api/ingestion/batch/load") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "imports.run", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const filePath = String(body.filePath || "").trim();
    const sourceName = String(body.sourceName || path.basename(filePath || "synthetic_batch.csv")).trim();
    const machineId = Number(body.machineId || 0);

    const syntheticValidation = validateSyntheticImportPayload({
      sourceType: "synthetic_batch",
      sourceName,
      fileName: filePath,
    });
    if (!syntheticValidation.ok) {
      sendApiError(response, 400, syntheticValidation.error, syntheticValidation.message, syntheticValidation.details);
      return true;
    }

    const batchResult = await loadSyntheticCsvBatch({
      filePath,
      sourceName,
      sourceType: "synthetic_batch",
      maxRows: body.maxRows,
      machineId: Number.isFinite(machineId) && machineId > 0 ? machineId : undefined,
    });

    pushEvent("batch_run", {
      sourceName,
      filePath,
      rowsParsed: batchResult.rowsParsed || 0,
      insertedRows: batchResult.insertedRows || 0,
      rejectedRows: batchResult.rejectedRows || 0,
      ok: batchResult.ok,
    });

    if (!batchResult.ok && batchResult.error === "csv_file_not_found") {
      sendApiError(response, 404, batchResult.error, batchResult.message);
      return true;
    }

    if (!batchResult.ok && ["filePath_invalid_or_not_csv", "csv_empty_or_missing_data", "csv_parse_error"].includes(batchResult.error)) {
      sendApiError(response, 400, batchResult.error, batchResult.message || batchResult.error);
      return true;
    }

    const integrationMode = getIntegrationMode();
    const fallbackUsed = !batchResult.ok && integrationMode === "parallel_fallback_json";
    if (!batchResult.ok && integrationMode === "timescale_primary") {
      sendApiError(response, 503, batchResult.error || "timescale_write_failed", batchResult.message || "Timescale write failed", {
        integrationMode,
      });
      return true;
    }

    const rowCountForJournal = Number(batchResult.rowsParsed || 0);
    const rejectedRowsForJournal = Number(batchResult.rejectedRows || 0);
    const journalEntry = createImportJournalEntry({
      sourceName,
      sourceType: "synthetic_batch",
      fileName: path.basename(filePath || "synthetic_batch.csv"),
      machineId: Number.isFinite(machineId) && machineId > 0 ? machineId : 1,
      rowCount: rowCountForJournal,
      rejectedRows: rejectedRowsForJournal,
      note: [
        String(body.note || "").trim() || null,
        fallbackUsed ? "timescale_write_failed_json_fallback" : null,
      ].filter(Boolean).join(" | ") || null,
      errorCount: fallbackUsed ? 1 : 0,
      warningCount: rejectedRowsForJournal > 0 ? 1 : 0,
    }, user);

    addGovernanceEvent("syntheticBatchLoad", {
      importId: journalEntry.id,
      sourceName,
      filePath,
      rowsParsed: rowCountForJournal,
      insertedRows: Number(batchResult.insertedRows || 0),
      rejectedRows: rejectedRowsForJournal,
      fallbackUsed,
      integrationMode,
      ingestionId: batchResult.ingestionId || null,
    }, user);

    if (fallbackUsed) {
      pushEvent("json_fallback_write", {
        sourceType: "synthetic_batch",
        sourceName,
        reason: batchResult.error || "timescale_write_failed",
        rowCount: rowCountForJournal,
      });
    }

    sendJson(response, 201, {
      import: journalEntry,
      batch: {
        ...batchResult,
        fallbackUsed,
        integrationMode,
      },
    });
    return true;
  }

  if (method === "POST" && url === "/api/alerts/mark-read") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "alerts.markAsRead", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const updated = markAlertAsRead(Number(body.alertId));
    if (!updated) {
      sendJson(response, 404, { error: "alert_not_found" });
      return true;
    }

    sendJson(response, 200, updated);
    return true;
  }

  if (method === "POST" && url === "/api/governance/approve-baseline") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "governance.approveBaseline", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const event = addGovernanceEvent("approveBaseline", body, user);
    sendJson(response, 200, { success: true, event });
    return true;
  }

  if (method === "POST" && url === "/api/governance/close-pdca") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "governance.closePdcaCycle", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    if (!body.reason || String(body.reason).trim().length < 5) {
      sendJson(response, 400, { error: "reason_required_min_5" });
      return true;
    }

    const closed = closePdcaCycle(Number(body.pdcaCycleId), String(body.reason).trim(), user);
    if (!closed) {
      sendJson(response, 404, { error: "pdca_not_found" });
      return true;
    }

    const event = addGovernanceEvent("closePdcaCycle", body, user);
    sendJson(response, 200, { success: true, event, cycle: closed });
    return true;
  }

  if (method === "POST" && url === "/api/governance/export-audit") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "governance.exportAuditReport", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const event = addGovernanceEvent("exportAuditReport", body, user);
    sendJson(response, 200, { success: true, event });
    return true;
  }

  if (method === "GET" && url === "/api/pdca/cycles") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    sendListSuccess(response, 200, listPdcaCycles());
    return true;
  }

  if (method === "GET" && url.startsWith("/api/pdca/status")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const cycleId = Number(getQueryParam(url, "cycleId") || 0);
    const status = getPdcaStatus({ cycleId: cycleId > 0 ? cycleId : null });
    if (!status) {
      sendJson(response, 404, { error: "pdca_not_found" });
      return true;
    }

    sendJson(response, 200, status);
    return true;
  }

  if (method === "POST" && url === "/api/pdca/transition") {
    const user = await authenticateRequest(request);
    if (!ensureWriteAccess(user, "pdca.transition", response)) {
      return true;
    }

    const body = await parseJsonBody(request);
    const pdcaCycleId = Number(body.pdcaCycleId || 0);
    const toPhase = String(body.toPhase || "").trim();
    const reason = String(body.reason || "").trim();
    const linkedAnomalyId = Number(body.linkedAnomalyId || 0) || null;
    const linkedRecommendationId = Number(body.linkedRecommendationId || 0) || null;

    if (!Number.isFinite(pdcaCycleId) || pdcaCycleId <= 0) {
      sendJson(response, 400, { error: "pdcaCycleId_invalid" });
      return true;
    }
    if (!toPhase) {
      sendJson(response, 400, { error: "toPhase_required" });
      return true;
    }
    if (reason.length < 3) {
      sendJson(response, 400, { error: "reason_required_min_3" });
      return true;
    }

    const transitioned = transitionPdcaCycle(pdcaCycleId, {
      toPhase,
      reason,
      linkedAnomalyId,
      linkedRecommendationId,
    }, user);

    if (!transitioned || transitioned.error === "pdca_not_found") {
      sendJson(response, 404, { error: "pdca_not_found" });
      return true;
    }
    if (transitioned.error === "toPhase_invalid") {
      sendJson(response, 400, { error: "toPhase_invalid" });
      return true;
    }
    if (transitioned.error === "reason_required_min_3") {
      sendJson(response, 400, { error: "reason_required_min_3" });
      return true;
    }
    if (transitioned.error === "pdca_transition_invalid") {
      sendJson(response, 409, { error: "pdca_transition_invalid", details: transitioned.details || null });
      return true;
    }

    const event = addGovernanceEvent("pdcaTransition", {
      who: {
        userId: user.id,
        userName: user.fullName,
        role: user.role,
      },
      what: "pdca_transition",
      why: reason,
      before_value: transitioned.beforeValue,
      after_value: transitioned.afterValue,
      pdcaCycleId,
      linkedAnomalyId,
      linkedRecommendationId,
      transition: transitioned.transition,
    }, user);

    sendJson(response, 200, {
      success: true,
      cycle: transitioned.cycle,
      transition: transitioned.transition,
      event,
    });
    return true;
  }

  if (method === "GET" && url.startsWith("/api/pdca/cycles/")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const cycleId = Number(url.replace("/api/pdca/cycles/", ""));
    const cycle = getPdcaCycleById(cycleId);
    if (!cycle) {
      sendJson(response, 404, { error: "pdca_not_found" });
      return true;
    }

    sendJson(response, 200, cycle);
    return true;
  }

  if (method === "POST" && url === "/api/pdca/cycles") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const body = await parseJsonBody(request);
    const errors = validatePdcaPayload(body);
    if (errors.length > 0) {
      sendJson(response, 400, { error: "validation_failed", details: errors });
      return true;
    }

    const created = createPdcaCycle(body, user);
    sendJson(response, 201, created);
    return true;
  }

  if (method === "PUT" && url.startsWith("/api/pdca/cycles/")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const body = await parseJsonBody(request);
    const errors = validatePdcaPayload(body);
    if (errors.length > 0) {
      sendJson(response, 400, { error: "validation_failed", details: errors });
      return true;
    }

    const cycleId = Number(url.replace("/api/pdca/cycles/", ""));
    const updated = updatePdcaCycle(cycleId, body, user);
    if (!updated) {
      sendJson(response, 404, { error: "pdca_not_found" });
      return true;
    }

    sendJson(response, 200, updated);
    return true;
  }

  if (method === "GET" && url === "/api/approvals") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    sendListSuccess(response, 200, listApprovals());
    return true;
  }

  if (method === "POST" && url === "/api/approvals/decide") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const body = await parseJsonBody(request);
    const approvalId = Number(body.approvalId);
    const decision = String(body.decision || "").trim();
    const comment = String(body.comment || "").trim();

    if (!Number.isFinite(approvalId) || approvalId <= 0) {
      sendJson(response, 400, { error: "approvalId_invalid" });
      return true;
    }

    if (!["approved", "rejected"].includes(decision)) {
      sendJson(response, 400, { error: "decision_invalid" });
      return true;
    }

    if (comment.length < 3) {
      sendJson(response, 400, { error: "comment_required_min_3" });
      return true;
    }

    const approvals = listApprovals();
    const target = approvals.find(item => Number(item.id) === approvalId);
    if (!target) {
      sendJson(response, 404, { error: "approval_not_found" });
      return true;
    }

    const actionByType = {
      DOCUMENT: "APPROVE_DOCUMENT",
      BASELINE: "VALIDATE_BASELINE",
      PDCA: "CLOSE_PDCA",
      REPORT: "EXPORT_AUDIT_REPORT",
    };
    const requiredAction = actionByType[target.entityType] || "APPROVE_DOCUMENT";

    if (!canWriteEndpoint(user.role, requiredAction)) {
      sendJson(response, 403, { error: `forbidden:approvals.decide:${target.entityType}` });
      return true;
    }

    const decided = decideApproval(approvalId, decision, comment, user);
    if (!decided) {
      sendJson(response, 404, { error: "approval_not_found" });
      return true;
    }
    if (decided.error) {
      sendJson(response, 409, { error: decided.error });
      return true;
    }

    sendJson(response, 200, decided);
    return true;
  }

  if (method === "GET" && url === "/api/documents/versions") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    sendListSuccess(response, 200, listDocumentVersions());
    return true;
  }

  if (method === "GET" && url.startsWith("/api/documents/diff")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const fromId = Number(getQueryParam(url, "fromId"));
    const toId = Number(getQueryParam(url, "toId"));

    if (!Number.isFinite(fromId) || !Number.isFinite(toId)) {
      sendJson(response, 400, { error: "fromId_toId_required" });
      return true;
    }

    const diff = diffDocumentVersions(fromId, toId);
    if (!diff) {
      sendJson(response, 404, { error: "document_version_not_found" });
      return true;
    }

    sendJson(response, 200, diff);
    return true;
  }

  if (method === "GET" && url === "/api/audit/matrix") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    sendListSuccess(response, 200, listAuditMatrix());
    return true;
  }

  if (method === "GET" && url.startsWith("/api/audit/evidence")) {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    const evidenceId = getQueryParam(url, "evidenceId");
    const clause = getQueryParam(url, "clause");

    if (evidenceId) {
      const item = getAuditEvidenceById(Number(evidenceId));
      if (!item) {
        sendJson(response, 404, { error: "audit_evidence_not_found" });
        return true;
      }

      sendJson(response, 200, item);
      return true;
    }

    if (clause) {
      sendListSuccess(response, 200, listAuditEvidenceByClause(clause));
      return true;
    }

    sendJson(response, 400, { error: "clause_or_evidenceId_required" });
    return true;
  }

  if (method === "POST" && url === "/api/audit/export-preaudit") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    if (!canWriteEndpoint(user.role, "EXPORT_AUDIT_REPORT")) {
      sendJson(response, 403, { error: "forbidden:audit.export" });
      return true;
    }

    const body = await parseJsonBody(request);
    const exportItem = generatePreAuditExport(body || {}, user);
    const event = addGovernanceEvent("exportPreAudit", { exportId: exportItem.id }, user);

    sendJson(response, 200, { success: true, export: exportItem, event });
    return true;
  }

  if (method === "GET" && url === "/api/audit/exports") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    sendListSuccess(response, 200, listPreAuditExports());
    return true;
  }

  if (method === "GET" && url === "/api/audit/nonconformities") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    sendListSuccess(response, 200, listNonConformities());
    return true;
  }

  if (method === "POST" && url === "/api/audit/nonconformities") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    if (!["ADMIN_ENERGIE", "RESPONSABLE_SITE", "AUDITEUR"].includes(user.role)) {
      sendJson(response, 403, { error: "forbidden:nonconformity.create" });
      return true;
    }

    const body = await parseJsonBody(request);
    const required = ["clause", "title", "description", "correctiveAction", "owner", "dueDate"];
    const missing = required.filter(field => !String(body[field] || "").trim());
    if (missing.length > 0) {
      sendJson(response, 400, { error: "validation_failed", details: missing.map(item => `${item}_required`) });
      return true;
    }

    const created = createNonConformity(body, user);
    sendJson(response, 201, created);
    return true;
  }

  if (method === "POST" && url === "/api/audit/nonconformities/action") {
    const user = await authenticateRequest(request);
    if (!user) {
      sendJson(response, 401, { error: "authentication_required" });
      return true;
    }

    if (!["ADMIN_ENERGIE", "RESPONSABLE_SITE", "AUDITEUR"].includes(user.role)) {
      sendJson(response, 403, { error: "forbidden:nonconformity.action" });
      return true;
    }

    const body = await parseJsonBody(request);
    const nonConformityId = Number(body.nonConformityId);
    const actionId = Number(body.actionId);
    const status = String(body.status || "").trim();
    const note = String(body.note || "").trim();

    if (!Number.isFinite(nonConformityId) || !Number.isFinite(actionId)) {
      sendJson(response, 400, { error: "nonConformityId_actionId_invalid" });
      return true;
    }
    if (!["open", "in_progress", "done"].includes(status)) {
      sendJson(response, 400, { error: "status_invalid" });
      return true;
    }
    if (note.length < 3) {
      sendJson(response, 400, { error: "note_required_min_3" });
      return true;
    }

    const updated = updateCorrectiveAction(nonConformityId, actionId, status, note, user);
    if (!updated) {
      sendJson(response, 404, { error: "nonconformity_not_found" });
      return true;
    }
    if (updated.error) {
      sendJson(response, 404, { error: updated.error });
      return true;
    }

    sendJson(response, 200, updated);
    return true;
  }

  return false;
}

async function proxyToFrontend(request, response) {
  const targetUrl = `${FRONTEND_TARGET}${request.url || "/"}`;

  try {
    const method = request.method || "GET";
    const headers = { ...request.headers };
    delete headers.host;

    const init = {
      method,
      headers,
      redirect: "manual",
    };

    if (!["GET", "HEAD"].includes(method)) {
      const chunks = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      init.body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    }

    const upstream = await fetch(targetUrl, init);
    response.statusCode = upstream.status;

    upstream.headers.forEach((value, key) => {
      response.setHeader(key, value);
    });

    const arrayBuffer = await upstream.arrayBuffer();
    response.end(Buffer.from(arrayBuffer));
  } catch (error) {
    sendJson(response, 502, {
      error: "frontend_proxy_unavailable",
      target: FRONTEND_TARGET,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

function getSafeStaticPath(urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  const normalized = path.normalize(cleanPath).replace(/^([.][.][/\\])+/, "");
  const absolutePath = path.join(STATIC_DIR, normalized);

  if (!absolutePath.startsWith(STATIC_DIR)) {
    return null;
  }

  return absolutePath;
}

function getContentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(request, response) {
  const url = request.url || "/";
  const pathOnly = url.split("?")[0];
  const staticPath = getSafeStaticPath(pathOnly);
  if (!staticPath) {
    sendJson(response, 400, { error: "invalid_path" });
    return true;
  }

  if (!fs.existsSync(staticPath) || fs.statSync(staticPath).isDirectory()) {
    return false;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", getContentType(staticPath));
  response.end(fs.readFileSync(staticPath));
  return true;
}

function startMainHttpServer(port = PORT) {
  const server = http.createServer(async (request, response) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    response.setHeader("X-Request-Id", requestId);
    const url = request.url || "/";

    if (url.startsWith(API_PREFIX)) {
      try {
        const handled = await handleApi(request, response);
        if (!handled) {
          sendJson(response, 404, { error: "api_route_not_found" });
        }
      } catch (error) {
        if (error && Number.isInteger(error.statusCode) && typeof error.errorCode === "string") {
          sendApiError(response, error.statusCode, error.errorCode, error.message, error.details);
        } else {
          sendJson(response, 500, {
            error: "internal_error",
            details: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return;
    }

    const served = serveStatic(request, response);
    if (!served) {
      // SPA fallback: serve index.html for all non-file routes
      const indexPath = path.join(__dirname, "public", "index.html");
      if (fs.existsSync(indexPath)) {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(fs.readFileSync(indexPath));
      } else {
        // Development mode: proxy to Vite dev server
        await proxyToFrontend(request, response);
      }
    }
  });

  server.listen(port, () => {
    console.log(`Main HTTP server running on http://localhost:${port}`);
    console.log(`Proxy frontend target: ${FRONTEND_TARGET}`);

    // Start MQTT consumer if MQTT_BROKER_URL is configured
    if (process.env.MQTT_BROKER_URL) {
      try {
        const mqttClient = mqttConsumer.run(updateMachineLiveFromMqtt);
        if (mqttClient) {
          console.log(`[mqtt] consumer started (broker=${process.env.MQTT_BROKER_URL})`);
        }
      } catch (error) {
        console.error(`[mqtt] consumer failed to start: ${error.message}`);
      }
    } else {
      console.log(`[mqtt] consumer skipped (MQTT_BROKER_URL not set)`);
    }
  });

  return server;
}

module.exports = {
  startMainHttpServer,
};

loadLegacyUsageMetricsFromDisk();

if (require.main === module) {
  startMainHttpServer();
}
