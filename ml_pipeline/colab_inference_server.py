"""
ISO 50001 — ML Inference Server (Google Colab)
===============================================
Exécuter ce notebook dans Google Colab pour servir l'API d'inférence ML.
Le serveur sera accessible via un tunnel ngrok public.

Instructions:
1. Ouvrir dans Google Colab
2. Exécuter toutes les cellules
3. Copier l'URL ngrok affichée
4. Configurer ANOMALY_INFERENCE_URL sur Render avec cette URL
"""

# ─── Cell 1: Install dependencies ────────────────────────────
# !pip install flask pyngrok torch numpy -q

# ─── Cell 2: Clone repo and load model ───────────────────────
import os, json, uuid
import numpy as np
import torch
import torch.nn as nn
from flask import Flask, request, jsonify
from threading import Thread

# Clone the repo to get model files
if not os.path.exists("/content/iso-50001-platform"):
    os.system("git clone https://github.com/ihebjallouli200/iso-50001-platform.git /content/iso-50001-platform")
else:
    os.system("cd /content/iso-50001-platform && git pull")

REPO = "/content/iso-50001-platform"
ML_DIR = f"{REPO}/ml_pipeline"

# ─── Model Definitions ──────────────────────────────────────

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


# ─── Load Model ──────────────────────────────────────────────

pointer_path = f"{ML_DIR}/models/anomaly_sequential/selected_latest.json"
with open(pointer_path) as f:
    pointer = json.load(f)

artifact_dir = os.path.join(REPO, pointer["artifact_dir"])
with open(os.path.join(artifact_dir, "metadata.json")) as f:
    metadata = json.load(f)

scaler_npz = np.load(os.path.join(artifact_dir, "scaler_stats.npz"))
scaler_mean = scaler_npz["mean"].astype(np.float32)
scaler_scale = np.where(scaler_npz["scale"] == 0, 1.0, scaler_npz["scale"]).astype(np.float32)

model_name = metadata.get("model", "transformer_classifier")
input_dim = len(metadata.get("features", []))

if model_name == "transformer_classifier":
    model = TransformerClassifier(input_dim=input_dim)
else:
    model = LSTMClassifier(input_dim=input_dim)

state_dict = torch.load(os.path.join(artifact_dir, "model.pt"), map_location="cpu", weights_only=True)
model.load_state_dict(state_dict)
model.eval()

print(f"✅ Model loaded: {pointer['version']}")
print(f"   Type: {model_name}")
print(f"   Features: {input_dim}")
print(f"   Threshold: {metadata.get('threshold', 0.5)}")
print(f"   ROC AUC: {metadata.get('metrics', {}).get('roc_auc', 'N/A')}")


# ─── Flask App ────────────────────────────────────────────────

app = Flask(__name__)

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "runtime": "google_colab",
        "modelVersion": pointer["version"],
        "model": model_name,
        "features": input_dim,
        "threshold": metadata.get("threshold"),
        "roc_auc": metadata.get("metrics", {}).get("roc_auc"),
    })

@app.route("/infer", methods=["POST"])
def infer():
    payload = request.get_json(force=True, silent=True) or {}
    features_list = metadata.get("features", [])
    seq_len = int(metadata.get("sequence", {}).get("seq_len", 30))
    threshold = float(metadata.get("threshold", 0.5))

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

    # Scale + infer
    scaled = (seq - scaler_mean.reshape(1, -1)) / scaler_scale.reshape(1, -1)
    tensor = torch.from_numpy(scaled).unsqueeze(0)

    with torch.no_grad():
        logits = model(tensor)
        score = float(torch.sigmoid(logits).item())

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
        "model": model_name,
        "inferenceId": f"inf-{uuid.uuid4().hex[:12]}",
        "confidence": round(max(score, 1.0 - score), 4),
        "machineId": payload.get("machineId"),
        "timestamp": payload.get("timestamp"),
        "runtime": "google_colab",
        "explainability": {"topContributions": top},
    })

@app.route("/", methods=["GET"])
def index():
    return jsonify({
        "service": "iso50001-ml-inference",
        "runtime": "google_colab",
        "status": "running",
        "endpoints": ["/health", "/infer"],
    })


# ─── Start with ngrok ─────────────────────────────────────────

def run_flask():
    app.run(host="0.0.0.0", port=5577, debug=False, use_reloader=False)

# Start Flask in background thread
thread = Thread(target=run_flask, daemon=True)
thread.start()

import time
time.sleep(2)

# Start ngrok tunnel
from pyngrok import ngrok

# Set your ngrok auth token (free at https://dashboard.ngrok.com/get-started/your-authtoken)
# ngrok.set_auth_token("YOUR_NGROK_TOKEN")

public_url = ngrok.connect(5577, "http")
print("\n" + "=" * 60)
print("🚀 ML INFERENCE SERVER RUNNING!")
print("=" * 60)
print(f"\n   Public URL: {public_url}")
print(f"   Health:     {public_url}/health")
print(f"   Inference:  {public_url}/infer")
print(f"\n   📋 Set this on Render:")
print(f"   ANOMALY_INFERENCE_URL = {public_url}")
print("\n" + "=" * 60)

# Test
import urllib.request
response = urllib.request.urlopen(f"{public_url}/health")
print(f"\n✅ Self-test: {response.read().decode()}")
print("\n⏳ Keep this notebook running! Server will stop when session ends.")
