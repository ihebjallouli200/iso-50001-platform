import argparse
import csv
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

try:
    import pandapower as pp
except ImportError as exc:
    raise SystemExit(
        "pandapower is required for this generator. Install dependencies with: "
        "pip install -r ingestion/requirements.txt"
    ) from exc


ANOMALY_TYPES = {
    0: "normal",
    1: "electrical_thd_over_8",
    2: "electrical_cos_phi_low",
    3: "electrical_harmonics_over_5",
    4: "electrical_kva_spike_without_output",
    5: "productive_kwh_drift_no_oee_drop",
    6: "productive_oee_below_60_normal_kwh",
    7: "productive_idle_over_30min_with_kwh",
}


@dataclass
class MarkovConfig:
    target_rate: float
    min_rate: float = 0.03
    max_rate: float = 0.08
    max_iters: int = 8


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate machine_telemetry with pandapower + Markov anomalies")
    parser.add_argument("--input", default="data/raw/synthetic_measurements.csv")
    parser.add_argument("--output", default="data/processed/machine_telemetry_1min_12m.csv")
    parser.add_argument("--summary", default="reports/machine_telemetry_generation_summary.json")
    parser.add_argument("--machine-count", type=int, default=10)
    parser.add_argument("--minutes", type=int, default=525600)
    parser.add_argument("--start", default="2025-01-01T00:00:00Z")
    parser.add_argument("--anomaly-rate", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=50001)
    return parser.parse_args()


def fmt_ns_utc(ts: pd.Timestamp) -> str:
    base = ts.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%S")
    return f"{base}.000000000Z"


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def build_pandapower_reference(machine_seed: int) -> Dict[str, float]:
    rng = np.random.default_rng(machine_seed)
    net = pp.create_empty_network(sn_mva=1.0)
    b_hv = pp.create_bus(net, vn_kv=20.0)
    b_lv = pp.create_bus(net, vn_kv=0.4)
    pp.create_ext_grid(net, bus=b_hv, vm_pu=1.0)
    pp.create_transformer_from_parameters(
        net,
        hv_bus=b_hv,
        lv_bus=b_lv,
        sn_mva=0.63,
        vn_hv_kv=20.0,
        vn_lv_kv=0.4,
        vkr_percent=0.5,
        vk_percent=4.0,
        pfe_kw=1.0,
        i0_percent=0.2,
    )
    load = pp.create_load(net, bus=b_lv, p_mw=0.15, q_mvar=0.03)

    vm_values = []
    for scale in (0.7, 1.0, 1.3):
        p_base = 0.1 + 0.05 * rng.random()
        q_base = 0.02 + 0.01 * rng.random()
        net.load.at[load, "p_mw"] = p_base * scale
        net.load.at[load, "q_mvar"] = q_base * scale
        pp.runpp(net, calculate_voltage_angles=False)
        vm_values.append(float(net.res_bus.vm_pu.at[b_lv]))

    vm_drop = max(0.0, 1.0 - min(vm_values))
    return {
        "vm_drop": vm_drop,
        "thd_factor": 1.0 + vm_drop * 8.0,
        "kva_factor": 1.0 + vm_drop * 2.0,
    }


def load_source(input_path: Path, machine_count: int) -> Tuple[pd.DataFrame, List[str]]:
    df = pd.read_csv(input_path)
    required = [
        "timestamp",
        "machineId",
        "kWh",
        "kVA",
        "cosPhiVoltage",
        "cosPhiCurrent",
        "thdVoltage",
        "thdCurrent",
        "oee",
        "outputPieces",
        "outputTonnage",
        "machineState",
    ]
    missing = [col for col in required if col not in df.columns]
    if missing:
        raise ValueError(f"Missing required source columns: {missing}")

    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce")
    df = df.dropna(subset=["timestamp", "machineId"])

    selected = sorted(df["machineId"].astype(str).unique(), key=lambda x: (len(x), x))[:machine_count]
    if len(selected) < 10:
        raise ValueError(f"At least 10 machines required, found {len(selected)}")

    return df, selected


def machine_state_to_etat(value: str) -> int:
    v = str(value).strip().lower()
    if v in ("running", "run", "marche"):
        return 1
    if v == "idle":
        return 2
    return 0


