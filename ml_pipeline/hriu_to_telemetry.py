#!/usr/bin/env python3
"""
HRI-EU Reduced Dataset -> ISO 50001 Platform machine_telemetry format.
Version 2: Uses REAL anomaly labels from issues.zip YAML files.

Strategy:
  - 15 virtual machines derived from aggregated HRI-EU data
  - Anomaly labels from 87 YAML files (148K+ real labeled issues)
  - Each machine is mapped to specific HRI-EU meter references
  - Physics formulas for THD, harmonics, cos_phi, TRS

Usage:
    py -3.11 ml_pipeline/hriu_to_telemetry.py
"""

import os
import sys
import yaml
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone

# ============================================================
# CONFIG
# ============================================================
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "hriu_raw" / "reduced_data" / "reduced_data" / "1min"
ISSUES_DIR = BASE_DIR / "data" / "hriu_raw" / "issues"
OUTPUT_DIR = BASE_DIR / "data" / "processed"
OUTPUT_FILE = OUTPUT_DIR / "hriu_machine_telemetry_1min.csv"

DATE_START = "2023-01-01"
DATE_END = "2024-01-01"

# Virtual machines with mapping to HRI-EU meter references for anomaly labels
# (id, name, source_file, source_column, fraction, cos_phi_mu, cos_phi_sigma, category, yaml_refs)
MACHINES = [
    # Electricity subsystems (H2 building - servers/offices/workshops)
    (1,  "Serveur Rack A",        "electricity_P", "total", 0.12, 0.91, 0.02, "servers",
         ["H2.Z61", "H2.Z62"]),
    (2,  "Serveur Rack B",        "electricity_P", "total", 0.10, 0.90, 0.03, "servers",
         ["H2.Z63", "H2.Z64"]),
    (3,  "Serveur Rack C",        "electricity_P", "total", 0.08, 0.92, 0.02, "servers",
         ["H2.Z65", "H2.Z66"]),
    (4,  "Eclairage Bureau H2",   "electricity_P", "total", 0.05, 0.95, 0.02, "offices",
         ["H2.Z67", "H2.Z68"]),
    (5,  "Eclairage Bureau H4",   "electricity_P", "total", 0.04, 0.94, 0.02, "offices",
         ["H4.Z50", "H4.Z51"]),
    (6,  "Atelier Emission Lab",  "electricity_P", "total", 0.15, 0.80, 0.05, "emission_lab",
         ["H3.Z40", "H3.Z41", "H3.Z42"]),
    (7,  "Atelier Mecanique",     "electricity_P", "total", 0.08, 0.83, 0.04, "workshops",
         ["H3.Z43", "H3.Z44", "H3.Z45"]),
    (8,  "Design Studio",         "electricity_P", "total", 0.06, 0.93, 0.02, "design_studio",
         ["H3.Z46", "H3.Z47", "H3.Z48"]),
    (9,  "Ventilation CTA H2",    "electricity_P", "total", 0.07, 0.86, 0.03, "ventilation",
         ["H2.T.Z30", "H2.T.Z31", "H2.T.Z32"]),
    (10, "Ventilation CTA H3",    "electricity_P", "total", 0.05, 0.85, 0.04, "ventilation",
         ["H2.T.Z33", "H2.T.Z34"]),
    # PV production (H1 building)
    (11, "Panneaux PV Toiture",   "electricity_P", "PV",   1.00, 0.98, 0.01, "local_generators",
         ["H1.Z10", "H1.Z11", "H1.Z12"]),
    # CHP (H1 building)
    (12, "Cogeration CHP Elec",   "electricity_P", "CHP",  1.00, 0.88, 0.03, "local_generators",
         ["H1.K11", "H1.K12", "H1.K14"]),
    # Cooling
    (13, "Groupe Froid Principal", "cooling_P",     "cool_elec", 0.65, 0.82, 0.04, "cooling",
         ["H1.K15", "H1.K16", "H2.K21"]),
    (14, "Groupe Froid Secours",  "cooling_P",     "cool_elec", 0.35, 0.84, 0.05, "cooling",
         ["V.Z81", "V.Z82"]),
    # Heating (H1 building)
    (15, "Chauffage CHP Therm",   "heating_P",     "CHP_heat",  1.00, 0.90, 0.03, "heating",
         ["H1.W11", "H1.W12", "V.K21"]),
]


