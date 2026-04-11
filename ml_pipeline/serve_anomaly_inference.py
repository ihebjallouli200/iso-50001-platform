#!/usr/bin/env python3

import argparse
import json
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import torch
import torch.nn as nn


class LSTMClassifier(nn.Module):
    def __init__(self, input_dim: int, hidden_dim: int = 64):
        super().__init__()
        self.lstm = nn.LSTM(input_size=input_dim, hidden_size=hidden_dim, num_layers=1, batch_first=True)
        self.head = nn.Sequential(nn.Linear(hidden_dim, 32), nn.ReLU(), nn.Dropout(0.2), nn.Linear(32, 1))

    def forward(self, x):
        out, _ = self.lstm(x)
        x_last = out[:, -1, :]
        return self.head(x_last).squeeze(1)


class TransformerClassifier(nn.Module):
    def __init__(self, input_dim: int, d_model: int = 64, nhead: int = 4, num_layers: int = 2):
        super().__init__()
        self.proj = nn.Linear(input_dim, d_model)
        self.pos_emb = nn.Parameter(torch.randn(1, 256, d_model) * 0.01)
        enc_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=128,
            dropout=0.2,
            batch_first=True,
            activation="gelu",
        )
        self.encoder = nn.TransformerEncoder(enc_layer, num_layers=num_layers)
        self.head = nn.Sequential(nn.Linear(d_model, 32), nn.ReLU(), nn.Dropout(0.2), nn.Linear(32, 1))

    def forward(self, x):
        z = self.proj(x)
        z = z + self.pos_emb[:, : z.shape[1], :]
        z = self.encoder(z)
        z = z.mean(dim=1)
        return self.head(z).squeeze(1)


def load_active_model(root: Path):
    pointer_path = root / "ml_pipeline" / "models" / "anomaly_sequential" / "selected_latest.json"
    with pointer_path.open("r", encoding="utf-8") as f:
        pointer = json.load(f)

    artifact_dir = root / pointer["artifact_dir"]
    metadata_path = artifact_dir / "metadata.json"
    model_path = artifact_dir / "model.pt"
    scaler_path = artifact_dir / "scaler_stats.npz"

    with metadata_path.open("r", encoding="utf-8") as f:
        metadata = json.load(f)

    scaler_npz = np.load(scaler_path)
    scaler_mean = scaler_npz["mean"].astype(np.float32)
    scaler_scale = scaler_npz["scale"].astype(np.float32)

    model_name = str(metadata.get("model", pointer.get("model", "lstm_classifier")))
    input_dim = len(metadata.get("features", pointer.get("features", [])))
    if model_name == "transformer_classifier":
        model = TransformerClassifier(input_dim=input_dim)
    else:
        model = LSTMClassifier(input_dim=input_dim)

    state_dict = torch.load(model_path, map_location="cpu")
    model.load_state_dict(state_dict)
    model.eval()

    return {
        "root": root,
        "pointer": pointer,
        "metadata": metadata,
        "model": model,
        "scaler_mean": scaler_mean,
        "scaler_scale": np.where(scaler_scale == 0, 1.0, scaler_scale),
    }


def reload_if_pointer_changed(active: Dict) -> Dict:
    root = active["root"]
    pointer_path = root / "ml_pipeline" / "models" / "anomaly_sequential" / "selected_latest.json"
    with pointer_path.open("r", encoding="utf-8") as f:
        latest_pointer = json.load(f)

    current_version = str(active.get("pointer", {}).get("version", ""))
    latest_version = str(latest_pointer.get("version", ""))
    if current_version == latest_version:
        return active
    return load_active_model(root)


def validate_payload(payload: Dict, feature_count: int, seq_len: int) -> Tuple[bool, str]:
    has_sequence = isinstance(payload.get("sequence"), list) and len(payload["sequence"]) > 0
    has_features = isinstance(payload.get("features"), list) and len(payload["features"]) == feature_count

    if not has_sequence and not has_features:
        return False, "sequence_or_features_required"

    if has_sequence:
        sequence = payload["sequence"]
        if len(sequence) < seq_len:
            return False, "sequence_too_short"
        for row in sequence:
            if not isinstance(row, list) or len(row) != feature_count:
                return False, "sequence_shape_invalid"

    return True, "ok"