def simulate_markov_types(
    peak_factors: np.ndarray,
    rng: np.random.Generator,
    cfg: MarkovConfig,
) -> np.ndarray:
    total = len(peak_factors)
    if total == 0:
        return np.zeros(0, dtype=np.int8)

    trans_from_anomaly = np.array([0.70, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05], dtype=float)
    state_choices = np.array([1, 2, 3, 4, 5, 6, 7], dtype=np.int8)

    base_enter = max(0.0005, cfg.target_rate / 6.5)
    labels = np.zeros(total, dtype=np.int8)

    for _ in range(cfg.max_iters):
        labels.fill(0)
        state = 0
        remaining = 0
        anomaly_count = 0
        idle_block_remaining = 0

        for i in range(total):
            peak = float(peak_factors[i])
            if state == 0:
                p_enter = clamp(base_enter * (1.0 + 1.4 * peak), 0.0001, 0.35)
                if rng.random() < p_enter:
                    p_types = np.array([0.19, 0.16, 0.13, 0.12, 0.16, 0.14, 0.10], dtype=float)
                    p_types = p_types + np.array([
                        0.06 * peak,
                        0.04 * peak,
                        0.03 * peak,
                        0.05 * peak,
                        0.08 * peak,
                        0.07 * peak,
                        -0.03 * peak,
                    ])
                    p_types = np.clip(p_types, 0.01, None)
                    p_types = p_types / p_types.sum()
                    state = int(rng.choice(state_choices, p=p_types))
                    if state == 7:
                        remaining = int(rng.integers(31, 61))
                        idle_block_remaining = remaining
                    elif state in (1, 3):
                        remaining = int(rng.integers(4, 15))
                    elif state in (4, 5, 6):
                        remaining = int(rng.integers(3, 12))
                    else:
                        remaining = int(rng.integers(2, 8))

            if state != 0:
                labels[i] = state
                anomaly_count += 1
                remaining -= 1
                if remaining <= 0:
                    if rng.random() < 0.15:
                        state = int(rng.choice(state_choices, p=trans_from_anomaly))
                        if state == 7:
                            remaining = int(rng.integers(31, 61))
                            idle_block_remaining = remaining
                        elif state in (1, 3):
                            remaining = int(rng.integers(4, 15))
                        elif state in (4, 5, 6):
                            remaining = int(rng.integers(3, 12))
                        else:
                            remaining = int(rng.integers(2, 8))
                    else:
                        state = 0
            elif idle_block_remaining > 0:
                idle_block_remaining -= 1

        ratio = anomaly_count / total
        if cfg.min_rate <= ratio <= cfg.max_rate:
            break
        if ratio < cfg.min_rate:
            base_enter *= 1.35
        else:
            base_enter *= 0.78

    return labels


def anomaly_rule_satisfied(
    anomaly_type: int,
    base: Dict[str, float],
    row: Dict[str, float],
    machine_avg_kva: float,
) -> bool:
    if anomaly_type == 1:
        return (row["thd_v"] > 8.0 or row["thd_i"] > 8.0) and row["etat"] in (1, 2)
    if anomaly_type == 2:
        return row["cos_phi"] < 0.85 and abs(row["oee"] - base["oee"]) <= 2.0
    if anomaly_type == 3:
        return row["harm_5"] > 5.0 or row["harm_7"] > 5.0
    if anomaly_type == 4:
        output_stable = row["output_pieces"] <= base["output_pieces"] * 1.03 and row["output_tonnage"] <= base["output_tonnage"] * 1.03
        return row["kva"] > machine_avg_kva * 1.2 and output_stable
    if anomaly_type == 5:
        return row["kwh"] > base["kwh"] * 1.2 and row["oee"] >= base["oee"] - 1.5
    if anomaly_type == 6:
        kwh_normal = abs(row["kwh"] - base["kwh"]) <= base["kwh"] * 0.1
        return row["oee"] < 60.0 and kwh_normal
    if anomaly_type == 7:
        return row["etat"] == 2 and row["kwh"] > 0
    return True


def broad_rule_satisfied(row: Dict[str, float], machine_avg_kva: float, machine_avg_kwh: float) -> bool:
    return (
        ((row["thd_v"] > 8.0 or row["thd_i"] > 8.0) and row["etat"] in (1, 2))
        or (row["cos_phi"] < 0.85)
        or (row["harm_5"] > 5.0 or row["harm_7"] > 5.0)
        or (row["kva"] > 1.2 * machine_avg_kva)
        or (row["kwh"] > 1.2 * machine_avg_kwh and row["oee"] >= 60)
        or (row["oee"] < 60)
        or (row["etat"] == 2 and row["kwh"] > 0)
    )