def load_all_issues():
    """Load all YAML issues and index them by (reference_prefix, timestamp_minute)."""
    print("\n  Loading anomaly labels from YAML issues...")

    auto_dir = ISSUES_DIR / "automatic_issues"
    manual_dir = ISSUES_DIR / "manual_issues"

    all_issues = []
    for issues_dir in [auto_dir, manual_dir]:
        if not issues_dir.exists():
            continue
        for fname in sorted(os.listdir(issues_dir)):
            if not fname.endswith(".yaml"):
                continue
            fpath = issues_dir / fname
            with open(fpath, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if not isinstance(data, dict):
                continue
            for key, issue in data.items():
                if not isinstance(issue, dict):
                    continue
                all_issues.append(issue)

    print(f"  Loaded {len(all_issues):,} total issues")

    # Filter to 2023 only
    ts_start = int(datetime(2023, 1, 1, tzinfo=timezone.utc).timestamp())
    ts_end = int(datetime(2024, 1, 1, tzinfo=timezone.utc).timestamp())

    issues_2023 = []
    for i in all_issues:
        try:
            t_s = int(i.get("time_start", 0))
            t_e = int(i.get("time_end", 0))
        except (ValueError, TypeError):
            continue
        if (ts_start <= t_s < ts_end) or (ts_start <= t_e < ts_end):
            i["_ts"] = t_s
            i["_te"] = t_e
            issues_2023.append(i)
    print(f"  Issues in 2023: {len(issues_2023):,}")

    # Build lookup: ref_prefix -> set of (start_minute, end_minute) intervals
    # Each minute within an issue interval is marked as anomalous
    ref_intervals = {}
    for issue in issues_2023:
        ref = issue.get("reference", "")
        # Strip sub-measurement suffixes like .V, .W, .WQ etc.
        ref_base = ref.split(".V")[0].split(".W")[0] if "." in ref else ref
        # Also keep the full ref for matching
        for r in [ref, ref_base]:
            if r not in ref_intervals:
                ref_intervals[r] = []
            t_start = max(issue["_ts"], ts_start)
            t_end = min(issue["_te"], ts_end)
            if t_end >= t_start:
                ref_intervals[r].append((t_start, t_end))

    # Stats
    unique_refs = set(ref_intervals.keys())
    total_intervals = sum(len(v) for v in ref_intervals.values())
    print(f"  Unique meter references: {len(unique_refs)}")
    print(f"  Total anomaly intervals: {total_intervals:,}")

    return ref_intervals


def build_anomaly_mask(timestamps, yaml_refs, ref_intervals):
    """For each timestamp, check if any of the yaml_refs has an overlapping issue."""
    # Convert pandas timestamps to unix seconds
    ts_series = pd.to_datetime(timestamps)
    # pandas 2.x uses datetime64[us] (microseconds), so divide by 10**6
    ts_unix = ts_series.values.astype(np.int64) // 10**6

    # Collect all relevant intervals for this machine's refs
    intervals = []
    matched_refs = []
    for ref in yaml_refs:
        if ref in ref_intervals:
            intervals.extend(ref_intervals[ref])
            matched_refs.append(ref)
        # Also check sub-refs (e.g. H2.Z61.V, H2.Z61.W)
        for full_ref, ivs in ref_intervals.items():
            if full_ref.startswith(ref + ".") or full_ref.startswith(ref + "@"):
                intervals.extend(ivs)
                if full_ref not in matched_refs:
                    matched_refs.append(full_ref)

    if not intervals:
        return np.zeros(len(timestamps), dtype=int), matched_refs

    # Sort intervals and merge overlapping ones
    intervals.sort()
    merged = [list(intervals[0])]
    for start, end in intervals[1:]:
        if start <= merged[-1][1] + 60:  # 60s tolerance
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])

    # Vectorized check: is each timestamp within any interval?
    mask = np.zeros(len(ts_unix), dtype=int)
    for start, end in merged:
        mask |= ((ts_unix >= start) & (ts_unix <= end)).astype(int)

    return mask, matched_refs


