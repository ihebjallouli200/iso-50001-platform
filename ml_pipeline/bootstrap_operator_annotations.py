#!/usr/bin/env python3

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


def parse_args():
    parser = argparse.ArgumentParser(description="Bootstrap operator annotations from synthetic telemetry")
    parser.add_argument("--dataset", default="data/processed/machine_telemetry_1min_12m.csv")
    parser.add_argument("--output", default="data/processed/operator_annotations.csv")
    parser.add_argument("--target-count", type=int, default=600)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def main():
    args = parse_args()
    np.random.seed(args.seed)

    dataset_path = Path(args.dataset)
    out_path = Path(args.output)

    df = pd.read_csv(dataset_path, usecols=["timestamp", "machine_id", "label_anomalie"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df["label_anomalie"] = pd.to_numeric(df["label_anomalie"], errors="coerce").fillna(0).astype(int)
    df = df.dropna(subset=["timestamp"]).sort_values(["timestamp", "machine_id"]).reset_index(drop=True)

    pos = df[df["label_anomalie"] == 1]
    neg = df[df["label_anomalie"] == 0]

    n_pos = min(len(pos), max(1, int(args.target_count * 0.6)))
    n_neg = min(len(neg), max(1, args.target_count - n_pos))

    pos_sample = pos.sample(n=n_pos, random_state=args.seed) if n_pos < len(pos) else pos
    neg_sample = neg.sample(n=n_neg, random_state=args.seed) if n_neg < len(neg) else neg

    ann = pd.concat([pos_sample, neg_sample], axis=0).sample(frac=1.0, random_state=args.seed).reset_index(drop=True)
    ann["event_key"] = ann.apply(lambda r: f"{r['machine_id']}|{pd.Timestamp(r['timestamp']).isoformat()}", axis=1)
    ann["operatorLabel"] = ann["label_anomalie"].map({1: "anomaly", 0: "normal"})
    ann["operatorId"] = "panel.synthetic.review"
    ann["comment"] = "Annotation operationnelle simulee pour validation IA offline"
    ann["annotatedAt"] = pd.Timestamp.now("UTC").isoformat()

    final_cols = ["event_key", "operatorLabel", "operatorId", "comment", "annotatedAt"]

    if out_path.exists():
        existing = pd.read_csv(out_path)
        merged = pd.concat([existing, ann[final_cols]], axis=0)
        merged = merged.drop_duplicates(subset=["event_key"], keep="last")
    else:
        merged = ann[final_cols]

    merged = merged.head(max(args.target_count, len(merged)))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(out_path, index=False)

    print(
        {
            "output": str(out_path),
            "rows": int(len(merged)),
            "anomaly_labels": int((merged["operatorLabel"] == "anomaly").sum()),
            "normal_labels": int((merged["operatorLabel"] == "normal").sum()),
        }
    )


if __name__ == "__main__":
    main()
