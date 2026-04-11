#!/usr/bin/env python3

import argparse
import importlib
import json
import pickle
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_absolute_percentage_error, mean_squared_error
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import MinMaxScaler

try:
    tf = importlib.import_module("tensorflow")
    Sequential = importlib.import_module("tensorflow.keras").Sequential
    tf_layers = importlib.import_module("tensorflow.keras.layers")
    Dense = tf_layers.Dense
    Dropout = tf_layers.Dropout
    LSTM = tf_layers.LSTM
    Adam = importlib.import_module("tensorflow.keras.optimizers").Adam
    TENSORFLOW_AVAILABLE = True
except Exception:
    tf = None
    Sequential = None
    Dense = None
    Dropout = None
    LSTM = None
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


class ForecastTrainer:
    def __init__(self, lookback: int, random_seed: int = 42, max_train_samples: int = 0):
        self.lookback = lookback
        self.random_seed = random_seed
        self.max_train_samples = max_train_samples
        np.random.seed(random_seed)
        if TENSORFLOW_AVAILABLE:
            tf.random.set_seed(random_seed)

    def load_dataset(self, csv_path: Path, max_rows: int = 0) -> pd.DataFrame:
        cols = ["timestamp", "machine_id", "kwh"] + FEATURE_COLUMNS
        df = pd.read_csv(csv_path, usecols=list(set(cols)))
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
        for col in FEATURE_COLUMNS:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["timestamp"] + FEATURE_COLUMNS).sort_values(["machine_id", "timestamp"])
        if max_rows and len(df) > max_rows:
            df = df.iloc[-max_rows:].copy()
        return df

    def make_sequences(self, df: pd.DataFrame, horizon: int):
        x_seq, y_target, y_naive, ts_target = [], [], [], []
        for _, machine_df in df.groupby("machine_id", sort=False):
            machine_df = machine_df.sort_values("timestamp").reset_index(drop=True)
            values = machine_df[FEATURE_COLUMNS].to_numpy(dtype=float)
            target = machine_df["kwh"].to_numpy(dtype=float)
            ts = machine_df["timestamp"].to_numpy()

            max_start = len(machine_df) - self.lookback - horizon + 1
            if max_start <= 0:
                continue
            for i in range(max_start):
                x_window = values[i : i + self.lookback]
                target_idx = i + self.lookback + horizon - 1
                x_seq.append(x_window)
                y_target.append(target[target_idx])
                y_naive.append(values[i + self.lookback - 1, FEATURE_COLUMNS.index("kwh")])
                ts_target.append(ts[target_idx])

        x = np.asarray(x_seq, dtype=np.float32)
        y = np.asarray(y_target, dtype=np.float32)
        naive = np.asarray(y_naive, dtype=np.float32)
        ts_target = np.asarray(ts_target)
        return x, y, naive, ts_target

    def chrono_split(self, x: np.ndarray, y: np.ndarray, naive: np.ndarray, ts_target: np.ndarray):
        order = np.argsort(ts_target)
        x, y, naive, ts_target = x[order], y[order], naive[order], ts_target[order]

        n = len(x)
        train_end = int(0.7 * n)
        val_end = int(0.85 * n)
        return {
            "train": (x[:train_end], y[:train_end], naive[:train_end]),
            "val": (x[train_end:val_end], y[train_end:val_end], naive[train_end:val_end]),
            "test": (x[val_end:], y[val_end:], naive[val_end:]),
        }

    def _fit_scalers(self, x_train: np.ndarray, y_train: np.ndarray):
        x_scaler = MinMaxScaler()
        y_scaler = MinMaxScaler()
        x2d = x_train.reshape(-1, x_train.shape[-1])
        x_scaler.fit(x2d)
        y_scaler.fit(y_train.reshape(-1, 1))
        return x_scaler, y_scaler

    def _window_to_tabular_features(self, x_window: np.ndarray, horizon: int) -> np.ndarray:
        # Keep feature size compact to avoid memory spikes on long horizons.
        last = x_window[:, -1, :]
        mean = x_window.mean(axis=1)
        std = x_window.std(axis=1)

        kwh_idx = FEATURE_COLUMNS.index("kwh")
        oee_idx = FEATURE_COLUMNS.index("oee")
        cos_idx = FEATURE_COLUMNS.index("cos_phi")
        thdv_idx = FEATURE_COLUMNS.index("thd_v")

        kwh_series = x_window[:, :, kwh_idx]
        slope = (kwh_series[:, -1] - kwh_series[:, 0]) / max(self.lookback - 1, 1)
        kwh_min = kwh_series.min(axis=1)
        kwh_max = kwh_series.max(axis=1)

        oee_last = last[:, oee_idx]
        cos_last = last[:, cos_idx]
        thdv_last = last[:, thdv_idx]

        horizon_hours = np.full((len(x_window),), float(horizon) / 60.0, dtype=np.float32)

        tab = np.column_stack(
            [
                last,
                mean,
                std,
                slope,
                kwh_min,
                kwh_max,
                oee_last,
                cos_last,
                thdv_last,
                horizon_hours,
            ]
        ).astype(np.float32)
        return tab

    def _transform_x(self, x: np.ndarray, x_scaler: MinMaxScaler):
        shape = x.shape
        x2d = x.reshape(-1, shape[-1])
        x_scaled = x_scaler.transform(x2d)
        return x_scaled.reshape(shape)

    def build_lstm(self, input_shape: Tuple[int, int]):
        model = Sequential(
            [
                LSTM(64, input_shape=input_shape, return_sequences=True),
                Dropout(0.2),
                LSTM(32),
                Dense(16, activation="relu"),
                Dense(1),
            ]
        )
        model.compile(optimizer=Adam(learning_rate=0.001), loss="mse")
        return model

    def fit_predict_horizon(self, horizon: int, df: pd.DataFrame, artifact_root: Path) -> Dict:
        x, y, naive, ts = self.make_sequences(df, horizon=horizon)
        split = self.chrono_split(x, y, naive, ts)
        x_train, y_train, _ = split["train"]
        x_val, y_val, _ = split["val"]
        x_test, y_test, naive_test = split["test"]

        if self.max_train_samples and len(x_train) > self.max_train_samples:
            keep_idx = np.linspace(0, len(x_train) - 1, num=self.max_train_samples, dtype=int)
            x_train = x_train[keep_idx]
            y_train = y_train[keep_idx]

        x_scaler, y_scaler = self._fit_scalers(x_train, y_train)
        x_train_scaled = self._transform_x(x_train, x_scaler)
        x_val_scaled = self._transform_x(x_val, x_scaler)
        x_test_scaled = self._transform_x(x_test, x_scaler)

        x_train_tab = self._window_to_tabular_features(x_train_scaled, horizon)
        x_val_tab = self._window_to_tabular_features(x_val_scaled, horizon)
        x_test_tab = self._window_to_tabular_features(x_test_scaled, horizon)

        y_train_scaled = y_scaler.transform(y_train.reshape(-1, 1)).ravel()
        y_val_scaled = y_scaler.transform(y_val.reshape(-1, 1)).ravel()

        horizon_dir = artifact_root / f"h{horizon}m"
        horizon_dir.mkdir(parents=True, exist_ok=True)

        if TENSORFLOW_AVAILABLE:
            model = self.build_lstm((x_train_scaled.shape[1], x_train_scaled.shape[2]))
            model.fit(
                x_train_scaled,
                y_train_scaled,
                validation_data=(x_val_scaled, y_val_scaled),
                epochs=12,
                batch_size=256,
                verbose=0,
            )
            y_pred_scaled = model.predict(x_test_scaled, verbose=0).ravel()
            model.save(horizon_dir / "lstm.keras")
            model_kind = "tensorflow_lstm"
        else:
            ann_model = MLPRegressor(
                hidden_layer_sizes=(128, 64, 32),
                random_state=self.random_seed,
                max_iter=80,
                early_stopping=True,
            )
            gbr_model = HistGradientBoostingRegressor(
                learning_rate=0.05,
                max_depth=10,
                max_iter=300,
                min_samples_leaf=40,
                random_state=self.random_seed,
            )

            ann_model.fit(x_train_tab, y_train_scaled)
            gbr_model.fit(x_train_tab, y_train_scaled)

            val_pred_ann = ann_model.predict(x_val_tab).ravel()
            val_pred_gbr = gbr_model.predict(x_val_tab).ravel()
            val_ann = mean_absolute_percentage_error(y_val_scaled, val_pred_ann)
            val_gbr = mean_absolute_percentage_error(y_val_scaled, val_pred_gbr)

            if val_gbr <= val_ann:
                y_pred_scaled = gbr_model.predict(x_test_tab).ravel()
                with (horizon_dir / "gbr_fallback.pkl").open("wb") as f:
                    pickle.dump(gbr_model, f)
                with (horizon_dir / "fallback_model_selection.json").open("w", encoding="utf-8") as f:
                    json.dump({"selected": "gbr", "val_mape_ann": float(val_ann), "val_mape_gbr": float(val_gbr)}, f, indent=2)
                model_kind = "sklearn_hist_gradient_boosting"
            else:
                y_pred_scaled = ann_model.predict(x_test_tab).ravel()
                with (horizon_dir / "ann_fallback.pkl").open("wb") as f:
                    pickle.dump(ann_model, f)
                with (horizon_dir / "fallback_model_selection.json").open("w", encoding="utf-8") as f:
                    json.dump({"selected": "ann", "val_mape_ann": float(val_ann), "val_mape_gbr": float(val_gbr)}, f, indent=2)
                model_kind = "sklearn_ann_fallback"

        y_pred = y_scaler.inverse_transform(y_pred_scaled.reshape(-1, 1)).ravel()
        mape = mean_absolute_percentage_error(y_test, y_pred)
        rmse = np.sqrt(mean_squared_error(y_test, y_pred))
        mae = mean_absolute_error(y_test, y_pred)
        mape_naive = mean_absolute_percentage_error(y_test, naive_test)

        with (horizon_dir / "x_scaler.pkl").open("wb") as f:
            pickle.dump(x_scaler, f)
        with (horizon_dir / "y_scaler.pkl").open("wb") as f:
            pickle.dump(y_scaler, f)

        return {
            "horizon_minutes": int(horizon),
            "model_kind": model_kind,
            "samples": {
                "train": int(len(x_train)),
                "val": int(len(x_val)),
                "test": int(len(x_test)),
            },
            "metrics": {
                "mape": float(mape),
                "rmse": float(rmse),
                "mae": float(mae),
                "mape_naive": float(mape_naive),
                "improvement_vs_naive_pct": float((mape_naive - mape) / max(mape_naive, 1e-8) * 100.0),
            },
        }


