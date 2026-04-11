#!/usr/bin/env python3

import argparse
import importlib
import json
import pickle
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.ensemble import IsolationForest
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import MinMaxScaler, StandardScaler

try:
    tf = importlib.import_module("tensorflow")
    keras = importlib.import_module("tensorflow.keras")
    layers = importlib.import_module("tensorflow.keras.layers")
    Adam = importlib.import_module("tensorflow.keras.optimizers").Adam
    TENSORFLOW_AVAILABLE = True
except Exception:
    tf = None
    keras = None
    layers = None
    Adam = None
    TENSORFLOW_AVAILABLE = False


FEATURE_COLUMNS = [
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

SEQUENTIAL_FEATURES = [
    "kwh_lag_1",
    "kwh_lag_5_mean",
    "kwh_delta_1",
    "cos_phi_lag_1",
    "thd_i_lag_1",
    "thd_v_lag_1",
    "oee_lag_1",
    "kwh_roll_15_mean",
    "kwh_roll_15_std",
]


class HybridAnomalyTrainer:
    def __init__(self, random_seed: int = 42):
        self.random_seed = random_seed
        self.scaler = StandardScaler()
        self.ae_model = None
        self.iforest = None
        self.fusion_classifier = None
        self.threshold = 0.0

        np.random.seed(random_seed)
        if TENSORFLOW_AVAILABLE:
            tf.random.set_seed(random_seed)

    @staticmethod
    def _split_by_time(df: pd.DataFrame, train_ratio: float = 0.7, val_ratio: float = 0.15):
        n = len(df)
        train_end = int(n * train_ratio)
        val_end = int(n * (train_ratio + val_ratio))
        return df.iloc[:train_end].copy(), df.iloc[train_end:val_end].copy(), df.iloc[val_end:].copy()

    def load_dataset(self, csv_path: Path, max_rows: int = 0) -> pd.DataFrame:
        columns = ["timestamp", "machine_id", "label_anomalie"] + FEATURE_COLUMNS
        df = pd.read_csv(csv_path, usecols=columns)
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
        df = df.dropna(subset=["timestamp"]).sort_values(["timestamp", "machine_id"])
        for col in FEATURE_COLUMNS + ["label_anomalie"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=FEATURE_COLUMNS + ["label_anomalie"])
        df["label_anomalie"] = (df["label_anomalie"] > 0).astype(int)
        if max_rows and len(df) > max_rows:
            df = df.iloc[-max_rows:].copy()
        return df

    def _add_sequential_features(self, df: pd.DataFrame) -> pd.DataFrame:
        out = df.copy()

        def per_machine(group: pd.DataFrame) -> pd.DataFrame:
            g = group.sort_values("timestamp").copy()

            g["kwh_lag_1"] = g["kwh"].shift(1)
            g["kwh_lag_5_mean"] = g["kwh"].shift(1).rolling(window=5, min_periods=1).mean()
            g["kwh_delta_1"] = g["kwh"] - g["kwh"].shift(1)
            g["cos_phi_lag_1"] = g["cos_phi"].shift(1)
            g["thd_i_lag_1"] = g["thd_i"].shift(1)
            g["thd_v_lag_1"] = g["thd_v"].shift(1)
            g["oee_lag_1"] = g["oee"].shift(1)
            g["kwh_roll_15_mean"] = g["kwh"].shift(1).rolling(window=15, min_periods=1).mean()
            g["kwh_roll_15_std"] = g["kwh"].shift(1).rolling(window=15, min_periods=2).std()

            return g

        out = out.groupby("machine_id", group_keys=False).apply(per_machine)
        if "machine_id" not in out.columns:
            out = out.reset_index()
            if "level_0" in out.columns:
                out = out.drop(columns=["level_0"])
        out[SEQUENTIAL_FEATURES] = out[SEQUENTIAL_FEATURES].bfill().ffill().fillna(0.0)
        return out

    def build_autoencoder(self, input_dim: int):
        if TENSORFLOW_AVAILABLE:
            input_layer = layers.Input(shape=(input_dim,))
            encoded = layers.Dense(64, activation="relu")(input_layer)
            encoded = layers.Dense(32, activation="relu")(encoded)
            latent = layers.Dense(16, activation="relu")(encoded)
            decoded = layers.Dense(32, activation="relu")(latent)
            decoded = layers.Dense(64, activation="relu")(decoded)
            output_layer = layers.Dense(input_dim, activation="linear")(decoded)
            model = keras.Model(inputs=input_layer, outputs=output_layer)
            model.compile(optimizer=Adam(learning_rate=0.001), loss="mse")
            self.ae_model = model
        else:
            self.ae_model = MLPRegressor(
                hidden_layer_sizes=(64, 32, 16, 32, 64),
                activation="relu",
                solver="adam",
                random_state=self.random_seed,
                max_iter=100,
                early_stopping=True,
            )

    def fit_autoencoder(self, x_train_normal: np.ndarray, epochs: int, batch_size: int):
        if TENSORFLOW_AVAILABLE:
            self.ae_model.fit(
                x_train_normal,
                x_train_normal,
                epochs=epochs,
                batch_size=batch_size,
                validation_split=0.1,
                verbose=0,
            )
        else:
            self.ae_model.fit(x_train_normal, x_train_normal)

    def reconstruction_error(self, x: np.ndarray) -> np.ndarray:
        if TENSORFLOW_AVAILABLE:
            recon = self.ae_model.predict(x, verbose=0)
        else:
            recon = self.ae_model.predict(x)
        return np.mean(np.abs(x - recon), axis=1)

    def _normalize_score(self, values: np.ndarray) -> np.ndarray:
        values_2d = values.reshape(-1, 1)
        return MinMaxScaler().fit_transform(values_2d).ravel()

    def fit(self, train_df: pd.DataFrame, val_df: pd.DataFrame, ae_weight: float = 0.7) -> Dict:
        machine_train = train_df["machine_id"].to_numpy(dtype=np.float32).reshape(-1, 1)
        machine_val = val_df["machine_id"].to_numpy(dtype=np.float32).reshape(-1, 1)

        train_df = self._add_sequential_features(train_df)
        val_df = self._add_sequential_features(val_df)

        model_features = FEATURE_COLUMNS + SEQUENTIAL_FEATURES
        x_train = train_df[model_features].to_numpy(dtype=float)
        x_val = val_df[model_features].to_numpy(dtype=float)
        y_train = train_df["label_anomalie"].to_numpy(dtype=int)
        y_val = val_df["label_anomalie"].to_numpy(dtype=int)

        x_train_scaled = self.scaler.fit_transform(x_train)
        x_val_scaled = self.scaler.transform(x_val)

        train_norm_mask = train_df["label_anomalie"].to_numpy(dtype=int) == 0
        x_train_normal = x_train_scaled[train_norm_mask]

        self.build_autoencoder(x_train_scaled.shape[1])
        self.fit_autoencoder(x_train_normal, epochs=25, batch_size=256)

        self.iforest = IsolationForest(
            n_estimators=250,
            contamination=0.05,
            random_state=self.random_seed,
            n_jobs=-1,
        )
        self.iforest.fit(x_train_normal)

        ae_val = self.reconstruction_error(x_val_scaled)
        if_val = -self.iforest.decision_function(x_val_scaled)

        ae_train = self.reconstruction_error(x_train_scaled)
        if_train = -self.iforest.decision_function(x_train_scaled)
        ae_train_n = self._normalize_score(ae_train)
        if_train_n = self._normalize_score(if_train)
        ae_val_n = self._normalize_score(ae_val)
        if_val_n = self._normalize_score(if_val)

        fusion_train = np.column_stack([x_train_scaled, machine_train, ae_train_n, if_train_n]).astype(np.float32)
        fusion_val = np.column_stack([x_val_scaled, machine_val, ae_val_n, if_val_n]).astype(np.float32)

        self.fusion_classifier = HistGradientBoostingClassifier(
            learning_rate=0.05,
            max_depth=8,
            max_iter=400,
            min_samples_leaf=40,
            random_state=self.random_seed,
        )
        sample_weight = np.where(y_train == 1, 5.0, 1.0).astype(np.float32)
        self.fusion_classifier.fit(fusion_train, y_train, sample_weight=sample_weight)
        combined_val = self.fusion_classifier.predict_proba(fusion_val)[:, 1]

        thresholds = np.quantile(combined_val, np.linspace(0.01, 0.99, 140))
        best_threshold = float(np.median(thresholds))
        best_f1 = -1.0
        best_precision = 0.0
        best_recall = 0.0
        feasible_found = False

        for thr in np.unique(thresholds):
            pred = (combined_val > thr).astype(int)
            precision = precision_score(y_val, pred, zero_division=0)
            recall = recall_score(y_val, pred, zero_division=0)
            f1 = f1_score(y_val, pred, zero_division=0)

            if precision >= 0.60:
                if (not feasible_found) or (recall > best_recall) or (np.isclose(recall, best_recall) and f1 > best_f1):
                    feasible_found = True
                    best_f1 = float(f1)
                    best_threshold = float(thr)
                    best_precision = float(precision)
                    best_recall = float(recall)
            elif not feasible_found and f1 > best_f1:
                best_f1 = float(f1)
                best_threshold = float(thr)
                best_precision = float(precision)
                best_recall = float(recall)

        self.threshold = best_threshold
        return {
            "threshold": self.threshold,
            "val_best_f1": float(best_f1),
            "val_precision": best_precision,
            "val_recall": best_recall,
            "val_samples": int(len(val_df)),
        }

    def evaluate(self, test_df: pd.DataFrame, ae_weight: float = 0.7) -> Dict:
        machine_test = test_df["machine_id"].to_numpy(dtype=np.float32).reshape(-1, 1)

        test_df = self._add_sequential_features(test_df)
        model_features = FEATURE_COLUMNS + SEQUENTIAL_FEATURES
        x_test = test_df[model_features].to_numpy(dtype=float)
        y_test = test_df["label_anomalie"].to_numpy(dtype=int)
        x_test_scaled = self.scaler.transform(x_test)

        ae_score = self.reconstruction_error(x_test_scaled)
        if_score = -self.iforest.decision_function(x_test_scaled)
        ae_norm = self._normalize_score(ae_score)
        if_norm = self._normalize_score(if_score)

        if self.fusion_classifier is not None:
            fusion_x = np.column_stack([x_test_scaled, machine_test, ae_norm, if_norm]).astype(np.float32)
            combined = self.fusion_classifier.predict_proba(fusion_x)[:, 1]
        else:
            combined = ae_weight * ae_norm + (1.0 - ae_weight) * if_norm
        y_pred = (combined > self.threshold).astype(int)

        tn, fp, fn, tp = confusion_matrix(y_test, y_pred, labels=[0, 1]).ravel()
        roc_auc = roc_auc_score(y_test, combined) if len(np.unique(y_test)) > 1 else 0.0

        return {
            "samples": int(len(y_test)),
            "anomaly_rate": float(y_test.mean()),
            "precision": float(precision_score(y_test, y_pred, zero_division=0)),
            "recall": float(recall_score(y_test, y_pred, zero_division=0)),
            "f1_score": float(f1_score(y_test, y_pred, zero_division=0)),
            "roc_auc": float(roc_auc),
            "true_negatives": int(tn),
            "false_positives": int(fp),
            "false_negatives": int(fn),
            "true_positives": int(tp),
        }

    def save(self, artifact_dir: Path, report_path: Path, fit_info: Dict, metrics: Dict):
        artifact_dir.mkdir(parents=True, exist_ok=True)
        report_path.parent.mkdir(parents=True, exist_ok=True)

        with (artifact_dir / "scaler.pkl").open("wb") as f:
            pickle.dump(self.scaler, f)
        with (artifact_dir / "isolation_forest.pkl").open("wb") as f:
            pickle.dump(self.iforest, f)
        if self.fusion_classifier is not None:
            with (artifact_dir / "fusion_classifier.pkl").open("wb") as f:
                pickle.dump(self.fusion_classifier, f)

        if TENSORFLOW_AVAILABLE:
            self.ae_model.save(artifact_dir / "autoencoder.keras")
            ae_model_kind = "tensorflow_dense_autoencoder"
        else:
            with (artifact_dir / "autoencoder_mlp.pkl").open("wb") as f:
                pickle.dump(self.ae_model, f)
            ae_model_kind = "sklearn_mlp_autoencoder"

        metadata = {
            "feature_columns": FEATURE_COLUMNS,
            "sequential_feature_columns": SEQUENTIAL_FEATURES,
            "threshold": float(self.threshold),
            "ae_weight": 0.7,
            "model_kind": ae_model_kind,
            "fusion_head": "hist_gradient_boosting_classifier",
            "fit": fit_info,
            "metrics": metrics,
            "generated_at": pd.Timestamp.now("UTC").isoformat(),
        }

        with (artifact_dir / "metadata.json").open("w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)

        report = {
            "task": "anomaly_detection_and_drift",
            "status": "completed",
            "dataset": "machine_telemetry_1min_12m.csv",
            "approach": {
                "primary": "autoencoder_reconstruction",
                "secondary": "isolation_forest",
                "fusion": "weighted_score",
            },
            "fit": fit_info,
            "metrics": metrics,
            "targets": {
                "precision_min": 0.60,
                "recall_min": 0.85,
            },
            "pass": {
                "precision": bool(metrics["precision"] >= 0.60),
                "recall": bool(metrics["recall"] >= 0.85),
            },
        }
        with report_path.open("w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)


def parse_args():
    parser = argparse.ArgumentParser(description="Train hybrid autoencoder + IsolationForest anomaly detector")
    parser.add_argument("--dataset", default="data/processed/machine_telemetry_1min_12m.csv")
    parser.add_argument("--max-rows", type=int, default=200000)
    parser.add_argument("--artifact-dir", default="ml_pipeline/models/anomaly")
    parser.add_argument("--report", default="reports/ai_anomaly_validation.json")
    return parser.parse_args()


def main():
    args = parse_args()
    trainer = HybridAnomalyTrainer(random_seed=42)

    dataset_path = Path(args.dataset)
    df = trainer.load_dataset(dataset_path, max_rows=args.max_rows)
    train_df, val_df, test_df = trainer._split_by_time(df)

    fit_info = trainer.fit(train_df, val_df)
    metrics = trainer.evaluate(test_df)
    trainer.save(Path(args.artifact_dir), Path(args.report), fit_info, metrics)

    print(json.dumps({"fit": fit_info, "metrics": metrics}, indent=2))


if __name__ == "__main__":
    main()
