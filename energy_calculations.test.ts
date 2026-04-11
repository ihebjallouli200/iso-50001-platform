import { describe, it, expect } from "vitest";
import * as calc from "./energy_calculations";

describe("Energy Calculations - ISO 50001", () => {
  describe("EnPI Ratio Calculation", () => {
    it("should calculate EnPI correctly using ratio method", () => {
      const enpi = calc.calculateEnPIRatio(1000, 500, "pieces");
      expect(enpi).toBe(2.0);
      expect(enpi).toBeCloseTo(2.0, 2);
    });

    it("should handle zero output gracefully", () => {
      const enpi = calc.calculateEnPIRatio(1000, 0, "pieces");
      expect(enpi).toBe(0);
    });

    it("should calculate different ratios correctly", () => {
      expect(calc.calculateEnPIRatio(500, 250, "pieces")).toBe(2.0);
      expect(calc.calculateEnPIRatio(1500, 300, "tonnage")).toBe(5.0);
    });
  });

  describe("EnPI Regression Calculation", () => {
    it("should calculate regression-based EnPI correctly", () => {
      const coefficients = {
        intercept: 5.0,
        production: 0.02,
        temperature: 0.15,
      };
      const variables = {
        production: 100,
        temperature: 20,
      };

      const enpi = calc.calculateEnPIRegression(coefficients, variables);
      // 5.0 + (0.02 * 100) + (0.15 * 20) = 5.0 + 2.0 + 3.0 = 10.0
      expect(enpi).toBe(10.0);
    });

    it("should ensure non-negative EnPI values", () => {
      const coefficients = {
        intercept: -100,
        production: 0.01,
      };
      const variables = { production: 100 };

      const enpi = calc.calculateEnPIRegression(coefficients, variables);
      expect(enpi).toBeGreaterThanOrEqual(0);
    });
  });

  describe("EnPI Normalization", () => {
    it("should normalize EnPI with factors", () => {
      const enpi = 2.0;
      const factors = { production: 1.05, temperature: 0.98 };

      const normalized = calc.normalizeEnPI(enpi, factors);
      // 2.0 * 1.05 * 0.98 = 2.058
      expect(normalized).toBeCloseTo(2.058, 2);
    });

    it("should handle empty normalization factors", () => {
      const enpi = 2.0;
      const normalized = calc.normalizeEnPI(enpi, {});
      expect(normalized).toBe(2.0);
    });
  });

  describe("EnPI Deviation Calculation", () => {
    it("should calculate positive deviation (degradation)", () => {
      const current = 2.2;
      const baseline = 2.0;
      const deviation = calc.calculateEnPIDeviation(current, baseline);

      expect(deviation).toBeCloseTo(10.0, 1); // 10% degradation
    });

    it("should calculate negative deviation (improvement)", () => {
      const current = 1.8;
      const baseline = 2.0;
      const deviation = calc.calculateEnPIDeviation(current, baseline);

      expect(deviation).toBeCloseTo(-10.0, 1); // 10% improvement
    });

    it("should handle zero baseline", () => {
      const deviation = calc.calculateEnPIDeviation(2.0, 0);
      expect(deviation).toBe(0);
    });
  });

  describe("Improvement Proof Calculation (ISO 50001 Clause 10.2)", () => {
    it("should calculate improvement correctly", () => {
      const baseline = 2.0;
      const normalized = 1.8;
      const improvement = calc.calculateImprovementProof(baseline, normalized);

      // (2.0 - 1.8) / 2.0 * 100 = 10%
      expect(improvement).toBeCloseTo(10.0, 1);
    });

    it("should show zero improvement if no change", () => {
      const improvement = calc.calculateImprovementProof(2.0, 2.0);
      expect(improvement).toBe(0);
    });

    it("should show negative improvement if degradation", () => {
      const baseline = 2.0;
      const normalized = 2.2;
      const improvement = calc.calculateImprovementProof(baseline, normalized);

      // (2.0 - 2.2) / 2.0 * 100 = -10%
      expect(improvement).toBeCloseTo(-10.0, 1);
    });
  });

  describe("EnPI Status Determination", () => {
    it("should return normal status for small deviations", () => {
      expect(calc.determineEnPIStatus(2.0)).toBe("normal");
      expect(calc.determineEnPIStatus(-2.0)).toBe("normal");
    });

    it("should return warning status for moderate deviations", () => {
      expect(calc.determineEnPIStatus(7.0)).toBe("warning");
      expect(calc.determineEnPIStatus(-7.0)).toBe("warning");
    });

    it("should return critical status for large deviations", () => {
      expect(calc.determineEnPIStatus(20.0)).toBe("critical");
      expect(calc.determineEnPIStatus(-20.0)).toBe("critical");
    });

    it("should respect custom thresholds", () => {
      expect(calc.determineEnPIStatus(3.0, 2.0, 10.0)).toBe("warning");
      expect(calc.determineEnPIStatus(12.0, 5.0, 10.0)).toBe("critical");
    });
  });

  describe("PDCA Plan Generation", () => {
    it("should generate plan with correct target", () => {
      const currentEnPI = 2.0;
      const targetImprovement = 0.1; // 10%

      const plan = calc.generatePDCAPlan(currentEnPI, targetImprovement);

      expect(plan.targetEnPI).toBeCloseTo(1.8, 2); // 2.0 * (1 - 0.1)
      expect(plan.targetImprovement).toBe(0.1);
      expect(plan.actions).toHaveLength(4);
    });

    it("should generate actionable items", () => {
      const plan = calc.generatePDCAPlan(2.0, 0.05);

      expect(plan.actions).toContain("Review current energy consumption patterns");
      expect(plan.actions).toContain("Identify and prioritize energy-saving opportunities");
    });
  });

  describe("PDCA Check Evaluation", () => {
    it("should mark target as achieved when EnPI meets target", () => {
      const result = calc.evaluatePDCACheck(1.8, 1.75, 2.0);

      expect(result.targetAchieved).toBe(true);
      expect(result.improvementPercent).toBeCloseTo(12.5, 1);
    });

    it("should mark target as not achieved when EnPI exceeds target", () => {
      const result = calc.evaluatePDCACheck(1.8, 1.9, 2.0);

      expect(result.targetAchieved).toBe(false);
      expect(result.improvementPercent).toBeCloseTo(5.0, 1);
    });
  });

  describe("Corrective Actions Generation", () => {
    it("should generate corrective actions when target not achieved", () => {
      const checkResult = {
        targetAchieved: false,
        improvementPercent: 2.0,
        enpiAchieved: 1.96,
        notes: "Target not achieved",
      };

      const anomalies = [
        { anomalyType: "THD_SPIKE" },
        { anomalyType: "CONSUMPTION_DRIFT" },
      ];

      const actions = calc.generateCorrectiveActions(checkResult, anomalies);

      expect(actions.length).toBeGreaterThan(0);
      expect(actions).toContain("Conduct root cause analysis for underperformance");
      expect(actions).toContain("Perform harmonic analysis and install filters if needed");
      expect(actions).toContain("Schedule equipment maintenance and calibration");
    });

    it("should not generate corrective actions when target achieved", () => {
      const checkResult = {
        targetAchieved: true,
        improvementPercent: 10.0,
        enpiAchieved: 1.8,
        notes: "Target achieved",
      };

      const actions = calc.generateCorrectiveActions(checkResult, []);

      expect(actions.length).toBe(0);
    });
  });

  describe("Audit Trail Creation", () => {
    it("should create audit trail entry with all required fields", () => {
      const entry = calc.createAuditTrailEntry(
        "user123",
        "EnPI_CALCULATED",
        { enpi: 2.0, baseline: 2.1 },
        "Routine calculation"
      );

      expect(entry.user).toBe("user123");
      expect(entry.action).toBe("EnPI_CALCULATED");
      expect(entry.changes).toEqual({ enpi: 2.0, baseline: 2.1 });
      expect(entry.reason).toBe("Routine calculation");
      expect(entry.timestamp).toBeDefined();
      expect(new Date(entry.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("should handle optional changes and reason", () => {
      const entry = calc.createAuditTrailEntry("user456", "BASELINE_UPDATED");

      expect(entry.user).toBe("user456");
      expect(entry.action).toBe("BASELINE_UPDATED");
      expect(entry.changes).toBeUndefined();
      expect(entry.reason).toBeUndefined();
    });
  });

  describe("ISO 50006 Compliance", () => {
    it("should calculate regression coefficients with R² > 0.7", () => {
      const measurements = Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date(),
        kWh: 20 + Math.random() * 10,
        kVA: 25 + Math.random() * 12,
        cosPhiVoltage: 0.95 + Math.random() * 0.05,
        cosPhiCurrent: 0.93 + Math.random() * 0.07,
        thdVoltage: 3 + Math.random() * 2,
        thdCurrent: 4 + Math.random() * 3,
        oee: 0.85 + Math.random() * 0.1,
        outputPieces: 100 + Math.random() * 50,
        outputTonnage: null,
        temperature: 20 + Math.random() * 5,
        machineId: 1,
        id: i,
        createdAt: new Date(),
        updatedAt: new Date(),
      })) as any;

      const result = calc.calculateRegressionCoefficients(measurements);

      expect(result.rSquared).toBeGreaterThan(0.7);
      expect(result.coefficients).toHaveProperty("intercept");
      expect(result.coefficients).toHaveProperty("production");
    });
  });
});