def parse_args():
    parser = argparse.ArgumentParser(description="Offline forecasting trainer (LSTM/ANN fallback)")
    parser.add_argument("--dataset", default="data/processed/machine_telemetry_1min_12m.csv")
    parser.add_argument("--max-rows", type=int, default=220000)
    parser.add_argument("--lookback", type=int, default=120)
    parser.add_argument("--horizons", nargs="*", type=int, default=[60, 360, 1440])
    parser.add_argument("--max-train-samples", type=int, default=50000)
    parser.add_argument("--artifact-dir", default="ml_pipeline/models/forecast")
    parser.add_argument("--report", default="reports/ai_forecast_validation.json")
    return parser.parse_args()


def main():
    args = parse_args()
    trainer = ForecastTrainer(lookback=args.lookback, random_seed=42, max_train_samples=args.max_train_samples)

    df = trainer.load_dataset(Path(args.dataset), max_rows=args.max_rows)
    artifact_root = Path(args.artifact_dir)
    artifact_root.mkdir(parents=True, exist_ok=True)

    horizon_results = []
    for horizon in args.horizons:
        horizon_results.append(trainer.fit_predict_horizon(horizon=horizon, df=df, artifact_root=artifact_root))

    targets = {"60": 0.06, "360": 0.08, "1440": 0.10}
    report = {
        "task": "consumption_forecasting",
        "status": "completed",
        "dataset": "machine_telemetry_1min_12m.csv",
        "lookback_minutes": args.lookback,
        "results": horizon_results,
        "targets_mape": targets,
        "pass": {
            str(r["horizon_minutes"]): bool(r["metrics"]["mape"] <= targets.get(str(r["horizon_minutes"]), 0.10))
            for r in horizon_results
        },
    }

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
