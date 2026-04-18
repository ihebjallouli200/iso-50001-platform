#!/usr/bin/env python3
"""
MQTT Publisher for HRI-EU Telemetry Data -> HiveMQ Cloud.

Reads the converted telemetry CSV and publishes each row as a JSON payload
to the MQTT topic `energy/machine/{machine_id}`.

Usage:
    py -3.11 ml_pipeline/publisher_hriu_mqtt.py [--speed 10] [--limit 1000]

    --speed N  : Publish N rows per second (default: 10)
    --limit N  : Limit to N total messages (default: unlimited)
    --machine N: Only publish for machine_id=N (default: all)
"""

import os
import sys
import csv
import json
import time
import argparse
import ssl
from datetime import datetime, timezone
from pathlib import Path

import paho.mqtt.client as mqtt

# ============================================================
# CONFIG
# ============================================================
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_FILE = BASE_DIR / "data" / "processed" / "hriu_machine_telemetry_1min.csv"

# HiveMQ Cloud credentials
MQTT_BROKER = "26e60269225d4eca970c0409be1d00f4.s1.eu.hivemq.cloud"
MQTT_PORT = 8883  # TLS
MQTT_USERNAME = "Iso-50001_platform"
MQTT_PASSWORD = "Iheb2002"
MQTT_TOPIC_PREFIX = "energy/machine"

# Machine names for display
MACHINE_NAMES = {
    1: "Serveur Rack A", 2: "Serveur Rack B", 3: "Serveur Rack C",
    4: "Eclairage Bureau H2", 5: "Eclairage Bureau H4",
    6: "Atelier Emission Lab", 7: "Atelier Mecanique",
    8: "Design Studio", 9: "Ventilation CTA H2", 10: "Ventilation CTA H3",
    11: "Panneaux PV Toiture", 12: "Cogeration CHP Elec",
    13: "Groupe Froid Principal", 14: "Groupe Froid Secours",
    15: "Chauffage CHP Therm",
}


def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        print("  Connected to HiveMQ Cloud!")
    else:
        print(f"  Connection failed: {reason_code}")


def on_publish(client, userdata, mid, reason_code=None, properties=None):
    userdata["published"] += 1


def create_mqtt_client():
    """Create and connect MQTT client with TLS."""
    userdata = {"published": 0}
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="iso50001-hriu-publisher",
        userdata=userdata,
    )
    client.username_pw_set(MQTT_USERNAME, MQTT_PASSWORD)

    # TLS for HiveMQ Cloud
    client.tls_set(tls_version=ssl.PROTOCOL_TLS_CLIENT)
    client.tls_insecure_set(False)

    client.on_connect = on_connect
    client.on_publish = on_publish

    print(f"  Connecting to {MQTT_BROKER}:{MQTT_PORT}...")
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()
    time.sleep(2)  # Wait for connection

    return client, userdata


def publish_telemetry(client, userdata, args):
    """Read CSV and publish rows as MQTT messages."""
    if not DATA_FILE.exists():
        print(f"  ERROR: Data file not found: {DATA_FILE}")
        sys.exit(1)

    delay = 1.0 / args.speed
    published = 0
    errors = 0
    start_time = time.time()

    print(f"\n  Publishing from: {DATA_FILE}")
    print(f"  Speed: {args.speed} msg/sec")
    if args.limit:
        print(f"  Limit: {args.limit} messages")
    if args.machine:
        print(f"  Filter: machine_id={args.machine}")
    print(f"  Topic: {MQTT_TOPIC_PREFIX}/{{machine_id}}")
    print()

    with open(DATA_FILE, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            machine_id = int(row["machine_id"])

            # Filter by machine if specified
            if args.machine and machine_id != args.machine:
                continue

            # Build payload with real-time timestamp
            payload = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "original_timestamp": row["timestamp"],
                "machine_id": machine_id,
                "kwh": float(row["kwh"]),
                "kva": float(row["kva"]),
                "cos_phi": float(row["cos_phi"]),
                "thd_v": float(row["thd_v"]),
                "thd_i": float(row["thd_i"]),
                "harm_3": float(row["harm_3"]),
                "harm_5": float(row["harm_5"]),
                "harm_7": float(row["harm_7"]),
                "output_pieces": int(row["output_pieces"]),
                "output_tonnage": float(row["output_tonnage"]),
                "etat": int(row["etat"]),
                "oee": float(row["oee"]),
                "label_anomalie": int(row["label_anomalie"]),
            }

            topic = f"{MQTT_TOPIC_PREFIX}/{machine_id}"
            result = client.publish(topic, json.dumps(payload), qos=1)

            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                published += 1
            else:
                errors += 1

            # Progress display
            if published % 100 == 0:
                elapsed = time.time() - start_time
                rate = published / max(elapsed, 0.001)
                name = MACHINE_NAMES.get(machine_id, f"Machine {machine_id}")
                print(
                    f"  [{published:>8,}] {name:25s} | "
                    f"kwh={payload['kwh']:.4f} | "
                    f"anomaly={payload['label_anomalie']} | "
                    f"{rate:.1f} msg/s",
                    end="\r",
                )

            # Rate limiting
            time.sleep(delay)

            # Limit check
            if args.limit and published >= args.limit:
                break

    elapsed = time.time() - start_time
    rate = published / max(elapsed, 0.001)

    print(f"\n\n{'='*60}")
    print(f"  Publishing complete!")
    print(f"  Published: {published:,}")
    print(f"  Errors:    {errors}")
    print(f"  Duration:  {elapsed:.1f}s")
    print(f"  Rate:      {rate:.1f} msg/s")
    print(f"{'='*60}")


def main():
    parser = argparse.ArgumentParser(description="HRI-EU MQTT Publisher")
    parser.add_argument("--speed", type=int, default=10, help="Messages per second")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of messages")
    parser.add_argument("--machine", type=int, default=None, help="Filter by machine ID")
    args = parser.parse_args()

    print("=" * 60)
    print("  HRI-EU MQTT Publisher -> HiveMQ Cloud")
    print("=" * 60)

    client, userdata = create_mqtt_client()

    try:
        publish_telemetry(client, userdata, args)
    except KeyboardInterrupt:
        print("\n\n  Stopped by user.")
    finally:
        client.loop_stop()
        client.disconnect()
        print(f"  Total published via MQTT: {userdata['published']:,}")


if __name__ == "__main__":
    main()
