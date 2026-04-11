/**
 * ISO 50001 Audit Report Generation and Export
 * 
 * Implements:
 * - PDF/Excel export with calculation methodology
 * - Audit trail compliance (ISO 50001 clause 7.5)
 * - Non-conformity documentation
 * - Improvement proof evidence
 */

import { Measurement, EnergyPerformanceIndicator, PDCACycle, AuditLog } from "./schema";

export interface AuditReportData {
  reportId: string;
  generatedAt: Date;
  machineId: number;
  machineName: string;
  period: {
    startDate: Date;
    endDate: Date;
  };
  enpiData: {
    current: number;
    baseline: number;
    deviation: number;
    improvementProof: number;
    status: string;
  };
  pdcaCycles: PDCACycle[];
  anomalies: any[];
  auditTrail: AuditLog[];
  calculations: {
    method: "ratio" | "regression";
    formula: string;
    normalizationFactors: Record<string, number>;
    rSquared?: number;
  };
}

/**
 * Generate comprehensive audit report
 */
export function generateAuditReport(
  machineId: number,
  machineName: string,
  measurements: Measurement[],
  enpi: EnergyPerformanceIndicator,
  pdcaCycles: PDCACycle[],
  anomalies: any[],
  auditLogs: AuditLog[]
): AuditReportData {
  const reportId = `AUDIT-${machineId}-${Date.now()}`;
  const generatedAt = new Date();

  // Determine period from measurements
  const timestamps = measurements.map(m => new Date(m.timestamp));
  const startDate = new Date(Math.min(...timestamps.map(t => t.getTime())));
  const endDate = new Date(Math.max(...timestamps.map(t => t.getTime())));

  return {
    reportId,
    generatedAt,
    machineId,
    machineName,
    period: { startDate, endDate },
    enpiData: {
      current: Number(enpi.enpiNormalized) || 0,
      baseline: 0,
      deviation: Number(enpi.enpiDeviation) || 0,
      improvementProof: Number(enpi.improvementProof) || 0,
      status: enpi.status || "unknown",
    },
    pdcaCycles,
    anomalies,
    auditTrail: auditLogs,
    calculations: {
      method: "ratio" as const,
      formula: "EnPI = Total Energy Consumption / Total Output",
      normalizationFactors: {},
      rSquared: undefined,
    },
  };
}

/**
 * Generate PDF report content (returns HTML that can be converted to PDF)
 */
