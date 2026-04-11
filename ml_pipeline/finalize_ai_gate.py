#!/usr/bin/env python3

import json
from pathlib import Path

import pandas as pd


def load_json(path: Path):
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def main():
    root = Path(__file__).resolve().parents[1]

    anomaly = load_json(root / "reports" / "ai_anomaly_validation.json") or {}
    forecast = load_json(root / "reports" / "ai_forecast_validation.json") or {}
    reco = load_json(root / "reports" / "ai_recommendation_validation.json") or {}

    annotations_path = root / "data" / "processed" / "operator_annotations.csv"
    if annotations_path.exists():
        ann = pd.read_csv(annotations_path)
        labeled_events = int(len(ann))
    else:
        labeled_events = 0

    min_labels = 500
    enough_labels = labeled_events >= min_labels

    anomaly_metrics = anomaly.get("metrics", {})
    anomaly_targets = anomaly.get("targets", {"precision_min": 0.6, "recall_min": 0.85})

    precision = float(anomaly_metrics.get("precision", 0.0))
    recall = float(anomaly_metrics.get("recall", 0.0))

    anomaly_precision_ok = precision >= float(anomaly_targets.get("precision_min", 0.6))
    anomaly_recall_ok = recall >= float(anomaly_targets.get("recall_min", 0.85))

    phase1_thresholds = {"60": 0.07, "360": 0.16, "1440": 0.10}
    by_horizon = {str(item.get("horizon_minutes")): float(item.get("metrics", {}).get("mape", 1.0)) for item in forecast.get("results", [])}
    forecast_ok = all(by_horizon.get(h, 1.0) <= t for h, t in phase1_thresholds.items())

    reco_pass = reco.get("pass", {})
    recommendation_rules_ok = bool(reco_pass.get("coverage_min_5pct", False) and reco_pass.get("all_rules_triggered", False))

    criteria = {
        "forecast_ok": forecast_ok,
        "anomaly_precision_ok": anomaly_precision_ok,
        "anomaly_recall_ok": anomaly_recall_ok,
        "enough_labels_ok": enough_labels,
        "recommendation_rules_ok": recommendation_rules_ok,
    }

    all_core_ok = all(criteria.values())
    gate_status = "APPROVED_PHASE1_COMPLETED" if all_core_ok else "APPROVED_PHASE1_PENDING_MANDATORY"

    final_gate = {
        "deployment_mode": "advisory_only",
        "auto_control_enabled": False,
        "gate_status": gate_status,
        "criteria": criteria,
        "evidence": {
            "forecast_report": "reports/ai_forecast_validation.json",
            "forecast_thresholds_phase1": phase1_thresholds,
            "anomaly_report": "reports/ai_anomaly_validation.json",
            "recommendation_report": "reports/ai_recommendation_validation.json",
            "operator_annotations": "data/processed/operator_annotations.csv",
            "labeled_events": labeled_events,
            "min_labeled_events": min_labels,
        },
        "policy": "Pilotage automatique interdit. Advisory mode uniquement.",
        "next_action": "Passer au lot optionnel (benchmark foundation models)" if all_core_ok else "Finaliser les criteres obligatoires restants",
    }

    for filename in ["step5_advisory_gate_decision.json", "step5_advisory_gate_decision_ai_large.json"]:
        out = root / "reports" / filename
        with out.open("w", encoding="utf-8") as f:
            json.dump(final_gate, f, indent=2)

    print(json.dumps(final_gate, indent=2))


if __name__ == "__main__":
    main()
