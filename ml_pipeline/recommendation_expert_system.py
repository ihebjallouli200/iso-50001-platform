#!/usr/bin/env python3

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd


RULES = [
    {
        "id": "R01_COSPHI_LOW",
        "condition": lambda row, stats: row["cos_phi"] < 0.90,
        "action": "Compenser l'energie reactive (controle batterie de condensateurs, consigne cos phi).",
        "severity": "medium",
    },
    {
        "id": "R02_THD_HIGH",
        "condition": lambda row, stats: (row["thd_v"] > 5.0) or (row["thd_i"] > 5.0),
        "action": "Analyser pollution harmonique (filtrage, variateurs, qualite alimentation).",
        "severity": "high",
    },
    {
        "id": "R03_OEE_DROP_WITH_HIGH_KWH",
        "condition": lambda row, stats: (row["oee"] < 85.0) and (row["kwh"] > stats["kwh_p90"]),
        "action": "Declencher revue maintenance/procede (consommation elevee avec faible performance).",
        "severity": "high",
    },
    {
        "id": "R04_LABELED_ANOMALY",
        "condition": lambda row, stats: int(row["label_anomalie"]) == 1,
        "action": "Creer ticket d'investigation et plan d'action PDCA.",
        "severity": "high",
    },
]


def apply_rules(df: pd.DataFrame):
    stats = {
        "kwh_p90": float(np.percentile(df["kwh"].to_numpy(dtype=float), 90)),
    }

    decisions = []
    for _, row in df.iterrows():
        triggered = []
        for rule in RULES:
            if rule["condition"](row, stats):
                triggered.append(
                    {
                        "rule_id": rule["id"],
                        "severity": rule["severity"],
                        "action": rule["action"],
                    }
                )
        decisions.append(triggered)
    return decisions


def parse_args():
    parser = argparse.ArgumentParser(description="Offline recommendation expert-system evaluation")
    parser.add_argument("--dataset", default="data/processed/machine_telemetry_1min_12m.csv")
    parser.add_argument("--max-rows", type=int, default=120000)
    parser.add_argument("--report", default="reports/ai_recommendation_validation.json")
    return parser.parse_args()


def main():
    args = parse_args()
    path = Path(args.dataset)
    cols = ["timestamp", "machine_id", "kwh", "cos_phi", "thd_v", "thd_i", "oee", "label_anomalie"]

    df = pd.read_csv(path, usecols=cols)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    for c in ["kwh", "cos_phi", "thd_v", "thd_i", "oee", "label_anomalie"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=cols).sort_values(["timestamp", "machine_id"])

    if args.max_rows and len(df) > args.max_rows:
        df = df.iloc[-args.max_rows:].copy()

    decisions = apply_rules(df)

    rule_counts = {rule["id"]: 0 for rule in RULES}
    actionable_rows = 0
    for row_decisions in decisions:
        if row_decisions:
            actionable_rows += 1
        for item in row_decisions:
            rule_counts[item["rule_id"]] += 1

    coverage = actionable_rows / max(len(df), 1)
    avg_actions = float(sum(len(d) for d in decisions) / max(len(df), 1))

    report = {
        "task": "recommendation_actions",
        "status": "completed",
        "approach": "rules_plus_expert_system",
        "dataset": "machine_telemetry_1min_12m.csv",
        "samples": int(len(df)),
        "coverage": {
            "actionable_rows": int(actionable_rows),
            "coverage_rate": float(coverage),
            "avg_actions_per_row": avg_actions,
        },
        "rule_trigger_counts": rule_counts,
        "rules": [
            {
                "id": rule["id"],
                "severity": rule["severity"],
                "action": rule["action"],
            }
            for rule in RULES
        ],
        "pass": {
            "coverage_min_5pct": bool(coverage >= 0.05),
            "all_rules_triggered": bool(all(v > 0 for v in rule_counts.values())),
        },
    }

    report_path = Path(args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
