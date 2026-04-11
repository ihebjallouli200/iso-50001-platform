const SYNTHETIC_ONLY_MODE = String(process.env.SYNTHETIC_ONLY_MODE || "true").trim().toLowerCase() !== "false";

const SYNTHETIC_ALLOWED_SOURCE_TYPES = [
  "synthetic_csv",
  "synthetic_mqtt",
  "synthetic_batch",
  "manual",
];

const FORBIDDEN_REAL_MARKERS = [
  "real_measurements",
  "real_data_source",
  "collecte_reelle",
  "uci",
  "appliances energy prediction",
];

function containsForbiddenRealMarker(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return FORBIDDEN_REAL_MARKERS.some(marker => normalized.includes(marker));
}

function hasSyntheticMarker(value) {
  return String(value || "").trim().toLowerCase().includes("synthetic");
}

function validateSyntheticImportPayload(payload = {}) {
  if (!SYNTHETIC_ONLY_MODE) {
    return { ok: true };
  }

  const sourceType = String(payload.sourceType || "").trim().toLowerCase();
  const sourceName = String(payload.sourceName || "").trim();
  const fileName = String(payload.fileName || "").trim();

  if (!SYNTHETIC_ALLOWED_SOURCE_TYPES.includes(sourceType)) {
    return {
      ok: false,
      error: "synthetic_only_sourceType_invalid",
      message: `sourceType must be one of: ${SYNTHETIC_ALLOWED_SOURCE_TYPES.join(", ")}`,
      details: {
        sourceType,
        allowedSourceTypes: SYNTHETIC_ALLOWED_SOURCE_TYPES,
      },
    };
  }

  if (containsForbiddenRealMarker(sourceName) || containsForbiddenRealMarker(fileName)) {
    return {
      ok: false,
      error: "synthetic_only_real_marker_detected",
      message: "Real-data markers are forbidden while SYNTHETIC_ONLY_MODE is enabled.",
      details: {
        sourceName,
        fileName,
      },
    };
  }

  if (sourceType !== "manual" && !hasSyntheticMarker(sourceName) && !hasSyntheticMarker(fileName)) {
    return {
      ok: false,
      error: "synthetic_only_marker_required",
      message: "sourceName or fileName must contain 'synthetic' while SYNTHETIC_ONLY_MODE is enabled.",
      details: {
        sourceName,
        fileName,
      },
    };
  }

  return { ok: true };
}

module.exports = {
  SYNTHETIC_ONLY_MODE,
  SYNTHETIC_ALLOWED_SOURCE_TYPES,
  validateSyntheticImportPayload,
};
