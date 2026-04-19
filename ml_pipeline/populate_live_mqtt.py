"""
Populate all 15 HRI-EU machines with realistic live data via MQTT.
Sends normal data + a few anomalies to demonstrate detection.
"""
import json, time, ssl, random
import paho.mqtt.client as mqtt

BROKER = "26e60269225d4eca970c0409be1d00f4.s1.eu.hivemq.cloud"
PORT = 8883
USER = "Iso-50001_platform"
PASS = "Iheb2002"

# 15 HRI-EU machines with realistic parameters
MACHINES = [
    {"id": 1,  "name": "Serveur Rack A",        "kwh_base": 0.28, "cos": 0.91, "etat": 1, "oee": 88},
    {"id": 2,  "name": "Serveur Rack B",        "kwh_base": 0.22, "cos": 0.90, "etat": 1, "oee": 85},
    {"id": 3,  "name": "Serveur Rack C",        "kwh_base": 0.18, "cos": 0.92, "etat": 1, "oee": 82},
    {"id": 4,  "name": "Eclairage Bureau H2",   "kwh_base": 0.10, "cos": 0.95, "etat": 1, "oee": 90},
    {"id": 5,  "name": "Eclairage Bureau H4",   "kwh_base": 0.08, "cos": 0.94, "etat": 2, "oee": 45},
    {"id": 6,  "name": "Atelier Emission Lab",  "kwh_base": 0.35, "cos": 0.80, "etat": 1, "oee": 76},
    {"id": 7,  "name": "Atelier Mecanique",      "kwh_base": 0.19, "cos": 0.83, "etat": 1, "oee": 72},
    {"id": 8,  "name": "Design Studio",          "kwh_base": 0.12, "cos": 0.93, "etat": 1, "oee": 88},
    {"id": 9,  "name": "Ventilation CTA H2",    "kwh_base": 0.15, "cos": 0.86, "etat": 1, "oee": 80},
    {"id": 10, "name": "Ventilation CTA H3",    "kwh_base": 0.11, "cos": 0.85, "etat": 1, "oee": 78},
    {"id": 11, "name": "Panneaux PV Toiture",   "kwh_base": 1.20, "cos": 0.98, "etat": 1, "oee": 95},
    {"id": 12, "name": "Cogeration CHP Elec",   "kwh_base": 1.10, "cos": 0.88, "etat": 1, "oee": 91},
    {"id": 13, "name": "Groupe Froid Principal", "kwh_base": 0.25, "cos": 0.82, "etat": 1, "oee": 70},
    {"id": 14, "name": "Groupe Froid Secours",   "kwh_base": 0.14, "cos": 0.84, "etat": 2, "oee": 40},
    {"id": 15, "name": "Chauffage CHP Therm",   "kwh_base": 1.80, "cos": 0.90, "etat": 1, "oee": 86},
]

# Machines that will have anomalies
ANOMALY_MACHINES = {6, 13}

def make_payload(m, anomaly=False):
    import math
    kwh = m["kwh_base"] * random.uniform(0.85, 1.15)
    cos = min(0.99, max(0.6, m["cos"] + random.uniform(-0.02, 0.02)))
    kva = kwh / cos
    thd_i = math.sqrt(1.0 / cos**2 - 1.0) * 100.0
    thd_v = (0.03 + 0.05 * (1.0 - cos)) * 100.0

    if anomaly:
        kwh = 0.0
        kva = 0.0
        etat = 0
        oee = 0.0
    else:
        etat = m["etat"]
        oee = m["oee"] + random.uniform(-3, 3)

    return {
        "machine_id": m["id"],
        "kwh": round(kwh, 4),
        "kva": round(kva, 4),
        "cos_phi": round(cos, 4),
        "thd_v": round(thd_v, 2),
        "thd_i": round(thd_i, 2),
        "harm_3": round(0.15 * thd_i / 100, 4),
        "harm_5": round(0.50 * thd_i / 100, 4),
        "harm_7": round(0.25 * thd_i / 100, 4),
        "etat": etat,
        "oee": round(max(0, min(100, oee)), 1),
        "label_anomalie": 1 if anomaly else 0,
    }

def main():
    print("=" * 60)
    print("  Populating 15 HRI-EU machines via MQTT")
    print("=" * 60)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="populate-15")
    client.username_pw_set(USER, PASS)
    client.tls_set(tls_version=ssl.PROTOCOL_TLS_CLIENT)
    client.connect(BROKER, PORT, 60)
    client.loop_start()
    time.sleep(2)
    print("  Connected to HiveMQ Cloud")

    total = 0
    anomalies = 0
    rounds = 8  # Send 8 rounds of data per machine

    for rnd in range(rounds):
        for m in MACHINES:
            is_anomaly = (m["id"] in ANOMALY_MACHINES and rnd == 3)
            payload = make_payload(m, anomaly=is_anomaly)
            topic = f"energy/machine/{m['id']}"
            client.publish(topic, json.dumps(payload), qos=1)
            total += 1
            if is_anomaly:
                anomalies += 1
                print(f"  [!] Anomaly published: machine {m['id']} ({m['name']})")
            time.sleep(0.05)  # 50ms between messages

        print(f"  Round {rnd+1}/{rounds}: {len(MACHINES)} machines")
        time.sleep(0.5)

    # Final wait for debounce save
    time.sleep(3)
    print(f"\n  Total: {total} messages, {anomalies} anomalies")
    print("  Done!")

    client.loop_stop()
    client.disconnect()

if __name__ == "__main__":
    main()
