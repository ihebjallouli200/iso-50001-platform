/**
 * Anomaly Inference Client — supports both:
 *   1. Remote ML microservice (ANOMALY_INFERENCE_URL env var — for Render)
 *   2. Local Python sidecar (spawn process — for development)
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");

// Remote microservice URL (e.g. https://iso50001-ml-inference.onrender.com)
const REMOTE_URL = process.env.ANOMALY_INFERENCE_URL || "";

// Local sidecar config
const SIDECAR_PORT = Number(process.env.ANOMALY_SIDECAR_PORT || 5577);
const SIDECAR_HOST = "127.0.0.1";

let sidecarProcess = null;
let startupPromise = null;

// ─── Remote microservice mode ─────────────────────────────────

function remoteRequest(method, urlPath, payload = null, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const fullUrl = new URL(urlPath, REMOTE_URL);
    const isSecure = fullUrl.protocol === "https:";
    const httpModule = isSecure ? https : http;

    const body = payload ? JSON.stringify(payload) : null;
    const options = {
      hostname: fullUrl.hostname,
      port: fullUrl.port || (isSecure ? 443 : 80),
      path: fullUrl.pathname,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
      },
      timeout: timeoutMs,
    };

    const req = httpModule.request(options, (response) => {
      let chunks = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { chunks += chunk; });
      response.on("end", () => {
        try {
          resolve({ statusCode: response.statusCode || 500, payload: JSON.parse(chunks) });
        } catch {
          resolve({ statusCode: response.statusCode || 500, payload: { error: "invalid_json" } });
        }
      });
    });

    req.on("timeout", () => req.destroy(new Error("inference_timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Local sidecar mode ───────────────────────────────────────

function localRequest(method, requestPath, payload = null, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request(
      {
        host: SIDECAR_HOST,
        port: SIDECAR_PORT,
        path: requestPath,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
        timeout: timeoutMs,
      },
      (response) => {
        let chunks = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { chunks += chunk; });
        response.on("end", () => {
          try {
            resolve({ statusCode: response.statusCode || 500, payload: JSON.parse(chunks) });
          } catch {
            resolve({ statusCode: response.statusCode || 500, payload: { error: "invalid_json" } });
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("sidecar_timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function detectPythonExecutable() {
  if (process.env.ENMS_PYTHON_EXECUTABLE) return process.env.ENMS_PYTHON_EXECUTABLE;
  const winVenv = path.join(ROOT, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(winVenv)) return winVenv;
  const unixVenv = path.join(ROOT, ".venv", "bin", "python");
  if (fs.existsSync(unixVenv)) return unixVenv;
  return "python";
}

async function waitForSidecarReady(deadlineTs) {
  while (Date.now() < deadlineTs) {
    try {
      const result = await localRequest("GET", "/health", null, 1000);
      if (result.statusCode === 200 && result.payload && result.payload.status === "ok") return true;
    } catch { /* keep polling */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function ensureSidecar() {
  if (sidecarProcess && !sidecarProcess.killed) return;
  if (startupPromise) { await startupPromise; return; }

  startupPromise = (async () => {
    const pythonBin = detectPythonExecutable();
    const scriptPath = path.join(ROOT, "ml_pipeline", "serve_anomaly_inference.py");

    sidecarProcess = spawn(pythonBin, [scriptPath, "--port", String(SIDECAR_PORT)], {
      cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"],
    });

    sidecarProcess.stdout.on("data", (chunk) => {
      const line = String(chunk).trim();
      if (line) console.log(`[anomaly-sidecar] ${line}`);
    });
    sidecarProcess.stderr.on("data", (chunk) => {
      const line = String(chunk).trim();
      if (line) console.error(`[anomaly-sidecar] ${line}`);
    });
    sidecarProcess.on("exit", (code) => {
      if (code !== 0) console.error(`[anomaly-sidecar] exited with code ${code}`);
      sidecarProcess = null;
      startupPromise = null;
    });

    const ready = await waitForSidecarReady(Date.now() + 12000);
    if (!ready) throw new Error("inference_sidecar_unavailable");
  })();

  try { await startupPromise; } finally { startupPromise = null; }
}

// ─── Public API ──────────────────────────────────────────────

async function runAnomalyInference(payload) {
  let result;

  if (REMOTE_URL) {
    // Use remote ML microservice
    try {
      result = await remoteRequest("POST", "/infer", payload, 8000);
    } catch (error) {
      console.error(`[inference] Remote ML service error: ${error.message}`);
      throw error;
    }
  } else {
    // Use local Python sidecar
    await ensureSidecar();
    result = await localRequest("POST", "/infer", payload, 8000);
  }

  if (result.statusCode >= 400) {
    const errorCode = result.payload && result.payload.error ? result.payload.error : "inference_failed";
    const error = new Error(errorCode);
    error.statusCode = result.statusCode;
    error.payload = result.payload;
    throw error;
  }

  return result.payload;
}

async function getInferenceHealth() {
  try {
    if (REMOTE_URL) {
      const result = await remoteRequest("GET", "/health", null, 3000);
      return { mode: "remote", url: REMOTE_URL, ...result.payload };
    } else {
      const result = await localRequest("GET", "/health", null, 1000);
      return { mode: "local_sidecar", port: SIDECAR_PORT, ...result.payload };
    }
  } catch (error) {
    return {
      mode: REMOTE_URL ? "remote" : "local_sidecar",
      status: "unavailable",
      error: error.message,
      url: REMOTE_URL || `http://${SIDECAR_HOST}:${SIDECAR_PORT}`,
    };
  }
}

module.exports = {
  runAnomalyInference,
  getInferenceHealth,
};
