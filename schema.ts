import { decimal, int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json } from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: varchar("passwordHash", { length: 128 }).notNull(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }).default("local"),
  role: mysqlEnum("role", ["ADMIN_ENERGIE", "RESPONSABLE_SITE", "AUDITEUR", "OPERATEUR"]).default("OPERATEUR").notNull(),
  failedLoginCount: int("failedLoginCount").default(0).notNull(),
  isLocked: boolean("isLocked").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Persistent local sessions for API authentication.
 */
export const userSessions = mysqlTable("userSessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  sessionTokenHash: varchar("sessionTokenHash", { length: 128 }).notNull().unique(),
  issuedAt: timestamp("issuedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  revokedAt: timestamp("revokedAt"),
  userAgent: varchar("userAgent", { length: 512 }),
  ipAddress: varchar("ipAddress", { length: 45 }),
});

export type UserSession = typeof userSessions.$inferSelect;
export type InsertUserSession = typeof userSessions.$inferInsert;

// ============ ISO 50001 ENERGY MANAGEMENT TABLES ============

/**
 * Machines/Equipment table - tracks industrial equipment
 */
export const machines = mysqlTable("machines", {
  id: int("id").autoincrement().primaryKey(),
  siteId: varchar("siteId", { length: 64 }).notNull(),
  machineCode: varchar("machineCode", { length: 64 }).notNull().unique(),
  machineName: text("machineName").notNull(),
  machineType: varchar("machineType", { length: 64 }), // e.g., "compressor", "pump", "motor"
  location: text("location"),
  nominalPower: decimal("nominalPower", { precision: 10, scale: 2 }), // kW
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Machine = typeof machines.$inferSelect;
export type InsertMachine = typeof machines.$inferInsert;

/**
 * Measurements table - raw energy and production data (time-series)
 * Stores 1Hz to 1min granularity data for anomaly detection and model training
 */
export const measurements = mysqlTable("measurements", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  // Energy metrics (IEEE 1159 compliant)
  kWh: decimal("kWh", { precision: 12, scale: 4 }).notNull(), // Active energy
  kVA: decimal("kVA", { precision: 12, scale: 4 }).notNull(), // Apparent power
  cosPhiVoltage: decimal("cosPhiVoltage", { precision: 5, scale: 4 }), // Power factor (voltage)
  cosPhiCurrent: decimal("cosPhiCurrent", { precision: 5, scale: 4 }), // Power factor (current)
  thdVoltage: decimal("thdVoltage", { precision: 6, scale: 2 }), // Total Harmonic Distortion %
  thdCurrent: decimal("thdCurrent", { precision: 6, scale: 2 }),
  // Harmonics (up to 40th)
  harmonicsJson: text("harmonicsJson"), // JSON: {"1": 0.5, "3": 0.2, ...}
  // Production metrics (OEE correlation)
  outputPieces: decimal("outputPieces", { precision: 12, scale: 2 }),
  outputTonnage: decimal("outputTonnage", { precision: 12, scale: 4 }),
  machineState: mysqlEnum("machineState", ["running", "idle", "stopped", "maintenance"]).notNull(),
  oee: decimal("oee", { precision: 5, scale: 4 }), // Overall Equipment Effectiveness (0-1)
  // Contextual data
  temperature: decimal("temperature", { precision: 6, scale: 2 }), // Ambient or process temperature
  humidity: decimal("humidity", { precision: 5, scale: 2 }), // Relative humidity %
  // Data quality flags
  isAnomaly: boolean("isAnomaly").default(false),
  anomalyLabel: text("anomalyLabel"), // e.g., "THD_SPIKE", "CONSUMPTION_DRIFT"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Measurement = typeof measurements.$inferSelect;
export type InsertMeasurement = typeof measurements.$inferInsert;

/**
 * Energy Baseline (EnB) table - ISO 50006 compliant
 * Stores baseline values and normalization factors per machine
 */
export const energyBaselines = mysqlTable("energyBaselines", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  baselineType: mysqlEnum("baselineType", ["ratio", "regression"]).notNull(),
  // Ratio method: EnB = kWh / output
  enpiRatioValue: decimal("enpiRatioValue", { precision: 12, scale: 6 }), // kWh per unit output
  // Regression method: EnB = f(production, temperature, ...)
  regressionCoefficients: text("regressionCoefficients"), // JSON: {"intercept": 100, "production": 0.5, "temperature": 0.2}
  rSquared: decimal("rSquared", { precision: 5, scale: 4 }), // R² value for regression quality
  // Normalization factors (ISO 50006)
  normalizationFactors: text("normalizationFactors"), // JSON: {"production": 1.0, "temperature": 0.95}
  referenceStartDate: timestamp("referenceStartDate").notNull(),
  referenceEndDate: timestamp("referenceEndDate").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EnergyBaseline = typeof energyBaselines.$inferSelect;
export type InsertEnergyBaseline = typeof energyBaselines.$inferInsert;

/**
 * Energy Performance Indicator (EnPI) table - ISO 50001 clause 6.4
 * Stores calculated EnPI values (actual performance vs baseline)
 */
export const energyPerformanceIndicators = mysqlTable("energyPerformanceIndicators", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  baselineId: int("baselineId").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  // Calculated values
  enpiValue: decimal("enpiValue", { precision: 12, scale: 6 }).notNull(), // Current EnPI
  enpiNormalized: decimal("enpiNormalized", { precision: 12, scale: 6 }), // Normalized EnPI (adjusted for conditions)
  enpiDeviation: decimal("enpiDeviation", { precision: 8, scale: 4 }), // % deviation from baseline
  improvementProof: decimal("improvementProof", { precision: 8, scale: 4 }), // Normalized reduction (ISO 50001 clause 10.2)
  // Status
  status: mysqlEnum("status", ["normal", "warning", "critical"]).default("normal"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EnergyPerformanceIndicator = typeof energyPerformanceIndicators.$inferSelect;
export type InsertEnergyPerformanceIndicator = typeof energyPerformanceIndicators.$inferInsert;

/**
 * PDCA Cycle table - ISO 50001 clause 9.1, 10.2
 * Tracks Plan-Do-Check-Act workflow for continuous improvement
 */
export const pdcaCycles = mysqlTable("pdcaCycles", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  cycleNumber: int("cycleNumber").notNull(), // Incremental cycle counter
  // Plan phase
  planObjective: text("planObjective").notNull(), // Energy improvement target
  planTargetEnpi: decimal("planTargetEnpi", { precision: 12, scale: 6 }), // Target EnPI value
  planActions: text("planActions"), // JSON array of planned actions
  planStartDate: timestamp("planStartDate").notNull(),
  // Do phase
  doStatus: mysqlEnum("doStatus", ["not_started", "in_progress", "completed"]).default("not_started"),
  doActionsLog: text("doActionsLog"), // JSON: [{"action": "...", "date": "...", "result": "..."}]
  doCompletionDate: timestamp("doCompletionDate"),
  // Check phase
  checkStatus: mysqlEnum("checkStatus", ["not_started", "in_progress", "completed"]).default("not_started"),
  checkEnpiAchieved: decimal("checkEnpiAchieved", { precision: 12, scale: 6 }), // Actual EnPI after actions
  checkImprovementProof: decimal("checkImprovementProof", { precision: 8, scale: 4 }), // Normalized improvement %
  checkCompletionDate: timestamp("checkCompletionDate"),
  // Act phase
  actStatus: mysqlEnum("actStatus", ["not_started", "in_progress", "completed"]).default("not_started"),
  actDecision: mysqlEnum("actDecision", ["approved", "rejected", "pending"]).default("pending"),
  actCorrectiveActions: text("actCorrectiveActions"), // JSON: corrective actions if improvement not achieved
  actCompletionDate: timestamp("actCompletionDate"),
  // Audit trail
  auditTrail: text("auditTrail"), // JSON: [{"user": "...", "action": "...", "timestamp": "..."}]
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PDCACycle = typeof pdcaCycles.$inferSelect;
export type InsertPDCACycle = typeof pdcaCycles.$inferInsert;

/**
 * Anomalies table - stores detected electrical and operational anomalies
 * Used for alerting and root cause analysis
 */
export const anomalies = mysqlTable("anomalies", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  anomalyType: mysqlEnum("anomalyType", [
    "THD_SPIKE",
    "POWER_FACTOR_LOW",
    "CONSUMPTION_DRIFT",
    "OEE_MISMATCH",
    "HARMONIC_DISTORTION",
    "VOLTAGE_SWELL",
    "VOLTAGE_SAG",
    "FREQUENCY_DEVIATION",
    "OTHER"
  ]).notNull(),
  severity: mysqlEnum("severity", ["low", "medium", "high", "critical"]).notNull(),
  description: text("description"),
  detectedValue: decimal("detectedValue", { precision: 12, scale: 6 }), // Actual measured value
  thresholdValue: decimal("thresholdValue", { precision: 12, scale: 6 }), // Alert threshold
  confidence: decimal("confidence", { precision: 5, scale: 4 }), // ML model confidence (0-1)
  isResolved: boolean("isResolved").default(false),
  resolutionNotes: text("resolutionNotes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Anomaly = typeof anomalies.$inferSelect;
export type InsertAnomaly = typeof anomalies.$inferInsert;

/**
 * Recommendations table - AI-powered actionable recommendations
 * Linked to PDCA cycle for workflow integration
 */
export const recommendations = mysqlTable("recommendations", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  pdcaCycleId: int("pdcaCycleId"),
  anomalyId: int("anomalyId"),
  recommendationType: mysqlEnum("recommendationType", [
    "MAINTENANCE",
    "OPTIMIZATION",
    "REPLACEMENT",
    "PROCESS_CHANGE",
    "MONITORING"
  ]).notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  estimatedEnpiReduction: decimal("estimatedEnpiReduction", { precision: 8, scale: 4 }), // % improvement
  confidence: decimal("confidence", { precision: 5, scale: 4 }).notNull(), // 0-1
  priority: mysqlEnum("priority", ["low", "medium", "high"]).default("medium"),
  status: mysqlEnum("status", ["pending", "approved", "in_progress", "completed", "rejected"]).default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Recommendation = typeof recommendations.$inferSelect;
export type InsertRecommendation = typeof recommendations.$inferInsert;

/**
 * Alerts table - notification events for critical conditions
 * Supports email, in-app, and SMS notifications
 */
export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  machineId: int("machineId").notNull(),
  anomalyId: int("anomalyId"),
  alertType: mysqlEnum("alertType", [
    "ANOMALY_DETECTED",
    "ENPI_DEVIATION",
    "PDCA_MILESTONE",
    "MAINTENANCE_DUE",
    "THRESHOLD_EXCEEDED"
  ]).notNull(),
  severity: mysqlEnum("severity", ["info", "warning", "critical"]).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("isRead").default(false),
  emailSent: boolean("emailSent").default(false),
  smsSent: boolean("smsSent").default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  acknowledgedAt: timestamp("acknowledgedAt"),
});

export type Alert = typeof alerts.$inferSelect;
export type InsertAlert = typeof alerts.$inferInsert;

/**
 * Audit Log table - immutable record of all system changes
 * Ensures ISO 50001 clause 7.5 (Documented Information) compliance
 */
export const auditLogs = mysqlTable("auditLogs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 128 }).notNull(), // e.g., "UPDATE_ENPI", "CREATE_PDCA"
  entityType: varchar("entityType", { length: 64 }).notNull(), // e.g., "machine", "pdca_cycle"
  entityId: int("entityId").notNull(),
  changes: text("changes"), // JSON: {"field": "value_before", "new_value": "value_after"}
  reason: text("reason"), // Why the change was made
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Model Artifacts table - stores trained ML models for inference
 */
export const modelArtifacts = mysqlTable("modelArtifacts", {
  id: int("id").autoincrement().primaryKey(),
  modelType: mysqlEnum("modelType", ["LSTM_PREDICTION", "AUTOENCODER_ANOMALY"]).notNull(),
  modelVersion: varchar("modelVersion", { length: 32 }).notNull(),
  modelPath: text("modelPath").notNull(), // S3 path to serialized model
  trainingDatasetSize: int("trainingDatasetSize"),
  trainingMetrics: text("trainingMetrics"), // JSON: {"mape": 0.045, "f1_score": 0.92}
  isActive: boolean("isActive").default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ModelArtifact = typeof modelArtifacts.$inferSelect;
export type InsertModelArtifact = typeof modelArtifacts.$inferInsert;

/**
 * Document versions - controlled documented information (ISO 50001 clause 7.5)
 */
export const documentVersions = mysqlTable("documentVersions", {
  id: int("id").autoincrement().primaryKey(),
  documentType: mysqlEnum("documentType", [
    "ENERGY_POLICY",
    "ENPI_METHOD",
    "BASELINE_METHOD",
    "INTERNAL_AUDIT_REPORT",
    "MANAGEMENT_REVIEW",
    "CORRECTIVE_ACTION_PLAN",
    "WORK_INSTRUCTION",
    "OTHER"
  ]).notNull(),
  title: text("title").notNull(),
  version: varchar("version", { length: 32 }).notNull(),
  status: mysqlEnum("status", ["draft", "in_review", "approved", "archived"]).default("draft").notNull(),
  ownerUserId: int("ownerUserId").notNull(),
  approverUserId: int("approverUserId"),
  contentHash: varchar("contentHash", { length: 128 }),
  storagePath: text("storagePath"),
  effectiveFrom: timestamp("effectiveFrom"),
  effectiveTo: timestamp("effectiveTo"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DocumentVersion = typeof documentVersions.$inferSelect;
export type InsertDocumentVersion = typeof documentVersions.$inferInsert;

/**
 * Approval workflow - formal approvals for critical decisions and documents
 */
export const approvals = mysqlTable("approvals", {
  id: int("id").autoincrement().primaryKey(),
  entityType: mysqlEnum("entityType", ["DOCUMENT", "PDCA", "RECOMMENDATION", "BASELINE", "REPORT"]).notNull(),
  entityId: int("entityId").notNull(),
  requestedByUserId: int("requestedByUserId").notNull(),
  approverUserId: int("approverUserId").notNull(),
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  comment: text("comment"),
  decidedAt: timestamp("decidedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Approval = typeof approvals.$inferSelect;
export type InsertApproval = typeof approvals.$inferInsert;

/**
 * Responsibility assignments - role and accountability mapping
 */
export const responsibilities = mysqlTable("responsibilities", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  siteId: varchar("siteId", { length: 64 }).notNull(),
  responsibilityType: mysqlEnum("responsibilityType", [
    "ENERGY_MANAGER",
    "SITE_MANAGER",
    "AUDITOR",
    "OPERATOR",
    "MAINTENANCE_LEAD"
  ]).notNull(),
  scopeDescription: text("scopeDescription"),
  activeFrom: timestamp("activeFrom").defaultNow().notNull(),
  activeTo: timestamp("activeTo"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Responsibility = typeof responsibilities.$inferSelect;
export type InsertResponsibility = typeof responsibilities.$inferInsert;

/**
 * Management reviews - top management review records (ISO 50001 clause 9.3)
 */
export const managementReviews = mysqlTable("managementReviews", {
  id: int("id").autoincrement().primaryKey(),
  siteId: varchar("siteId", { length: 64 }).notNull(),
  reviewDate: timestamp("reviewDate").notNull(),
  chairedByUserId: int("chairedByUserId").notNull(),
  attendeesJson: text("attendeesJson"),
  inputsSummary: text("inputsSummary"),
  outputsSummary: text("outputsSummary"),
  decisionsJson: text("decisionsJson"),
  followUpActionsJson: text("followUpActionsJson"),
  evidenceDocumentId: int("evidenceDocumentId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ManagementReview = typeof managementReviews.$inferSelect;
export type InsertManagementReview = typeof managementReviews.$inferInsert;