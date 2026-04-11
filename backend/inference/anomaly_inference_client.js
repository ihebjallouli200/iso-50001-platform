const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const SIDECAR_PORT = Number(process.env.ANOMALY_SIDECAR_PORT || 5577);
const SIDECAR_HOST = "127.0.0.1";
const SIDECAR_HEALTH_PATH = "/health";
const SIDECAR_INFER_PATH = "/infer";

let sidecarProcess = null;
let startupPromise = null;

function detectPythonExecutable() {
  if (process.env.ENMS_PYTHON_EXECUTABLE) {
    return process.env.ENMS_PYTHON_EXECUTABLE;
  }

  const winVenv = path.join(ROOT, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(winVenv)) {
    return winVenv;
  }

  const unixVenv = path.join(ROOT, ".venv", "bin", "python");
  if (fs.existsSync(unixVenv)) {
    return unixVenv;
  }

  return "python";
}

function httpRequestJson(method, requestPath, payload = null, timeoutMs = 7000) {
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
      response => {
        let chunks = "";
        response.setEncoding("utf8");
        response.on("data", chunk => {
          chunks += chunk;
        });
        response.on("end", () => {
          let parsed = null;
          try {
            parsed = chunks ? JSON.parse(chunks) : null;
          } catch {
            parsed = { error: "invalid_json_response" };
          }
          resolve({ statusCode: response.statusCode || 500, payload: parsed });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("sidecar_timeout"));
    });
    req.on("error", reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

async function waitForSidecarReady(deadlineTs) {
  while (Date.now() < deadlineTs) {
    try {
      const result = await httpRequestJson("GET", SIDECAR_HEALTH_PATH, null, 1000);
      if (result.statusCode === 200 && result.payload && result.payload.status === "ok") {
        return true;
      }
    } catch {
      // Keep polling until timeout.
    }

    await new Promise(resolve => setTimeout(resolve, 200));
  }

  return false;
}

async function ensureSidecar() {
  if (sidecarProcess && !sidecarProcess.killed) {
    return;
  }

  if (startupPromise) {
    await startupPromise;
    return;
  }

  startupPromise = (async () => {
    const pythonBin = detectPythonExecutable();
    const scriptPath = path.join(ROOT, "ml_pipeline", "serve_anomaly_inference.py");

    sidecarProcess = spawn(pythonBin, [scriptPath, "--port", String(SIDECAR_PORT)], {
      cwd: ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    sidecarProcess.stdout.on("data", chunk => {
      const line = String(chunk).trim();
      if (line) {
        console.log(`[anomaly-sidecar] ${line}`);
      }
    });

    sidecarProcess.stderr.on("data", chunk => {
      const line = String(chunk).trim();
      if (line) {
        console.error(`[anomaly-sidecar] ${line}`);
      }
    });

    sidecarProcess.on("exit", code => {
      if (code !== 0) {
        console.error(`[anomaly-sidecar] exited with code ${code}`);
      }
      sidecarProcess = null;
      startupPromise = null;
    });

    const ready = await waitForSidecarReady(Date.now() + 12000);
    if (!ready) {
      throw new Error("inference_sidecar_unavailable");
    }
  })();

  try {
    await startupPromise;
  } finally {
    startupPromise = null;
  }
}

async function runAnomalyInference(payload) {
  await ensureSidecar();
  const result = await httpRequestJson("POST", SIDECAR_INFER_PATH, payload, 8000);
  if (result.statusCode >= 400) {
    const errorCode = result.payload && result.payload.error ? result.payload.error : "inference_failed";
    const error = new Error(errorCode);
    error.statusCode = result.statusCode;
    error.payload = result.payload;
    throw error;
  }

  return result.payload;
}

module.exports = {
  runAnomalyInference,
};
