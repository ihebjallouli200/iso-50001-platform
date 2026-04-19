#!/usr/bin/env python3
"""
ML Inference Microservice — ONNX Runtime version.
Uses onnxruntime (~50MB) instead of PyTorch (~2GB) for Render Free Tier.
"""
import json
import os
import uuid
from pathlib import Path

import numpy as np
import onnxruntime as ort
from flask import Flask, request, jsonify

# ─── Model Loading ───────────────────────────────────────────

ROOT = Path(__file__).resolve().parent
MODEL_DIR = ROOT / "models" / "anomaly_sequential"
POINTER_FILE = MODEL_DIR / "selected_latest.json"

_active = None


def load_active_model():
    global _active
    with POINTER_FILE.open("r") as f:
        pointer = json.load(f)

    artifact_dir = ROOT.parent / pointer["artifact_dir"]
    metadata = json.loads((artifact_dir / "metadata.json").read_text())

    # Load scaler
    scaler_npz = np.load(artifact_dir / "scaler_stats.npz")
    scaler_mean = scaler_npz["mean"].astype(np.float32)
    scaler_scale = np.where(scaler_npz["scale"] == 0, 1.0, scaler_npz["scale"]).astype(np.float32)

    # Load ONNX model
    onnx_path = str(artifact_dir / "model.onnx")
    if not os.path.exists(onnx_path):
        raise FileNotFoundError(f"ONNX model not found: {onnx_path}")

    session = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])

    _active = {
        "pointer": pointer,
        "metadata": metadata,
        "session": session,
        "scaler_mean": scaler_mean,
        "scaler_scale": scaler_scale,
    }
    print(f"[ml] ONNX model loaded: {pointer['version']} ({pointer['model']})")
    print(f"[ml] Features: {len(metadata.get('features', []))}, Threshold: {metadata.get('threshold')}")
    return _active


def get_active():
    global _active
    if _active is None:
        load_active_model()
    return _active


# ─── Inference Logic ──────────────────────────────────────────

def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def run_inference(payload):
    active = get_active()
    metadata = active["metadata"]
    features = metadata.get("features", [])
    seq_len = int(metadata.get("sequence", {}).get("seq_len", 30))
    feature_count = len(features)
    threshold = float(metadata.get("threshold", 0.5))

    # Build sequence from payload
    if "sequence" in payload and isinstance(payload["sequence"], list):
        seq = np.array(payload["sequence"][-seq_len:], dtype=np.float32)
        if seq.shape[0] < seq_len:
            pad = np.repeat(seq[:1, :], seq_len - seq.shape[0], axis=0)
            seq = np.vstack([pad, seq])
    elif "features" in payload and isinstance(payload["features"], list):
        feat = np.array(payload["features"], dtype=np.float32).reshape(1, feature_count)
        seq = np.repeat(feat, seq_len, axis=0)
    else:
        return {"error": "sequence_or_features_required"}, 400

    # Scale
    scaled = (seq - active["scaler_mean"].reshape(1, -1)) / active["scaler_scale"].reshape(1, -1)
    input_tensor = scaled.reshape(1, seq_len, feature_count).astype(np.float32)

    # ONNX inference
    logits = active["session"].run(None, {"input": input_tensor})[0]
    score = float(sigmoid(logits[0]))

    # Explainability
    last_abs = np.abs(scaled[-1])
    top_idx = np.argsort(-last_abs)[:3]
    top = [
        {
            "variable": features[int(i)],
            "contribution": float(last_abs[i] / (last_abs.sum() + 1e-6)),
            "direction": "increase" if seq[-1, i] >= active["scaler_mean"][i] else "decrease",
        }
        for i in top_idx
    ]

    return {
        "predicted": bool(score > threshold),
        "anomalyScore": round(score, 6),
        "threshold": threshold,
        "modelVersion": active["pointer"]["version"],
        "model": active["pointer"]["model"],
        "runtime": "onnxruntime",
        "inferenceId": f"inf-{uuid.uuid4().hex[:12]}",
        "confidence": round(float(max(score, 1.0 - score)), 4),
        "machineId": payload.get("machineId"),
        "timestamp": payload.get("timestamp"),
        "explainability": {"topContributions": top},
    }, 200


# ─── Flask App ────────────────────────────────────────────────

app = Flask(__name__)


@app.route("/health", methods=["GET"])
def health():
    active = get_active()
    return jsonify({
        "status": "ok",
        "modelVersion": active["pointer"]["version"],
        "model": active["pointer"]["model"],
        "runtime": "onnxruntime",
        "features": len(active["metadata"].get("features", [])),
        "threshold": active["metadata"].get("threshold"),
    })


@app.route("/infer", methods=["POST"])
def infer():
    payload = request.get_json(force=True, silent=True) or {}
    result, status = run_inference(payload)
    return jsonify(result), status


@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "iso50001-ml-inference",
        "runtime": "onnxruntime",
        "status": "running",
        "endpoints": ["/health", "/infer"],
    })


if __name__ == "__main__":
    load_active_model()
    port = int(os.environ.get("PORT", 5577))
    print(f"[ml] Starting ONNX inference server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
