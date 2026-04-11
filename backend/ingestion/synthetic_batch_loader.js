const fs = require("fs");
const path = require("path");

const { writeMeasurements } = require("./timescale_writer");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_BATCH_MAX_ROWS = Number(process.env.BATCH_LOADER_MAX_ROWS || 50000);

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map(value => value.trim());
}

function normalizeHeaders(headers) {
  return headers.map(header => String(header || "").trim());
}

function resolveSafeCsvPath(filePath) {
  if (!filePath || typeof filePath !== "string") {
    return null;
  }

  const absolute = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(ROOT_DIR, filePath);

  if (!absolute.startsWith(ROOT_DIR)) {
    return null;
  }

  return absolute;
}

function rowFromHeaders(headers, values) {
  const row = {};
  for (let index = 0; index < headers.length; index += 1) {
    row[headers[index]] = values[index] !== undefined ? values[index] : null;
  }
  return row;
}

function parseCsvContent(content, maxRows) {
  const lines = String(content || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      ok: false,
      error: "csv_empty_or_missing_data",
      rows: [],
    };
  }

  const headers = normalizeHeaders(parseCsvLine(lines[0]));
  const rows = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    if (rows.length >= maxRows) {
      break;
    }

    const values = parseCsvLine(lines[lineIndex]);
    rows.push(rowFromHeaders(headers, values));
  }

  return {
    ok: true,
    headers,
    rows,
    totalLines: lines.length - 1,
  };
}

async function loadSyntheticCsvBatch(input = {}) {
  const filePath = resolveSafeCsvPath(String(input.filePath || "").trim());
  if (!filePath || !filePath.toLowerCase().endsWith(".csv")) {
    return {
      ok: false,
      error: "filePath_invalid_or_not_csv",
      message: "filePath must point to a CSV file within the workspace.",
    };
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return {
      ok: false,
      error: "csv_file_not_found",
      message: `CSV file not found: ${filePath}`,
    };
  }

  const sourceName = String(input.sourceName || path.basename(filePath)).trim() || path.basename(filePath);
  const sourceType = String(input.sourceType || "synthetic_batch").toLowerCase();
  const maxRows = Math.max(1, Math.min(Number(input.maxRows || DEFAULT_BATCH_MAX_ROWS), DEFAULT_BATCH_MAX_ROWS));

  const startedAt = new Date().toISOString();
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseCsvContent(content, maxRows);

  if (!parsed.ok) {
    return {
      ok: false,
      error: parsed.error,
      message: "CSV batch parsing failed.",
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  const writeResult = await writeMeasurements(parsed.rows, {
    sourceType,
    sourceName,
    machineId: input.machineId,
  });

  return {
    ok: writeResult.ok,
    error: writeResult.error,
    message: writeResult.message,
    sourceName,
    sourceType,
    filePath: path.relative(ROOT_DIR, filePath).replace(/\\/g, "/"),
    startedAt,
    finishedAt: new Date().toISOString(),
    rowsParsed: parsed.rows.length,
    insertedRows: Number(writeResult.insertedRows || 0),
    rejectedRows: Number(writeResult.rejectedRows || 0),
    ingestionId: writeResult.ingestionId || null,
    rejectionSamples: writeResult.rejectionSamples || [],
  };
}

module.exports = {
  loadSyntheticCsvBatch,
};