def payload_to_sequence(payload: Dict, feature_count: int, seq_len: int) -> np.ndarray:
    if isinstance(payload.get("sequence"), list) and len(payload["sequence"]) > 0:
        seq = np.array(payload["sequence"][-seq_len:], dtype=np.float32)
        if seq.shape[0] < seq_len:
            pad = np.repeat(seq[:1, :], seq_len - seq.shape[0], axis=0)
            seq = np.vstack([pad, seq])
        return seq

    features = np.array(payload.get("features", []), dtype=np.float32).reshape(1, feature_count)
    return np.repeat(features, seq_len, axis=0)


def infer(active, payload: Dict) -> Dict:
    pointer = active["pointer"]
    metadata = active["metadata"]
    model = active["model"]
    scaler_mean = active["scaler_mean"]
    scaler_scale = active["scaler_scale"]

    features = metadata.get("features", pointer.get("features", []))
    seq_len = int(metadata.get("sequence", {}).get("seq_len", pointer.get("seq_len", 30)))
    feature_count = len(features)

    ok, code = validate_payload(payload, feature_count, seq_len)
    if not ok:
        return {"error": code}

    sequence = payload_to_sequence(payload, feature_count, seq_len)
    scaled = (sequence - scaler_mean.reshape(1, -1)) / scaler_scale.reshape(1, -1)
    tensor = torch.from_numpy(scaled.astype(np.float32)).unsqueeze(0)

    with torch.no_grad():
        logits = model(tensor)
        score = float(torch.sigmoid(logits).item())

    threshold = float(metadata.get("threshold", pointer.get("threshold", 0.5)))
    predicted = bool(score > threshold)

    last_row_abs = np.abs(scaled[-1])
    ranked = np.argsort(-last_row_abs)[:3]
    top = [
        {
            "variable": str(features[idx]),
            "contribution": float(last_row_abs[idx] / (last_row_abs.sum() + 1e-6)),
            "direction": "increase" if float(sequence[-1, idx]) >= float(scaler_mean[idx]) else "decrease",
        }
        for idx in ranked
    ]

    return {
        "predicted": predicted,
        "anomalyScore": score,
        "threshold": threshold,
        "modelVersion": str(pointer.get("version")),
        "model": str(pointer.get("model")),
        "inferenceId": f"inf-{uuid.uuid4().hex[:12]}",
        "confidence": float(max(score, 1.0 - score)),
        "machineId": payload.get("machineId"),
        "timestamp": payload.get("timestamp"),
        "explainability": {
            "topContributions": top,
        },
    }


class InferenceHandler(BaseHTTPRequestHandler):
    active = None

    def _write_json(self, status: int, payload: Dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._write_json(200, {"status": "ok", "modelVersion": self.active["pointer"].get("version")})
            return
        self._write_json(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/infer":
            self._write_json(404, {"error": "not_found"})
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self._write_json(400, {"error": "invalid_json"})
            return

        self.active = reload_if_pointer_changed(self.active)
        result = infer(self.active, payload)
        if "error" in result:
            self._write_json(400, result)
            return
        self._write_json(200, result)


def parse_args():
    parser = argparse.ArgumentParser(description="Serve sequential anomaly inference over HTTP")
    parser.add_argument("--port", type=int, default=5577)
    return parser.parse_args()


def main():
    args = parse_args()
    root = Path(__file__).resolve().parents[1]
    active = load_active_model(root)

    InferenceHandler.active = active
    server = ThreadingHTTPServer(("127.0.0.1", int(args.port)), InferenceHandler)
    print(json.dumps({"status": "ready", "port": int(args.port), "modelVersion": active["pointer"].get("version")}))
    server.serve_forever()


if __name__ == "__main__":
    main()
