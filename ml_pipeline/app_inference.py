#!/usr/bin/env python3
"""
ISO 50001 ML Inference Server — ONNX Runtime (lightweight).
No PyTorch needed! Only onnxruntime (~50MB) + flask + numpy.
"""
import json, os, uuid
import numpy as np
import onnxruntime as ort
from flask import Flask, request, jsonify

# ─── Load Model ──────────────────────────────────────────────

ROOT = os.path.dirname(os.path.abspath(__file__))
POINTER_PATH = os.path.join(ROOT, "models", "anomaly_sequential", "selected_latest.json")

with open(POINTER_PATH) as f:
    pointer = json.load(f)

artifact_dir = os.path.join(ROOT, "..", pointer["artifact_dir"])
with open(os.path.join(artifact_dir, "metadata.json")) as f:
    metadata = json.load(f)

scaler_npz = np.load(os.path.join(artifact_dir, "scaler_stats.npz"))
scaler_mean = scaler_npz["mean"].astype(np.float32)
scaler_scale = np.where(scaler_npz["scale"] == 0, 1.0, scaler_npz["scale"]).astype(np.float32)

onnx_path = os.path.join(artifact_dir, "model.onnx")
session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])

features_list = metadata.get("features", [])
input_dim = len(features_list)
seq_len = int(metadata.get("sequence", {}).get("seq_len", 30))
threshold = float(metadata.get("threshold", 0.5))

print(f"[ml] ONNX model loaded: {pointer['version']}")
print(f"[ml] Features: {input_dim}, seq_len: {seq_len}, threshold: {threshold:.4f}")

# ─── Flask App ────────────────────────────────────────────────

app = Flask(__name__)

def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "runtime": "onnxruntime",
        "modelVersion": pointer["version"],
        "model": metadata.get("model", "transformer_classifier"),
        "features": input_dim,
        "threshold": threshold,
        "roc_auc": metadata.get("metrics", {}).get("roc_auc"),
    })

@app.route("/infer", methods=["POST"])
def infer():
    payload = request.get_json(force=True, silent=True) or {}

    # Build sequence
    if "sequence" in payload and isinstance(payload["sequence"], list):
        seq = np.array(payload["sequence"][-seq_len:], dtype=np.float32)
        if seq.shape[0] < seq_len:
            pad = np.repeat(seq[:1, :], seq_len - seq.shape[0], axis=0)
            seq = np.vstack([pad, seq])
    elif "features" in payload and isinstance(payload["features"], list):
        feat = np.array(payload["features"], dtype=np.float32).reshape(1, input_dim)
        seq = np.repeat(feat, seq_len, axis=0)
    else:
        return jsonify({"error": "sequence_or_features_required"}), 400

    # Scale
    scaled = (seq - scaler_mean.reshape(1, -1)) / scaler_scale.reshape(1, -1)
    tensor = scaled.reshape(1, seq_len, input_dim).astype(np.float32)

    # Infer
    logits = session.run(None, {"input": tensor})[0][0]
    score = float(sigmoid(logits))

    # Explainability
    last_abs = np.abs(scaled[-1])
    top_idx = np.argsort(-last_abs)[:3]
    top = [
        {
            "variable": features_list[i],
            "contribution": float(last_abs[i] / (last_abs.sum() + 1e-6)),
            "direction": "increase" if seq[-1, i] >= scaler_mean[i] else "decrease",
        }
        for i in top_idx
    ]

    return jsonify({
        "predicted": bool(score > threshold),
        "anomalyScore": round(score, 6),
        "threshold": threshold,
        "modelVersion": pointer["version"],
        "model": metadata.get("model", "transformer_classifier"),
        "inferenceId": f"inf-{uuid.uuid4().hex[:12]}",
        "confidence": round(max(score, 1.0 - score), 4),
        "machineId": payload.get("machineId"),
        "timestamp": payload.get("timestamp"),
        "runtime": "onnxruntime",
        "explainability": {"topContributions": top},
    })

@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "iso50001-ml-inference",
        "runtime": "onnxruntime",
        "status": "running",
        "endpoints": ["/health", "/infer"],
    })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5577))
    print(f"[ml] Starting ONNX inference server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