def load_source(filename):
    """Load a source CSV file, filter to date range."""
    filepath = DATA_DIR / f"{filename}.csv.gz"
    if not filepath.exists():
        print(f"  WARNING: {filepath} not found")
        return None
    df = pd.read_csv(filepath, parse_dates=["datetime_utc"])
    df = df.rename(columns={"datetime_utc": "timestamp"})
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df[(df["timestamp"] >= DATE_START) & (df["timestamp"] < DATE_END)].copy()
    df = df.sort_values("timestamp").reset_index(drop=True)
    print(f"  Loaded {filename}: {len(df):,} rows ({df['timestamp'].min()} -> {df['timestamp'].max()})")
    return df


def process_machine(machine_def, source_cache, ref_intervals):
    """Process a single virtual machine, return telemetry DataFrame."""
    mid, name, src_file, src_col, fraction, cos_mu, cos_sigma, category, yaml_refs = machine_def
    rng = np.random.default_rng(seed=mid * 42)

    if src_file not in source_cache:
        source_cache[src_file] = load_source(src_file)
    df_src = source_cache[src_file]
    if df_src is None:
        return None

    if src_col not in df_src.columns:
        print(f"  WARNING: Column '{src_col}' not in {src_file}")
        return None

    df = pd.DataFrame()
    df["timestamp"] = df_src["timestamp"].copy()

    # Power in Watts (fraction + noise)
    raw_power = pd.to_numeric(df_src[src_col], errors="coerce").fillna(0).values
    noise = rng.normal(1.0, 0.05, len(raw_power))
    power_w = np.abs(raw_power * fraction * noise)

    # kWh (1-min: W / 1000 / 60)
    df["kwh"] = power_w / 1000.0 / 60.0

    # cos_phi with temporal variation
    n = len(df)
    base_cos = rng.normal(cos_mu, cos_sigma, n)
    hours = df["timestamp"].dt.hour.values
    daily_effect = 0.02 * np.sin(2 * np.pi * (hours - 6) / 24)
    cos_phi = np.clip(base_cos + daily_effect, 0.60, 0.99)
    df["cos_phi"] = cos_phi

    # kVA
    df["kva"] = df["kwh"] / df["cos_phi"]

    # THD formulas
    df["thd_i"] = np.sqrt(1.0 / cos_phi**2 - 1.0) * 100.0
    df["thd_v"] = (0.03 + 0.05 * (1.0 - cos_phi)) * 100.0

    # Harmonics
    df["harm_3"] = 0.15 * (df["thd_i"].values / 100.0)
    df["harm_5"] = 0.50 * (df["thd_i"].values / 100.0)
    df["harm_7"] = 0.25 * (df["thd_i"].values / 100.0)

    # TRS (added per audit)
    df["trs"] = np.sqrt(1.0 + (df["thd_i"].values / 100.0) ** 2)

    # etat
    p95 = np.percentile(power_w[power_w > 0], 95) if np.any(power_w > 0) else 1.0
    thresh_run = max(p95 * 0.15, 50)
    thresh_idle = max(p95 * 0.03, 5)
    df["etat"] = np.where(power_w > thresh_run, 1,
                 np.where(power_w > thresh_idle, 2, 0))

    # output_pieces
    p_max = max(power_w.max(), 1)
    load_frac = np.clip(power_w / p_max, 0, 1)
    df["output_pieces"] = np.where(
        df["etat"].values == 1,
        (load_frac * rng.uniform(5, 15) + rng.normal(0, 0.3, n)).clip(0).astype(int),
        0
    )

    # output_tonnage
    df["output_tonnage"] = df["output_pieces"].values * rng.uniform(0.05, 0.3)

    # OEE
    df["oee"] = np.clip(40 + 55 * load_frac + rng.normal(0, 2, n), 0, 100)

    # === REAL anomaly labels from YAML issues ===
    anomaly_mask, matched_refs = build_anomaly_mask(df["timestamp"], yaml_refs, ref_intervals)
    df["label_anomalie"] = anomaly_mask

    # machine_id
    df["machine_id"] = mid

    # Round
    for col in ["kwh", "kva", "cos_phi", "thd_v", "thd_i", "harm_3", "harm_5", "harm_7",
                "trs", "output_tonnage", "oee"]:
        df[col] = df[col].round(4)

    # Final columns
    result = df[[
        "timestamp", "machine_id", "kwh", "kva", "cos_phi",
        "thd_v", "thd_i", "harm_3", "harm_5", "harm_7", "trs",
        "output_pieces", "output_tonnage", "etat", "oee", "label_anomalie",
    ]]

    return result, matched_refs


