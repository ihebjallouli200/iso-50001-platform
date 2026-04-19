#!/usr/bin/env python3
"""
ML Inference Microservice for Render deployment.
Serves anomaly detection via REST API (Flask).
Loads the active Transformer model and scores sequences.
"""
import json
import os
import uuid
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from flask import Flask, request, jsonify

# ─── Model Definitions ───────────────────────────────────────

class LSTMClassifier(nn.Module):
    def __init__(self, input_dim, hidden_dim=64):
        super().__init__()
        self.lstm = nn.LSTM(input_size=input_dim, hidden_size=hidden_dim, num_layers=1, batch_first=True)
        self.head = nn.Sequential(nn.Linear(hidden_dim, 32), nn.ReLU(), nn.Dropout(0.2), nn.Linear(32, 1))

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.head(out[:, -1, :]).squeeze(1)


class TransformerClassifier(nn.Module):
    def __init__(self, input_dim, d_model=64, nhead=4, num_layers=2):
        super().__init__()
        self.proj = nn.Linear(input_dim, d_model)
        self.pos_emb = nn.Parameter(torch.randn(1, 256, d_model) * 0.01)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=nhead, dim_feedforward=128,
            dropout=0.2, batch_first=True, activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(enc_layer, num_layers=num_layers)
        self.head = nn.Sequential(nn.Linear(d_model, 32), nn.ReLU(), nn.Dropout(0.2), nn.Linear(32, 1))

    def forward(self, x):
        z = self.proj(x)
        z = z + self.pos_emb[:, :z.shape[1], :]
        z = self.encoder(z)
        return self.head(z.mean(dim=1)).squeeze(1)


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
    scaler_npz = np.load(artifact_dir / "scaler_stats.npz")
    scaler_mean = scaler_npz["mean"].astype(np.float32)
    scaler_scale = np.where(scaler_npz["scale"] == 0, 1.0, scaler_npz["scale"]).astype(np.float32)

    model_name = metadata.get("model", "transformer_classifier")
    input_dim = len(metadata.get("features", []))

    if model_name == "transformer_classifier":
        model = TransformerClassifier(input_dim=input_dim)
    else:
        model = LSTMClassifier(input_dim=input_dim)

    state_dict = torch.load(artifact_dir / "model.pt", map_location="cpu", weights_only=True)
    model.load_state_dict(state_dict)
    model.eval()

    _active = {
        "pointer": pointer,
        "metadata": metadata,
        "model": model,
        "scaler_mean": scaler_mean,
        "scaler_scale": scaler_scale,
    }
    print(f"[ml] Model loaded: {pointer['version']} ({model_name})")
    return _active


def get_active():
    global _active
    if _active is None:
        load_active_model()
    return _active


# ─── Inference Logic ──────────────────────────────────────────

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

    # Scale and infer
    scaled = (seq - active["scaler_mean"].reshape(1, -1)) / active["scaler_scale"].reshape(1, -1)
    tensor = torch.from_numpy(scaled).unsqueeze(0)

    with torch.no_grad():
        logits = active["model"](tensor)
        score = float(torch.sigmoid(logits).item())

    # Explainability
    last_abs = np.abs(scaled[-1])
    top_idx = np.argsort(-last_abs)[:3]
    top = [
        {
            "variable": features[i],
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
        "inferenceId": f"inf-{uuid.uuid4().hex[:12]}",
        "confidence": round(max(score, 1.0 - score), 4),
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
        "status": "running",
        "endpoints": ["/health", "/infer"],
    })


if __name__ == "__main__":
    load_active_model()
    port = int(os.environ.get("PORT", 5577))
    print(f"[ml] Starting inference server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
