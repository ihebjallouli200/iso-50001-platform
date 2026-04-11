#!/usr/bin/env python3

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.preprocessing import StandardScaler
from torch.utils.data import DataLoader, TensorDataset


FEATURES = [
    "kwh",
    "kva",
    "cos_phi",
    "thd_v",
    "thd_i",
    "harm_3",
    "harm_5",
    "harm_7",
    "output_pieces",
    "output_tonnage",
    "etat",
    "oee",
]


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


def parse_args():
    p = argparse.ArgumentParser(description="Sequential anomaly benchmark with Torch (LSTM/Transformer)")
    p.add_argument("--dataset", default="data/processed/machine_telemetry_1min_12m.csv")
    p.add_argument("--max-rows", type=int, default=180000)
    p.add_argument("--seq-len", type=int, default=30)
    p.add_argument("--stride", type=int, default=3)
    p.add_argument("--max-sequences", type=int, default=120000)
    p.add_argument("--epochs", type=int, default=6)
    p.add_argument("--batch-size", type=int, default=256)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--report", default="reports/ai_anomaly_sequential_benchmark.json")
    p.add_argument("--update-main-report", action="store_true")
    return p.parse_args()


def load_df(path: Path, max_rows: int) -> pd.DataFrame:
    cols = ["timestamp", "machine_id", "label_anomalie"] + FEATURES
    df = pd.read_csv(path, usecols=cols)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for c in FEATURES + ["label_anomalie"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["timestamp"] + FEATURES + ["label_anomalie"])
    df["label_anomalie"] = (df["label_anomalie"] > 0).astype(int)
    df = df.sort_values(["timestamp", "machine_id"]).reset_index(drop=True)
    if max_rows and len(df) > max_rows:
        df = df.iloc[-max_rows:].copy().reset_index(drop=True)
    return df


def build_sequences(df: pd.DataFrame, seq_len: int, stride: int, max_sequences: int):
    seqs = []
    ys = []
    ts = []
    for _, g in df.groupby("machine_id", sort=False):
        g = g.sort_values("timestamp").reset_index(drop=True)
        x = g[FEATURES].to_numpy(dtype=np.float32)
        y = g["label_anomalie"].to_numpy(dtype=np.int64)
        t = g["timestamp"].to_numpy()
        start = seq_len - 1
        for i in range(start, len(g), stride):
            seqs.append(x[i - seq_len + 1 : i + 1])
            ys.append(y[i])
            ts.append(t[i])
            if max_sequences and len(seqs) >= max_sequences:
                break
        if max_sequences and len(seqs) >= max_sequences:
            break

    X = np.asarray(seqs, dtype=np.float32)
    y = np.asarray(ys, dtype=np.int64)
    ts = np.asarray(ts)
    return X, y, ts


def chrono_split(X: np.ndarray, y: np.ndarray, ts: np.ndarray):
    idx = np.argsort(ts)
    X = X[idx]
    y = y[idx]
    n = len(X)
    i1 = int(0.7 * n)
    i2 = int(0.85 * n)
    return (X[:i1], y[:i1]), (X[i1:i2], y[i1:i2]), (X[i2:], y[i2:])


def scale_sequences(X_train, X_val, X_test):
    scaler = StandardScaler()
    tr_shape = X_train.shape
    va_shape = X_val.shape
    te_shape = X_test.shape

    X_train_2d = X_train.reshape(-1, tr_shape[-1])
    scaler.fit(X_train_2d)
    X_train_s = scaler.transform(X_train_2d).reshape(tr_shape).astype(np.float32)
    X_val_s = scaler.transform(X_val.reshape(-1, va_shape[-1])).reshape(va_shape).astype(np.float32)
    X_test_s = scaler.transform(X_test.reshape(-1, te_shape[-1])).reshape(te_shape).astype(np.float32)
    return X_train_s, X_val_s, X_test_s, scaler


def make_loader(X, y, batch_size: int, shuffle: bool):
    ds = TensorDataset(torch.from_numpy(X), torch.from_numpy(y.astype(np.float32)))
    return DataLoader(ds, batch_size=batch_size, shuffle=shuffle)


