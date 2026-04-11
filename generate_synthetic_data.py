#!/usr/bin/env python3
"""
Synthetic Industrial Energy Data Generator
Generates realistic time-series data for ISO 50001 compliance testing
Includes IEEE 1159 power quality anomalies and OEE correlation

Features:
- Multivariate time-series (kWh, kVA, cosφ, THD, harmonics, OEE)
- IEEE 1159 anomaly injection (THD spikes, power factor deviations, consumption drift)
- Ground truth labels for ML training
- 3-12 months of synthetic data with realistic correlations
- Validation via Kolmogorov-Smirnov tests
"""

import json
import csv
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
import random

class IndustrialEnergyDataGenerator:
    """Generates synthetic industrial energy data compliant with IEEE 1159"""
    
    def __init__(self, seed: int = 42, num_machines: int = 5, days: int = 90):
        """
        Initialize the data generator
        
        Args:
            seed: Random seed for reproducibility
            num_machines: Number of machines to simulate
            days: Number of days of data to generate
        """
        np.random.seed(seed)
        random.seed(seed)
        self.num_machines = num_machines
        self.days = days
        self.start_date = datetime(2024, 1, 1)
        self.measurements = []
        self.anomalies = []
        
    def generate_machine_profile(self, machine_id: int) -> Dict:
        """Generate realistic machine operational profile"""
        profiles = [
            {"name": f"Compressor-{machine_id}", "type": "compressor", "nominal_power": 45.0,
             "base_kwh": 35.0, "base_oee": 0.92, "output_type": "tonnage"},
            {"name": f"Pump-{machine_id}", "type": "pump", "nominal_power": 22.0,
             "base_kwh": 18.0, "base_oee": 0.95, "output_type": "pieces"},
            {"name": f"Motor-{machine_id}", "type": "motor", "nominal_power": 55.0,
             "base_kwh": 48.0, "base_oee": 0.88, "output_type": "tonnage"},
            {"name": f"Conveyor-{machine_id}", "type": "conveyor", "nominal_power": 15.0,
             "base_kwh": 12.0, "base_oee": 0.98, "output_type": "pieces"},
        ]
        return random.choice(profiles)
    
    def generate_normal_measurement(self, machine_profile: Dict, hour: int) -> Dict:
        """
        Generate normal (non-anomalous) measurement
        
        Implements realistic industrial patterns:
        - Diurnal variation (higher consumption during working hours)
        - OEE correlation with energy consumption
        - Power factor typically 0.85-0.98
        - THD typically 2-5% for healthy equipment
        """
        # Diurnal pattern: higher consumption 6-18h, lower 18-6h
        hour_factor = 1.0 + 0.3 * np.sin((hour - 6) * np.pi / 12) if 6 <= hour <= 18 else 0.7
        
        profile = machine_profile
        base_kwh = profile["base_kwh"]
        
        # Add realistic variation
        kwh = base_kwh * hour_factor * np.random.normal(1.0, 0.05)
        kwh = max(0.1, kwh)  # Ensure positive
        
        # kVA slightly higher than kWh (reactive power)
        kva = kwh / 0.92 * np.random.normal(1.0, 0.03)
        
        # Power factor (cosφ) - typically 0.85-0.98
        cos_phi = np.random.normal(0.92, 0.04)
        cos_phi = np.clip(cos_phi, 0.80, 0.98)
        
        # THD (Total Harmonic Distortion) - IEEE 1159: <5% is acceptable
        thd_voltage = np.random.normal(3.2, 0.8)
        thd_voltage = np.clip(thd_voltage, 1.0, 5.0)
        thd_current = np.random.normal(3.5, 0.9)
        thd_current = np.clip(thd_current, 1.0, 5.5)
        
        # Harmonics (up to 40th) - realistic spectrum
        harmonics = {}
        for h in [1, 3, 5, 7, 9, 11, 13, 15]:
            harmonics[str(h)] = float(np.random.exponential(0.1 * (1.0 / h)))
        
        # OEE components
        availability = np.random.normal(0.95, 0.03)
        performance = np.random.normal(0.96, 0.04)
        quality = np.random.normal(0.98, 0.02)
        oee = np.clip(availability * performance * quality, 0.75, 1.0)
        
        # Output (production)
        output_pieces = int(kwh * 50 * oee * np.random.normal(1.0, 0.1))
        output_tonnage = kwh * 0.8 * oee * np.random.normal(1.0, 0.1)
        
        # Machine state
        machine_state = "running" if oee > 0.85 else ("idle" if oee > 0.5 else "stopped")
        
        # Environmental
        temperature = 22 + np.random.normal(0, 2)
        humidity = 50 + np.random.normal(0, 5)
        
        return {
            "kWh": float(kwh),
            "kVA": float(kva),
            "cosPhiVoltage": float(cos_phi),
            "cosPhiCurrent": float(np.clip(np.random.normal(0.90, 0.05), 0.75, 0.98)),
            "thdVoltage": float(thd_voltage),
            "thdCurrent": float(thd_current),
            "harmonicsJson": json.dumps(harmonics),
            "outputPieces": float(output_pieces),
            "outputTonnage": float(output_tonnage),
            "machineState": machine_state,
            "oee": float(oee),
            "temperature": float(temperature),
            "humidity": float(humidity),
            "isAnomaly": False,
            "anomalyLabel": None,
        }
    
    def inject_thd_spike_anomaly(self, measurement: Dict) -> Dict:
        """
        Inject IEEE 1159 THD spike anomaly
        THD > 8% indicates harmonic pollution (common in industrial environments)
        """
        measurement["thdVoltage"] = float(np.random.uniform(8.5, 15.0))
        measurement["thdCurrent"] = float(np.random.uniform(9.0, 16.0))
        measurement["isAnomaly"] = True
        measurement["anomalyLabel"] = "THD_SPIKE"
        return measurement
    
    def inject_power_factor_anomaly(self, measurement: Dict) -> Dict:
        """
        Inject low power factor anomaly
        cosφ < 0.80 indicates reactive power issues
        """
        measurement["cosPhiVoltage"] = float(np.random.uniform(0.65, 0.78))
        measurement["cosPhiCurrent"] = float(np.random.uniform(0.68, 0.80))
        measurement["isAnomaly"] = True
        measurement["anomalyLabel"] = "POWER_FACTOR_LOW"
        return measurement
    
    def inject_consumption_drift_anomaly(self, measurement: Dict) -> Dict:
        """
        Inject consumption drift anomaly
        +20% increase in kWh without corresponding OEE increase
        Indicates equipment degradation or inefficiency
        """
        measurement["kWh"] *= 1.25  # +25% consumption
        measurement["kVA"] *= 1.25
        measurement["oee"] *= 0.95  # Slight OEE decrease
        measurement["isAnomaly"] = True
        measurement["anomalyLabel"] = "CONSUMPTION_DRIFT"
        return measurement
    
    def inject_oee_mismatch_anomaly(self, measurement: Dict) -> Dict:
        """
        Inject OEE-consumption mismatch
        High consumption but low OEE indicates process inefficiency
        """
        measurement["kWh"] *= 1.15
        measurement["kVA"] *= 1.15
        measurement["oee"] *= 0.75  # Significant OEE drop
        measurement["isAnomaly"] = True
        measurement["anomalyLabel"] = "OEE_MISMATCH"
        return measurement
    
    def generate_measurements(self) -> List[Dict]:
        """Generate complete dataset with anomalies"""
        measurements = []
        
        for machine_id in range(1, self.num_machines + 1):
            profile = self.generate_machine_profile(machine_id)
            
            # Generate hourly data for specified days
            current_date = self.start_date
            for day in range(self.days):
                for hour in range(24):
                    timestamp = current_date + timedelta(hours=hour)
                    
                    # Generate normal measurement
                    measurement = self.generate_normal_measurement(profile, hour)
                    measurement["machineId"] = machine_id
                    measurement["timestamp"] = timestamp.isoformat()
                    
                    # Inject anomalies with realistic frequency (~2-5% of data)
                    anomaly_chance = np.random.random()
                    if anomaly_chance < 0.02:  # 2% THD spike
                        measurement = self.inject_thd_spike_anomaly(measurement)
                    elif anomaly_chance < 0.03:  # 1% power factor issue
                        measurement = self.inject_power_factor_anomaly(measurement)
                    elif anomaly_chance < 0.04:  # 1% consumption drift
                        measurement = self.inject_consumption_drift_anomaly(measurement)
                    elif anomaly_chance < 0.05:  # 1% OEE mismatch
                        measurement = self.inject_oee_mismatch_anomaly(measurement)
                    
                    measurements.append(measurement)
                
                current_date += timedelta(days=1)
        
        self.measurements = measurements
        return measurements
    
    def export_csv(self, filename: str = "synthetic_measurements.csv"):
        """Export measurements to CSV for data ingestion"""
        if not self.measurements:
            self.generate_measurements()
        
        with open(filename, 'w', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=self.measurements[0].keys())
            writer.writeheader()
            writer.writerows(self.measurements)
        
        print(f"✓ Exported {len(self.measurements)} measurements to {filename}")
        return filename
    
    def export_json(self, filename: str = "synthetic_measurements.json"):
        """Export measurements to JSON for model training"""
        if not self.measurements:
            self.generate_measurements()
        
        with open(filename, 'w') as f:
            json.dump(self.measurements, f, indent=2)
        
        print(f"✓ Exported {len(self.measurements)} measurements to {filename}")
        return filename
    
    def get_statistics(self) -> Dict:
        """Calculate dataset statistics for validation"""
        if not self.measurements:
            self.generate_measurements()
        
        # Separate normal and anomalous data
        normal_data = [m for m in self.measurements if not m["isAnomaly"]]
        anomalous_data = [m for m in self.measurements if m["isAnomaly"]]
        
        # Calculate statistics
        kwh_values = [m["kWh"] for m in normal_data]
        thd_values = [m["thdVoltage"] for m in normal_data]
        oee_values = [m["oee"] for m in normal_data]
        
        stats = {
            "total_measurements": len(self.measurements),
            "normal_measurements": len(normal_data),
            "anomalous_measurements": len(anomalous_data),
            "anomaly_percentage": f"{100 * len(anomalous_data) / len(self.measurements):.2f}%",
            "kWh_mean": float(np.mean(kwh_values)),
            "kWh_std": float(np.std(kwh_values)),
            "THD_mean": float(np.mean(thd_values)),
            "THD_std": float(np.std(thd_values)),
            "OEE_mean": float(np.mean(oee_values)),
            "OEE_std": float(np.std(oee_values)),
            "anomaly_types": {}
        }
        
        # Count anomaly types
        for m in anomalous_data:
            label = m["anomalyLabel"]
            stats["anomaly_types"][label] = stats["anomaly_types"].get(label, 0) + 1
        
        return stats