def hard_rule_satisfied(row: Dict[str, float]) -> bool:
    return (
        ((row["thd_v"] > 8.0 or row["thd_i"] > 8.0) and row["etat"] in (1, 2))
        or (row["cos_phi"] < 0.85)
        or (row["harm_5"] > 5.0 or row["harm_7"] > 5.0)
        or (row["oee"] < 60)
        or (row["etat"] == 2 and row["kwh"] > 0)
    )


def generate_dataset(args: argparse.Namespace) -> Dict:
    input_path = Path(args.input)
    output_path = Path(args.output)
    summary_path = Path(args.summary)

    source_df, machines = load_source(input_path, args.machine_count)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)

    start = pd.Timestamp(args.start, tz="UTC")

    fieldnames = [
        "timestamp",
        "machine_id",
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
        "label_anomalie",
    ]

    global_rows = 0
    global_anomaly = 0
    machine_summaries = []
    validation_failures = 0

    with output_path.open("w", newline="", encoding="utf-8") as out_csv:
        writer = csv.DictWriter(out_csv, fieldnames=fieldnames)
        writer.writeheader()

        for machine_index, machine_id in enumerate(machines):
            machine_seed = args.seed + (machine_index + 1) * 101
            rng = np.random.default_rng(machine_seed)
            pp_ref = build_pandapower_reference(machine_seed)

            mdf = source_df[source_df["machineId"].astype(str) == str(machine_id)].copy()
            mdf = mdf.sort_values("timestamp").reset_index(drop=True)

            template_len = len(mdf)
            if template_len < 2:
                raise ValueError(f"Machine {machine_id} has insufficient rows")

            output_series = mdf["outputPieces"].astype(float).to_numpy()
            p95 = float(np.percentile(output_series, 95))
            p20 = float(np.percentile(output_series, 20))
            denom = max(1.0, p95 - p20)

            peak_factors = np.zeros(args.minutes, dtype=float)
            for minute in range(args.minutes):
                base_idx = (minute // 15) % template_len
                output_val = float(output_series[base_idx])
                peak_factors[minute] = clamp((output_val - p20) / denom, 0.0, 1.0)

            labels = simulate_markov_types(
                peak_factors=peak_factors,
                rng=rng,
                cfg=MarkovConfig(target_rate=args.anomaly_rate),
            )

            machine_avg_kva = float(mdf["kVA"].astype(float).mean())
            machine_avg_kwh = float(mdf["kWh"].astype(float).mean())
            machine_rows = 0
            machine_anomaly = 0
            by_type = {name: 0 for name in ANOMALY_TYPES.values() if name != "normal"}
            fallback_rule_fixes = 0

            for minute in range(args.minutes):
                ts = start + pd.Timedelta(minutes=minute)
                idx_low = (minute // 15) % template_len
                idx_high = (idx_low + 1) % template_len
                frac = (minute % 15) / 15.0

                low = mdf.iloc[idx_low]
                high = mdf.iloc[idx_high]

                kwh = float(low["kWh"] + (high["kWh"] - low["kWh"]) * frac)
                kva = float(low["kVA"] + (high["kVA"] - low["kVA"]) * frac)
                cos_phi = float(
                    ((low["cosPhiVoltage"] + low["cosPhiCurrent"]) / 2.0)
                    + (((high["cosPhiVoltage"] + high["cosPhiCurrent"]) / 2.0) - ((low["cosPhiVoltage"] + low["cosPhiCurrent"]) / 2.0))
                    * frac
                )
                cos_phi = clamp(cos_phi, 0.0, 1.0)
                thd_v = max(0.0, float(low["thdVoltage"] + (high["thdVoltage"] - low["thdVoltage"]) * frac))
                thd_i = max(0.0, float(low["thdCurrent"] + (high["thdCurrent"] - low["thdCurrent"]) * frac))
                output_pieces = max(0, int(round(float(low["outputPieces"] + (high["outputPieces"] - low["outputPieces"]) * frac))))
                output_tonnage = max(0.0, float(low["outputTonnage"] + (high["outputTonnage"] - low["outputTonnage"]) * frac))
                etat = machine_state_to_etat(low["machineState"] if frac < 0.5 else high["machineState"])
                oee = clamp(float((low["oee"] + (high["oee"] - low["oee"]) * frac) * 100.0), 0.0, 100.0)

                harm_3 = max(0.0, thd_v * 0.45 + (rng.random() - 0.5) * 0.1)
                harm_5 = max(0.0, thd_v * 0.30 + (rng.random() - 0.5) * 0.08)
                harm_7 = max(0.0, thd_v * 0.20 + (rng.random() - 0.5) * 0.07)

                anomaly_type = int(labels[minute])
                label = 1 if anomaly_type > 0 else 0

                base_snapshot = {
                    "kwh": kwh,
                    "kva": kva,
                    "oee": oee,
                    "output_pieces": output_pieces,
                    "output_tonnage": output_tonnage,
                }

                if anomaly_type == 1:
                    if etat == 0:
                        etat = 2
                    thd_v = max(8.5, thd_v * (1.8 + pp_ref["thd_factor"] * 0.2))
                    thd_i = max(8.5, thd_i * (1.9 + pp_ref["thd_factor"] * 0.2))
                elif anomaly_type == 2:
                    cos_phi = min(cos_phi, 0.82)
                elif anomaly_type == 3:
                    harm_5 = max(harm_5, 5.3 + pp_ref["vm_drop"] * 3.0)
                    harm_7 = max(harm_7, 5.1 + pp_ref["vm_drop"] * 2.0)
                elif anomaly_type == 4:
                    kva = max(kva, machine_avg_kva * 1.24 * pp_ref["kva_factor"])
                    output_pieces = int(round(output_pieces * 0.98))
                    output_tonnage = output_tonnage * 0.985
                elif anomaly_type == 5:
                    kwh = kwh * 1.23
                    kva = kva * 1.18
                    oee = max(oee - 0.8, 0.0)
                elif anomaly_type == 6:
                    oee = min(oee, 55.0)
                    kwh = clamp(kwh, base_snapshot["kwh"] * 0.92, base_snapshot["kwh"] * 1.08)
                elif anomaly_type == 7:
                    etat = 2
                    kwh = max(kwh, 1.0)

                row = {
                    "timestamp": fmt_ns_utc(ts),
                    "machine_id": str(machine_id),
                    "kwh": round(kwh, 6),
                    "kva": round(kva, 6),
                    "cos_phi": round(cos_phi, 6),
                    "thd_v": round(thd_v, 6),
                    "thd_i": round(thd_i, 6),
                    "harm_3": round(harm_3, 6),
                    "harm_5": round(harm_5, 6),
                    "harm_7": round(harm_7, 6),
                    "output_pieces": int(output_pieces),
                    "output_tonnage": round(output_tonnage, 6),
                    "etat": int(etat),
                    "oee": round(oee, 4),
                    "label_anomalie": int(label),
                }

                if label == 1 and not hard_rule_satisfied(row):
                    row["cos_phi"] = min(float(row["cos_phi"]), 0.82)
                    fallback_rule_fixes += 1

                if label == 1:
                    machine_anomaly += 1
                    by_type[ANOMALY_TYPES[anomaly_type]] += 1
                    if not anomaly_rule_satisfied(anomaly_type, base_snapshot, row, machine_avg_kva):
                        validation_failures += 1

                writer.writerow(row)
                machine_rows += 1

            machine_rate = machine_anomaly / machine_rows
            machine_summaries.append(
                {
                    "machine_id": str(machine_id),
                    "rows": machine_rows,
                    "anomaly_rows": machine_anomaly,
                    "anomaly_rate": round(machine_rate, 6),
                    "types": by_type,
                    "fallback_rule_fixes": fallback_rule_fixes,
                    "peak_weighting": "higher entry probability during output peaks",
                }
            )
            global_rows += machine_rows
            global_anomaly += machine_anomaly

    summary = {
        "ok": True,
        "input": str(input_path),
        "output": str(output_path),
        "machines": len(machines),
        "rows": global_rows,
        "anomaly_rows": global_anomaly,
        "anomaly_rate": round(global_anomaly / global_rows, 6),
        "target_anomaly_rate": args.anomaly_rate,
        "required_range": [0.03, 0.08],
        "markov": "used",
        "pandapower": "used",
        "validation_failures": validation_failures,
        "validation_pass": validation_failures == 0,
        "machine_summaries": machine_summaries,
    }

    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def main() -> None:
    args = parse_args()
    if not (0.03 <= args.anomaly_rate <= 0.08):
        raise ValueError("anomaly-rate must be in [0.03, 0.08]")
    generate_dataset(args)


if __name__ == "__main__":
    main()