def train_model(model, train_loader, val_loader, epochs: int, lr: float, pos_weight: float, device: torch.device):
    model = model.to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    criterion = nn.BCEWithLogitsLoss(pos_weight=torch.tensor([pos_weight], dtype=torch.float32, device=device))

    best_state = None
    best_val_loss = float("inf")

    for _ in range(epochs):
        model.train()
        for xb, yb in train_loader:
            xb = xb.to(device)
            yb = yb.to(device)
            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()

        model.eval()
        val_losses = []
        with torch.no_grad():
            for xb, yb in val_loader:
                xb = xb.to(device)
                yb = yb.to(device)
                logits = model(xb)
                loss = criterion(logits, yb)
                val_losses.append(float(loss.item()))
        val_loss = float(np.mean(val_losses)) if val_losses else float("inf")
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)
    return model


def predict_probs(model, X: np.ndarray, batch_size: int, device: torch.device) -> np.ndarray:
    loader = DataLoader(TensorDataset(torch.from_numpy(X), torch.zeros(len(X))), batch_size=batch_size, shuffle=False)
    model.eval()
    preds = []
    with torch.no_grad():
        for xb, _ in loader:
            xb = xb.to(device)
            logits = model(xb)
            probs = torch.sigmoid(logits)
            preds.append(probs.detach().cpu().numpy())
    return np.concatenate(preds)


def calibrate_threshold(y_val: np.ndarray, p_val: np.ndarray, precision_min: float = 0.6) -> Tuple[float, Dict]:
    thrs = np.quantile(p_val, np.linspace(0.01, 0.99, 150))
    best_thr = float(np.median(thrs))
    best = {"precision": 0.0, "recall": 0.0, "f1": -1.0}
    feasible = False

    for thr in np.unique(thrs):
        pred = (p_val > thr).astype(int)
        precision = float(precision_score(y_val, pred, zero_division=0))
        recall = float(recall_score(y_val, pred, zero_division=0))
        f1 = float(f1_score(y_val, pred, zero_division=0))
        if precision >= precision_min:
            if (not feasible) or (recall > best["recall"]) or (np.isclose(recall, best["recall"]) and f1 > best["f1"]):
                feasible = True
                best_thr = float(thr)
                best = {"precision": precision, "recall": recall, "f1": f1}
        elif not feasible and f1 > best["f1"]:
            best_thr = float(thr)
            best = {"precision": precision, "recall": recall, "f1": f1}

    return best_thr, best


def evaluate(y_true: np.ndarray, probs: np.ndarray, thr: float) -> Dict:
    pred = (probs > thr).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    roc_auc = float(roc_auc_score(y_true, probs)) if len(np.unique(y_true)) > 1 else 0.0
    return {
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1_score": float(f1_score(y_true, pred, zero_division=0)),
        "roc_auc": roc_auc,
        "samples": int(len(y_true)),
        "anomaly_rate": float(y_true.mean()),
        "true_negatives": int(tn),
        "false_positives": int(fp),
        "false_negatives": int(fn),
        "true_positives": int(tp),
    }


def run_one_model(name: str, model, X_train, y_train, X_val, y_val, X_test, y_test, args, device):
    pos_weight = float((len(y_train) - y_train.sum()) / max(y_train.sum(), 1))
    train_loader = make_loader(X_train, y_train, args.batch_size, shuffle=True)
    val_loader = make_loader(X_val, y_val, args.batch_size, shuffle=False)
    model = train_model(model, train_loader, val_loader, args.epochs, args.lr, pos_weight=pos_weight, device=device)

    p_val = predict_probs(model, X_val, args.batch_size, device)
    thr, cal = calibrate_threshold(y_val, p_val, precision_min=0.6)
    p_test = predict_probs(model, X_test, args.batch_size, device)
    metrics = evaluate(y_test, p_test, thr)

    return {
        "model": name,
        "threshold": float(thr),
        "calibration": cal,
        "metrics": metrics,
        "state_dict": {k: v.detach().cpu().clone() for k, v in model.state_dict().items()},
    }


