#!/usr/bin/env python3
"""
HRI-EU Reduced Dataset → ISO 50001 Platform machine_telemetry format.

Strategy:
  The reduced dataset has aggregated data (total, PV, CHP, cooling, heating).
  We derive 15 virtual "machines" by decomposing totals into realistic
  sub-systems using proportional fractions + noise, matching the 72-meter
  building categories.

  Physics formulas applied:
    THD_i = sqrt(1/cos²φ - 1) × 100
    THD_v = (0.03 + 0.05 × (1 - cosφ)) × 100
    harm_3 = 0.15 × (THD_i / 100)
    harm_5 = 0.50 × (THD_i / 100)
    harm_7 = 0.25 × (THD_i / 100)

Usage:
    py -3.11 ml_pipeline/hriu_to_telemetry.py
"""

import os
import sys
import numpy as np
import pandas as pd
from pathlib import Path

# ============================================================
# CONFIG
# ============================================================
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "hriu_raw" / "reduced_data" / "reduced_data" / "1min"
OUTPUT_DIR = BASE_DIR / "data" / "processed"
OUTPUT_FILE = OUTPUT_DIR / "hriu_machine_telemetry_1min.csv"

DATE_START = "2023-01-01"
DATE_END = "2024-01-01"

# Virtual machines derived from the aggregated HRI-EU data
# Each machine: (id, name, source_file, source_column, fraction, cos_phi_mu, cos_phi_sigma, category)
MACHINES = [
    # Electricity subsystems (splitting 'total' into realistic fractions)
    (1,  "Serveur Rack A",        "electricity_P", "total", 0.12, 0.91, 0.02, "servers"),
    (2,  "Serveur Rack B",        "electricity_P", "total", 0.10, 0.90, 0.03, "servers"),
    (3,  "Serveur Rack C",        "electricity_P", "total", 0.08, 0.92, 0.02, "servers"),
    (4,  "Eclairage Bureau H2",   "electricity_P", "total", 0.05, 0.95, 0.02, "offices"),
    (5,  "Eclairage Bureau H4",   "electricity_P", "total", 0.04, 0.94, 0.02, "offices"),
    (6,  "Atelier Emission Lab",  "electricity_P", "total", 0.15, 0.80, 0.05, "emission_lab"),
    (7,  "Atelier Mecanique",     "electricity_P", "total", 0.08, 0.83, 0.04, "workshops"),
    (8,  "Design Studio",         "electricity_P", "total", 0.06, 0.93, 0.02, "design_studio"),
    (9,  "Ventilation CTA H2",    "electricity_P", "total", 0.07, 0.86, 0.03, "ventilation"),
    (10, "Ventilation CTA H3",    "electricity_P", "total", 0.05, 0.85, 0.04, "ventilation"),
    # PV production
    (11, "Panneaux PV Toiture",   "electricity_P", "PV",   1.00, 0.98, 0.01, "local_generators"),
    # CHP
    (12, "Cogeration CHP Elec",   "electricity_P", "CHP",  1.00, 0.88, 0.03, "local_generators"),
    # Cooling
    (13, "Groupe Froid Principal", "cooling_P",     "cool_elec", 0.65, 0.82, 0.04, "cooling"),
    (14, "Groupe Froid Secours",  "cooling_P",     "cool_elec", 0.35, 0.84, 0.05, "cooling"),
    # Heating
    (15, "Chauffage CHP Therm",   "heating_P",     "CHP_heat",  1.00, 0.90, 0.03, "heating"),
]


def load_source(filename):
    """Load a source CSV file, filter to date range, return DataFrame."""
    filepath = DATA_DIR / f"{filename}.csv.gz"
    if not filepath.exists():
        print(f"  WARNING: {filepath} not found, skipping.")
        return None
    df = pd.read_csv(filepath, parse_dates=["datetime_utc"])
    df = df.rename(columns={"datetime_utc": "timestamp"})
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    df = df[(df["timestamp"] >= DATE_START) & (df["timestamp"] < DATE_END)].copy()
    df = df.sort_values("timestamp").reset_index(drop=True)
    print(f"  Loaded {filename}: {len(df):,} rows ({df['timestamp'].min()} → {df['timestamp'].max()})")
    return df