export function generatePDFContent(report: AuditReportData): string {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>ISO 50001 Energy Management Audit Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
    .header { border-bottom: 3px solid #1e40af; padding-bottom: 20px; margin-bottom: 30px; }
    .header h1 { margin: 0; color: #1e40af; }
    .header p { margin: 5px 0; color: #666; }
    .section { margin-bottom: 30px; page-break-inside: avoid; }
    .section h2 { background-color: #1e40af; color: white; padding: 10px; margin: 0 0 15px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #f0f0f0; font-weight: bold; }
    .metric { display: inline-block; width: 48%; margin-right: 2%; vertical-align: top; }
    .status-normal { color: #10b981; font-weight: bold; }
    .status-warning { color: #f59e0b; font-weight: bold; }
    .status-critical { color: #ef4444; font-weight: bold; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
    .audit-trail { font-size: 11px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>ISO 50001 Energy Management Audit Report</h1>
    <p><strong>Report ID:</strong> ${report.reportId}</p>
    <p><strong>Generated:</strong> ${report.generatedAt.toLocaleString()}</p>
    <p><strong>Machine:</strong> ${report.machineName} (ID: ${report.machineId})</p>
    <p><strong>Period:</strong> ${report.period.startDate.toLocaleDateString()} to ${report.period.endDate.toLocaleDateString()}</p>
  </div>

  <div class="section">
    <h2>Energy Performance Indicator (EnPI)</h2>
    <div class="metric">
      <p><strong>Current EnPI:</strong> ${report.enpiData.current.toFixed(4)} kWh/unit</p>
      <p><strong>Baseline EnPI:</strong> ${report.enpiData.baseline.toFixed(4)} kWh/unit</p>
    </div>
    <div class="metric">
      <p><strong>Deviation:</strong> <span class="${
        report.enpiData.deviation < 0 ? "status-normal" : "status-critical"
      }">${report.enpiData.deviation.toFixed(2)}%</span></p>
      <p><strong>Improvement Proof:</strong> <span class="status-normal">${report.enpiData.improvementProof.toFixed(2)}%</span></p>
    </div>
    <p><strong>Status:</strong> <span class="status-${report.enpiData.status.toLowerCase()}">${report.enpiData.status.toUpperCase()}</span></p>
  </div>

  <div class="section">
    <h2>Calculation Methodology (ISO 50006)</h2>
    <p><strong>Method:</strong> ${report.calculations.method.toUpperCase()}</p>
    <p><strong>Formula:</strong> ${report.calculations.formula}</p>
    ${report.calculations.rSquared ? `<p><strong>R² Value:</strong> ${report.calculations.rSquared.toFixed(4)} (ISO 50006 requirement: R² > 0.7)</p>` : ""}
    <p><strong>Normalization Factors:</strong></p>
    <table>
      <tr>
        <th>Factor</th>
        <th>Value</th>
      </tr>
      ${Object.entries(report.calculations.normalizationFactors)
        .map(([key, value]) => `<tr><td>${key}</td><td>${(value as number).toFixed(4)}</td></tr>`)
        .join("")}
    </table>
  </div>

  <div class="section">
    <h2>PDCA Cycle Status (ISO 50001 Clause 8.2)</h2>
    <table>
      <tr>
        <th>Cycle #</th>
        <th>Plan</th>
        <th>Do</th>
        <th>Check</th>
        <th>Act</th>
        <th>Target EnPI</th>
      </tr>
      ${report.pdcaCycles
        .map(
          (cycle) => `
        <tr>
          <td>${cycle.cycleNumber}</td>
          <td>✓ Completed</td>
          <td>${cycle.doStatus === "completed" ? "✓ Completed" : "⊙ " + (cycle.doStatus || "Pending")}</td>
          <td>${cycle.checkStatus === "completed" ? "✓ Completed" : "⊙ " + (cycle.checkStatus || "Pending")}</td>
          <td>${cycle.actStatus === "completed" ? "✓ Completed" : "⊙ " + (cycle.actStatus || "Pending")}</td>
          <td>${cycle.planTargetEnpi || "—"}</td>
        </tr>
      `
        )
        .join("")}
    </table>
  </div>

  <div class="section">
    <h2>Anomalies Detected (IEEE 1159)</h2>
    <table>
      <tr>
        <th>Type</th>
        <th>Count</th>
        <th>Severity</th>
      </tr>
      <tr>
        <td>THD Spike</td>
        <td>${report.anomalies.filter((a) => a.anomalyType === "THD_SPIKE").length}</td>
        <td>Medium</td>
      </tr>
      <tr>
        <td>Consumption Drift</td>
        <td>${report.anomalies.filter((a) => a.anomalyType === "CONSUMPTION_DRIFT").length}</td>
        <td>High</td>
      </tr>
      <tr>
        <td>OEE Mismatch</td>
        <td>${report.anomalies.filter((a) => a.anomalyType === "OEE_MISMATCH").length}</td>
        <td>Medium</td>
      </tr>
      <tr>
        <td>Power Factor Low</td>
        <td>${report.anomalies.filter((a) => a.anomalyType === "POWER_FACTOR_LOW").length}</td>
        <td>Low</td>
      </tr>
    </table>
  </div>

  <div class="section">
    <h2>Audit Trail (ISO 50001 Clause 7.5)</h2>
    <table class="audit-trail">
      <tr>
        <th>Timestamp</th>
        <th>Action</th>
        <th>User</th>
        <th>Details</th>
      </tr>
      ${report.auditTrail
        .slice(0, 20)
        .map(
          (log) => `
        <tr>
          <td>${new Date(log.createdAt).toLocaleString()}</td>
          <td>${log.action}</td>
          <td>${log.userId}</td>
          <td>${log.reason || "—"}</td>
        </tr>
      `
        )
        .join("")}
    </table>
  </div>

  <div class="footer">
    <p>This report was automatically generated by the ISO 50001 Energy Management Platform.</p>
    <p>All calculations follow ISO 50001:2018 and ISO 50006:2014 standards.</p>
    <p>Report ID: ${report.reportId} | Generated: ${report.generatedAt.toISOString()}</p>
  </div>
</body>
</html>
  `;
  return html;
}

/**
 * Generate Excel report content (CSV format for compatibility)
 */
export function generateExcelContent(report: AuditReportData): string {
  let csv = "ISO 50001 Energy Management Audit Report\n";
  csv += `Report ID,${report.reportId}\n`;
  csv += `Generated,${report.generatedAt.toISOString()}\n`;
  csv += `Machine,${report.machineName} (ID: ${report.machineId})\n`;
  csv += `Period,${report.period.startDate.toLocaleDateString()} to ${report.period.endDate.toLocaleDateString()}\n`;
  csv += "\n";

  // EnPI Summary
  csv += "ENERGY PERFORMANCE INDICATOR (EnPI)\n";
  csv += "Metric,Value,Unit\n";
  csv += `Current EnPI,${report.enpiData.current.toFixed(4)},kWh/unit\n`;
  csv += `Baseline EnPI,${report.enpiData.baseline.toFixed(4)},kWh/unit\n`;
  csv += `Deviation,${report.enpiData.deviation.toFixed(2)},%\n`;
  csv += `Improvement Proof,${report.enpiData.improvementProof.toFixed(2)},%\n`;
  csv += `Status,${report.enpiData.status},\n`;
  csv += "\n";

  // Calculation Methodology
  csv += "CALCULATION METHODOLOGY (ISO 50006)\n";
  csv += `Method,${report.calculations.method}\n`;
  csv += `Formula,${report.calculations.formula}\n`;
  if (report.calculations.rSquared) {
    csv += `R² Value,${report.calculations.rSquared.toFixed(4)},ISO 50006 requirement: R² > 0.7\n`;
  }
  csv += "\n";

  // Normalization Factors
  csv += "NORMALIZATION FACTORS\n";
  csv += "Factor,Value\n";
  Object.entries(report.calculations.normalizationFactors).forEach(([key, value]) => {
    csv += `${key},${(value as number).toFixed(4)}\n`;
  });
  csv += "\n";

  // PDCA Cycles
  csv += "PDCA CYCLE STATUS (ISO 50001 Clause 8.2)\n";
  csv += "Cycle #,Plan,Do,Check,Act,Target EnPI\n";
  report.pdcaCycles.forEach((cycle) => {
    csv += `${cycle.cycleNumber},Completed,${cycle.doStatus || "Pending"},${cycle.checkStatus || "Pending"},${cycle.actStatus || "Pending"},${cycle.planTargetEnpi || "—"}\n`;
  });
  csv += "\n";

  // Anomalies Summary
  csv += "ANOMALIES DETECTED (IEEE 1159)\n";
  csv += "Type,Count,Severity\n";
  csv += `THD Spike,${report.anomalies.filter((a) => a.anomalyType === "THD_SPIKE").length},Medium\n`;
  csv += `Consumption Drift,${report.anomalies.filter((a) => a.anomalyType === "CONSUMPTION_DRIFT").length},High\n`;
  csv += `OEE Mismatch,${report.anomalies.filter((a) => a.anomalyType === "OEE_MISMATCH").length},Medium\n`;
  csv += `Power Factor Low,${report.anomalies.filter((a) => a.anomalyType === "POWER_FACTOR_LOW").length},Low\n`;

  return csv;
}

/**
 * Generate non-conformity report
 */
export function generateNonConformityReport(
  anomalies: any[],
  enpiDeviation: number
): Array<{ title: string; description: string; severity: "low" | "medium" | "high"; correctionRequired: boolean }> {
  const findings = [];

  // Check for high anomaly count
  if (anomalies.length > 100) {
    findings.push({
      title: "High Anomaly Rate",
      description: `${anomalies.length} anomalies detected in the reporting period. Exceeds normal threshold.`,
      severity: "high" as const,
      correctionRequired: true,
    });
  }

  // Check for EnPI degradation
  if (enpiDeviation > 10) {
    findings.push({
      title: "Significant EnPI Degradation",
      description: `EnPI has degraded by ${enpiDeviation.toFixed(2)}% from baseline. Corrective action required.`,
      severity: "high" as const,
      correctionRequired: true,
    });
  } else if (enpiDeviation > 5) {
    findings.push({
      title: "Moderate EnPI Deviation",
      description: `EnPI has deviated by ${enpiDeviation.toFixed(2)}% from baseline. Monitoring recommended.`,
      severity: "medium" as const,
      correctionRequired: false,
    });
  }

  // Check for THD issues
  const thdAnomalies = anomalies.filter((a) => a.anomalyType === "THD_SPIKE");
  if (thdAnomalies.length > 50) {
    findings.push({
      title: "Excessive Harmonic Distortion",
      description: `${thdAnomalies.length} THD spike events detected. May indicate electrical equipment issues.`,
      severity: "high" as const,
      correctionRequired: true,
    });
  }

  return findings;
}