def export_selected_artifacts(root: Path, selected: Dict, scaler: StandardScaler, seq_len: int, stride: int) -> Dict:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    version = f"v{ts}_{selected['model']}"
    artifact_dir = root / "ml_pipeline" / "models" / "anomaly_sequential" / version
    artifact_dir.mkdir(parents=True, exist_ok=True)

    model_path = artifact_dir / "model.pt"
    torch.save(selected["state_dict"], model_path)

    scaler_path = artifact_dir / "scaler_stats.npz"
    np.savez(
        scaler_path,
        mean=getattr(scaler, "mean_", np.zeros(len(FEATURES), dtype=np.float64)),
        scale=getattr(scaler, "scale_", np.ones(len(FEATURES), dtype=np.float64)),
    )

    metadata = {
        "version": version,
        "model": selected["model"],
        "threshold": float(selected["threshold"]),
        "features": FEATURES,
        "sequence": {
            "seq_len": int(seq_len),
            "stride": int(stride),
        },
        "metrics": selected["metrics"],
        "calibration": selected["calibration"],
        "precision_constraint": 0.6,
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    with (artifact_dir / "metadata.json").open("w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    pointer = {
        "version": version,
        "artifact_dir": str(artifact_dir.relative_to(root).as_posix()),
        "model": selected["model"],
        "threshold": float(selected["threshold"]),
        "features": FEATURES,
        "seq_len": int(seq_len),
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "backend_activation_status": "ready",
    }
    pointer_path = root / "ml_pipeline" / "models" / "anomaly_sequential" / "selected_latest.json"
    with pointer_path.open("w", encoding="utf-8") as f:
        json.dump(pointer, f, indent=2)

    return pointer


def main():
    args = parse_args()
    np.random.seed(42)
    torch.manual_seed(42)

    root = Path(__file__).resolve().parents[1]
    df = load_df(root / args.dataset, max_rows=args.max_rows)

    X, y, ts = build_sequences(df, seq_len=args.seq_len, stride=args.stride, max_sequences=args.max_sequences)
    (X_train, y_train), (X_val, y_val), (X_test, y_test) = chrono_split(X, y, ts)
    X_train, X_val, X_test, scaler = scale_sequences(X_train, X_val, X_test)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    lstm = LSTMClassifier(input_dim=X_train.shape[-1], hidden_dim=64)
    trf = TransformerClassifier(input_dim=X_train.shape[-1], d_model=64, nhead=4, num_layers=2)

    lstm_res = run_one_model("lstm_classifier", lstm, X_train, y_train, X_val, y_val, X_test, y_test, args, device)
    trf_res = run_one_model("transformer_classifier", trf, X_train, y_train, X_val, y_val, X_test, y_test, args, device)

    candidates = [lstm_res, trf_res]

    feasible = [c for c in candidates if c["metrics"]["precision"] >= 0.6]
    if feasible:
        best = sorted(feasible, key=lambda c: (c["metrics"]["recall"], c["metrics"]["f1_score"]), reverse=True)[0]
    else:
        best = sorted(candidates, key=lambda c: c["metrics"]["f1_score"], reverse=True)[0]

    exported_artifacts = export_selected_artifacts(root, best, scaler, args.seq_len, args.stride)

    report = {
        "task": "anomaly_sequential_benchmark",
        "status": "completed",
        "dataset": str(args.dataset),
        "sequence_setup": {
            "seq_len": args.seq_len,
            "stride": args.stride,
            "max_sequences": args.max_sequences,
        },
        "splits": {
            "train": int(len(X_train)),
            "val": int(len(X_val)),
            "test": int(len(X_test)),
        },
        "models": [lstm_res, trf_res],
        "selected": best,
        "exported_artifacts": exported_artifacts,
        "targets": {"precision_min": 0.6, "recall_min": 0.85},
        "pass": {
            "precision": bool(best["metrics"]["precision"] >= 0.6),
            "recall": bool(best["metrics"]["recall"] >= 0.85),
        },
    }

    for model_item in report["models"]:
        model_item.pop("state_dict", None)
    report["selected"].pop("state_dict", None)

    report_path = root / args.report
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    if args.update_main_report:
        main_report = {
            "task": "anomaly_detection_and_drift",
            "status": "completed",
            "dataset": "machine_telemetry_1min_12m.csv",
            "approach": {
                "primary": "sequential_benchmark_winner",
                "secondary": best["model"],
                "fusion": "threshold_calibrated_precision_constraint",
            },
            "fit": {
                "threshold": best["threshold"],
                "val_best_f1": best["calibration"]["f1"],
                "val_precision": best["calibration"]["precision"],
                "val_recall": best["calibration"]["recall"],
                "val_samples": int(len(X_val)),
            },
            "metrics": best["metrics"],
            "targets": {
                "precision_min": 0.6,
                "recall_min": 0.85,
            },
            "pass": {
                "precision": bool(best["metrics"]["precision"] >= 0.6),
                "recall": bool(best["metrics"]["recall"] >= 0.85),
            },
        }
        with (root / "reports" / "ai_anomaly_validation.json").open("w", encoding="utf-8") as f:
            json.dump(main_report, f, indent=2)

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
