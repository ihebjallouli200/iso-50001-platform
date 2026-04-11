const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const MODELS_ROOT = path.join(ROOT, "ml_pipeline", "models", "anomaly_sequential");
const POINTER_PATH = path.join(MODELS_ROOT, "selected_latest.json");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function getActiveModelPointer() {
  if (!fs.existsSync(POINTER_PATH)) {
    return null;
  }
  return readJson(POINTER_PATH);
}

function listModelVersions() {
  const active = getActiveModelPointer();
  const activeVersion = active && active.version ? String(active.version) : null;

  if (!fs.existsSync(MODELS_ROOT)) {
    return [];
  }

  const entries = fs.readdirSync(MODELS_ROOT, { withFileTypes: true });
  const versions = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("v")) {
      continue;
    }

    const artifactDir = path.join(MODELS_ROOT, entry.name);
    const metadataPath = path.join(artifactDir, "metadata.json");
    if (!fs.existsSync(metadataPath)) {
      continue;
    }

    let metadata = null;
    try {
      metadata = readJson(metadataPath);
    } catch {
      continue;
    }

    versions.push({
      version: entry.name,
      model: metadata.model || null,
      threshold: Number(metadata.threshold),
      createdAt: metadata.created_at || null,
      artifactDir: path.relative(ROOT, artifactDir).replace(/\\/g, "/"),
      active: entry.name === activeVersion,
    });
  }

  return versions.sort((a, b) => {
    const aTs = Date.parse(a.createdAt || "");
    const bTs = Date.parse(b.createdAt || "");
    if (Number.isFinite(aTs) && Number.isFinite(bTs)) {
      return bTs - aTs;
    }
    return String(b.version).localeCompare(String(a.version));
  });
}

function activateModelVersion(version) {
  const safeVersion = String(version || "").trim();
  if (!safeVersion) {
    const err = new Error("version_required");
    err.code = "version_required";
    throw err;
  }

  const artifactDir = path.join(MODELS_ROOT, safeVersion);
  const metadataPath = path.join(artifactDir, "metadata.json");
  if (!fs.existsSync(artifactDir) || !fs.existsSync(metadataPath)) {
    const err = new Error("model_version_not_found");
    err.code = "model_version_not_found";
    throw err;
  }

  const metadata = readJson(metadataPath);
  const pointer = {
    version: safeVersion,
    artifact_dir: path.relative(ROOT, artifactDir).replace(/\\/g, "/"),
    model: metadata.model || null,
    threshold: Number(metadata.threshold),
    features: Array.isArray(metadata.features) ? metadata.features : [],
    seq_len: Number(metadata.sequence && metadata.sequence.seq_len ? metadata.sequence.seq_len : 30),
    updated_at: new Date().toISOString(),
    backend_activation_status: "ready",
  };

  fs.writeFileSync(POINTER_PATH, JSON.stringify(pointer, null, 2), "utf8");
  return pointer;
}

module.exports = {
  getActiveModelPointer,
  listModelVersions,
  activateModelVersion,
};