def process_machine(machine_def, source_cache):
    """Process a single virtual machine definition, return telemetry DataFrame."""
    mid, name, src_file, src_col, fraction, cos_mu, cos_sigma, category = machine_def
    rng = np.random.default_rng(seed=mid * 42)

    # Load source if not cached
    if src_file not in source_cache:
        source_cache[src_file] = load_source(src_file)
    df_src = source_cache[src_file]
    if df_src is None:
        return None

    if src_col not in df_src.columns:
        print(f"  WARNING: Column '{src_col}' not in {src_file}, skipping machine {mid}")
        return None

    df = pd.DataFrame()
    df["timestamp"] = df_src["timestamp"].copy()

    # Power in Watts (apply fraction + noise)
    raw_power = pd.to_numeric(df_src[src_col], errors="coerce").fillna(0).values
    noise = rng.normal(1.0, 0.05, len(raw_power))
    power_w = np.abs(raw_power * fraction * noise)

    # Convert W → kWh (1-min resolution: kWh = W / 1000 / 60)
    df["kwh"] = power_w / 1000.0 / 60.0

    # cos_phi with temporal variation
    n = len(df)
    base_cos = rng.normal(cos_mu, cos_sigma, n)
    # Daily cycle (cos_phi drops slightly at night)
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

    # etat (state): derive from power
    p95 = np.percentile(power_w[power_w > 0], 95) if np.any(power_w > 0) else 1.0
    thresh_run = max(p95 * 0.15, 50)
    thresh_idle = max(p95 * 0.03, 5)
    df["etat"] = np.where(power_w > thresh_run, 1,
                 np.where(power_w > thresh_idle, 2, 0))

    # output_pieces (simulated, proportional to load)
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

    # label_anomalie: statistical outliers (z-score > 2.5) + random 2%
    z = np.abs((df["kwh"].values - df["kwh"].mean()) / max(df["kwh"].std(), 1e-9))
    anomaly_stat = (z > 2.5).astype(int)
    anomaly_rand = (rng.random(n) < 0.02).astype(int)
    df["label_anomalie"] = np.maximum(anomaly_stat, anomaly_rand)

    # machine_id
    df["machine_id"] = mid

    # Round to save space
    for col in ["kwh", "kva", "cos_phi", "thd_v", "thd_i", "harm_3", "harm_5", "harm_7", "output_tonnage", "oee"]:
        df[col] = df[col].round(4)

    # Select columns in order
    result = df[[
        "timestamp", "machine_id", "kwh", "kva", "cos_phi",
        "thd_v", "thd_i", "harm_3", "harm_5", "harm_7",
        "output_pieces", "output_tonnage", "etat", "oee", "label_anomalie",
    ]]

    return result


def main():
    print("=" * 60)
    print("  HRI-EU Reduced -> ISO 50001 Telemetry Converter")
    print(f"  Date range: {DATE_START} → {DATE_END}")
    print(f"  Machines: {len(MACHINES)}")
    print("=" * 60)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source_cache = {}
    all_frames = []
    processed = 0

    for machine_def in MACHINES:
        mid, name = machine_def[0], machine_def[1]
        print(f"\n  [{mid:2d}] {name}...")
        try:
            df = process_machine(machine_def, source_cache)
            if df is not None and len(df) > 0:
                all_frames.append(df)
                processed += 1
                anomaly_rate = df["label_anomalie"].mean()
                print(f"      ✓ {len(df):,} rows, anomaly_rate={anomaly_rate:.2%}, kwh_mean={df['kwh'].mean():.4f}")
            else:
                print(f"      ✗ No data")
        except Exception as e:
            print(f"      ✗ ERROR: {e}")

    print(f"\n{'='*60}")
    print(f"  Processed: {processed}/{len(MACHINES)} machines")

    if not all_frames:
        print("  ERROR: No data frames produced!")
        sys.exit(1)

    # Concatenate
    print(f"\n  Concatenating {len(all_frames)} DataFrames...")
    final = pd.concat(all_frames, ignore_index=True)
    final = final.sort_values(["timestamp", "machine_id"]).reset_index(drop=True)

    # Stats
    print(f"\n  Final Dataset:")
    print(f"    Total rows:    {len(final):,}")
    print(f"    Machines:      {final['machine_id'].nunique()}")
    print(f"    Date range:    {final['timestamp'].min()} → {final['timestamp'].max()}")
    print(f"    Anomaly rate:  {final['label_anomalie'].mean():.2%}")
    print(f"    Columns:       {list(final.columns)}")

    # Save
    print(f"\n  Saving to {OUTPUT_FILE}...")
    final.to_csv(OUTPUT_FILE, index=False)
    size_mb = OUTPUT_FILE.stat().st_size / (1024 ** 2)
    print(f"  ✅ Saved! Size: {size_mb:.1f} MB")
    print(f"\n  Machine summary:")
    for m in MACHINES:
        mid = m[0]
        subset = final[final["machine_id"] == mid]
        if len(subset) > 0:
            print(f"    ID={mid:2d} | {m[1]:25s} | {m[7]:18s} | {len(subset):>8,} rows | kwh={subset['kwh'].mean():.4f}")

    print(f"\n{'='*60}")
    print(f"  ✅ DONE! File ready at: {OUTPUT_FILE}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
