#!/usr/bin/env python3

import argparse
import json
import subprocess
import sys
from pathlib import Path


def run_step(name: str, command: list):
    proc = subprocess.run(command, capture_output=True, text=True)
    return {
        "name": name,
        "command": command,
        "returncode": int(proc.returncode),
        "stdout_tail": "\n".join(proc.stdout.splitlines()[-30:]),
        "stderr_tail": "\n".join(proc.stderr.splitlines()[-30:]),
        "success": proc.returncode == 0,
    }


def load_json(path: Path):
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def parse_args():
    parser = argparse.ArgumentParser(description="Run full offline AI training pipeline")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--max-rows-anomaly", type=int, default=120000)
    parser.add_argument("--max-rows-sequential", type=int, default=180000)
    parser.add_argument("--max-rows-forecast", type=int, default=140000)
    parser.add_argument("--max-rows-rules", type=int, default=140000)
    parser.add_argument("--forecast-horizons", nargs="*", type=int, default=[60, 360])
    parser.add_argument("--forecast-max-train-samples", type=int, default=50000)
    parser.add_argument("--report", default="reports/ai_offline_training_summary.json")
    return parser.parse_args()


def main():
    args = parse_args()
    root = Path(__file__).resolve().parents[1]

    steps = []
    steps.append(
        run_step(
            "anomaly_training",
            [
                args.python,
                str(root / "train_autoencoder_model.py"),
                "--max-rows",
                str(args.max_rows_anomaly),
            ],
        )
    )
    steps.append(
        run_step(
            "anomaly_sequential_benchmark",
            [
                args.python,
                str(root / "ml_pipeline" / "benchmark_sequential_anomaly_torch.py"),
                "--max-rows",
                str(args.max_rows_sequential),
                "--seq-len",
                "30",
                "--stride",
                "3",
                "--max-sequences",
                "120000",
                "--epochs",
                "4",
                "--batch-size",
                "256",
                "--update-main-report",
            ],
        )
    )
    steps.append(
        run_step(
            "forecast_training",
            [
                args.python,
                str(root / "train_lstm_model.py"),
                "--max-rows",
                str(args.max_rows_forecast),
                "--max-train-samples",
                str(args.forecast_max_train_samples),
                "--horizons",
            ]
            + [str(h) for h in args.forecast_horizons],
        )
    )
    steps.append(
        run_step(
            "recommendation_expert",
            [
                args.python,
                str(root / "ml_pipeline" / "recommendation_expert_system.py"),
                "--max-rows",
                str(args.max_rows_rules),
            ],
        )
    )

    anomaly_report = load_json(root / "reports" / "ai_anomaly_validation.json")
    forecast_report = load_json(root / "reports" / "ai_forecast_validation.json")
    reco_report = load_json(root / "reports" / "ai_recommendation_validation.json")

    mandatory_ops = [
        {
            "operation": "train_hybrid_anomaly_model",
            "mandatory": True,
            "why": "Detection anomalies/derives est un objectif central du lot IA.",
            "status": bool(anomaly_report is not None and steps[0]["success"]),
        },
        {
            "operation": "benchmark_sequential_anomaly_model",
            "mandatory": True,
            "why": "Le modele sequentiel retenu doit etre exporte et versionne pour integration backend.",
            "status": bool(steps[1]["success"]),
        },
        {
            "operation": "train_consumption_forecast_model",
            "mandatory": True,
            "why": "Prediction consommation fait partie du scope principal de developpement IA.",
            "status": bool(forecast_report is not None and steps[2]["success"]),
        },
        {
            "operation": "evaluate_expert_recommendations",
            "mandatory": True,
            "why": "Recommandations actions doivent rester explicables et testees sur donnees synthetiques.",
            "status": bool(reco_report is not None and steps[3]["success"]),
        },
        {
            "operation": "benchmark_foundation_models",
            "mandatory": False,
            "why": "Comparaison TimesFM/Chronos utile mais non bloquante pour demarrer un MVP offline.",
            "status": False,
        },
    ]

    summary = {
        "task": "offline_ai_training_pipeline",
        "status": "completed" if all(step["success"] for step in steps) else "partial",
        "steps": steps,
        "mandatory_operations": mandatory_ops,
        "reports": {
            "anomaly": str((root / "reports" / "ai_anomaly_validation.json").as_posix()),
            "forecast": str((root / "reports" / "ai_forecast_validation.json").as_posix()),
            "recommendations": str((root / "reports" / "ai_recommendation_validation.json").as_posix()),
        },
    }

    report_path = root / args.report
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with report_path.open("w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    print(json.dumps(summary, indent=2))
    if summary["status"] != "completed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
