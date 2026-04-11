const INTEGRATION_MODE = String(process.env.INGESTION_INTEGRATION_MODE || "parallel_fallback_json").trim().toLowerCase();

const SUPPORTED_INTEGRATION_MODES = [
  "json_only",
  "parallel_fallback_json",
  "timescale_primary",
];

function getIntegrationMode() {
  if (!SUPPORTED_INTEGRATION_MODES.includes(INTEGRATION_MODE)) {
    return "parallel_fallback_json";
  }
  return INTEGRATION_MODE;
}

module.exports = {
  SUPPORTED_INTEGRATION_MODES,
  getIntegrationMode,
};