def main():
    print("=" * 60)
    print("  HRI-EU Reduced -> ISO 50001 Telemetry Converter v2")
    print(f"  Date range: {DATE_START} -> {DATE_END}")
    print(f"  Machines: {len(MACHINES)}")
    print("  Labels: REAL (from issues.zip YAML)")
    print("=" * 60)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load real anomaly labels
    ref_intervals = load_all_issues()

    source_cache = {}
    all_frames = []
    processed = 0

    for machine_def in MACHINES:
        mid, name = machine_def[0], machine_def[1]
        print(f"\n  [{mid:2d}] {name}...")
        try:
            result = process_machine(machine_def, source_cache, ref_intervals)
            if result is not None:
                df, matched_refs = result
                if len(df) > 0:
                    all_frames.append(df)
                    processed += 1
                    anomaly_count = df["label_anomalie"].sum()
                    anomaly_rate = df["label_anomalie"].mean()
                    print(f"      Matched YAML refs: {matched_refs}")
                    print(f"      {len(df):,} rows | anomalies={anomaly_count:,} ({anomaly_rate:.2%}) | kwh_mean={df['kwh'].mean():.4f}")
                else:
                    print(f"      No data")
        except Exception as e:
            print(f"      ERROR: {e}")
            import traceback
            traceback.print_exc()

    print(f"\n{'='*60}")
    print(f"  Processed: {processed}/{len(MACHINES)} machines")

    if not all_frames:
        print("  ERROR: No data!")
        sys.exit(1)

    print(f"\n  Concatenating {len(all_frames)} DataFrames...")
    final = pd.concat(all_frames, ignore_index=True)
    final = final.sort_values(["timestamp", "machine_id"]).reset_index(drop=True)

    # Stats
    total_anomalies = final["label_anomalie"].sum()
    total_rows = len(final)
    anomaly_rate = final["label_anomalie"].mean()

    print(f"\n  Final Dataset:")
    print(f"    Total rows:      {total_rows:,}")
    print(f"    Machines:        {final['machine_id'].nunique()}")
    print(f"    Date range:      {final['timestamp'].min()} -> {final['timestamp'].max()}")
    print(f"    Total anomalies: {total_anomalies:,}")
    print(f"    Anomaly rate:    {anomaly_rate:.2%}")
    print(f"    Columns:         {list(final.columns)}")

    # Save
    print(f"\n  Saving to {OUTPUT_FILE}...")
    final.to_csv(OUTPUT_FILE, index=False)
    size_mb = OUTPUT_FILE.stat().st_size / (1024 ** 2)
    print(f"  Saved! Size: {size_mb:.1f} MB")

    print(f"\n  Per-machine summary:")
    print(f"  {'ID':>3} | {'Name':25s} | {'Category':18s} | {'Rows':>8s} | {'Anomalies':>9s} | {'Rate':>6s}")
    print(f"  {'-'*3}-+-{'-'*25}-+-{'-'*18}-+-{'-'*8}-+-{'-'*9}-+-{'-'*6}")
    for m in MACHINES:
        mid = m[0]
        subset = final[final["machine_id"] == mid]
        if len(subset) > 0:
            anom = subset["label_anomalie"].sum()
            rate = subset["label_anomalie"].mean()
            print(f"  {mid:3d} | {m[1]:25s} | {m[7]:18s} | {len(subset):>8,} | {anom:>9,} | {rate:>5.1%}")

    print(f"\n{'='*60}")
    print(f"  DONE! File: {OUTPUT_FILE}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