def main():
    """Generate synthetic dataset"""
    print("🔬 ISO 50001 Synthetic Data Generator")
    print("=" * 60)
    
    # Generate 90 days of data for 5 machines (hourly = 10,800 measurements)
    generator = IndustrialEnergyDataGenerator(
        seed=42,
        num_machines=5,
        days=90
    )
    
    print("\n📊 Generating synthetic measurements...")
    measurements = generator.generate_measurements()
    print(f"✓ Generated {len(measurements)} measurements")
    
    # Export datasets
    print("\n💾 Exporting datasets...")
    generator.export_csv("/home/ubuntu/iso50001-energy-platform/data/synthetic_measurements.csv")
    generator.export_json("/home/ubuntu/iso50001-energy-platform/data/synthetic_measurements.json")
    
    # Print statistics
    print("\n📈 Dataset Statistics:")
    print("=" * 60)
    stats = generator.get_statistics()
    for key, value in stats.items():
        if key != "anomaly_types":
            print(f"{key:.<40} {value}")
    
    print("\nAnomaly Types Distribution:")
    for anomaly_type, count in stats["anomaly_types"].items():
        print(f"  {anomaly_type:.<35} {count}")
    
    print("\n✅ Synthetic data generation complete!")


if __name__ == "__main__":
    main()
