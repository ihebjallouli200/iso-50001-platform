import { eq, and, gte, lte, desc } from "drizzle-orm";
import { createHash, randomBytes } from "crypto";
import { getDb } from "./db";
import {
  users,
  userSessions,
  machines,
  measurements,
  energyBaselines,
  energyPerformanceIndicators,
  pdcaCycles,
  anomalies,
  recommendations,
  alerts,
  auditLogs,
  type User,
  type UserSession,
  type Machine,
  type Measurement,
  type EnergyBaseline,
  type EnergyPerformanceIndicator,
  type PDCACycle,
  type Anomaly,
  type Recommendation,
  type Alert,
  type AuditLog,
} from "./schema";
import { LOCAL_ACCOUNTS } from "./auth_rbac";

const SESSION_TTL_HOURS = 12;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function ensureDefaultLocalUsers() {
  // Bypassed for presentation
  return;
}

export async function loginWithLocalAccount(username: string, password: string, metadata?: { userAgent?: string; ipAddress?: string }) {
  const account = LOCAL_ACCOUNTS.find(candidate => candidate.username === username);

  if (!account || account.password !== password) {
    return null;
  }

  // Force-mock session instead of throwing postgres errors
  const rawToken = `mock_${Buffer.from(username).toString("base64")}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

  return {
    sessionToken: rawToken,
    user: {
      id: account.username === "admin.energie" ? 1 : 999,
      username: account.username,
      fullName: account.fullName || account.username,
      role: account.role as any,
    },
    expiresAt,
  };
}

export async function getSessionUser(sessionToken: string) {
  if (!sessionToken.startsWith("mock_")) {
    return null;
  }

  try {
    const b64 = sessionToken.replace("mock_", "");
    const username = Buffer.from(b64, "base64").toString("utf-8");

    const account = LOCAL_ACCOUNTS.find(candidate => candidate.username === username);
    if (!account) {
      return null;
    }

    return {
      id: account.username === "admin.energie" ? 1 : 999,
      username: account.username,
      fullName: account.fullName || account.username,
      role: account.role as any,
      sessionExpiresAt: new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000),
    };
  } catch(e) {
    return null;
  }
}

export async function revokeSession(sessionToken: string) {
  return true;
}

// ============ MACHINE MANAGEMENT ============

export async function createMachine(machine: typeof machines.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(machines).values(machine);
  return result;
}

export async function getMachineById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(machines).where(eq(machines.id, id)).limit(1);
}

export async function getAllMachines() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(machines).where(eq(machines.isActive, true));
}

// ============ MEASUREMENTS (TIME-SERIES DATA) ============

export async function insertMeasurements(data: typeof measurements.$inferInsert[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(measurements).values(data);
}

export async function getMeasurementsByMachine(
  machineId: number,
  startDate: Date,
  endDate: Date,
  limit: number = 1000
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(measurements)
    .where(
      and(
        eq(measurements.machineId, machineId),
        gte(measurements.timestamp, startDate),
        lte(measurements.timestamp, endDate)
      )
    )
    .orderBy(desc(measurements.timestamp))
    .limit(limit);
}

// ============ ENERGY BASELINE (EnB) - ISO 50006 ============

export async function createEnergyBaseline(baseline: typeof energyBaselines.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(energyBaselines).values(baseline);
}

export async function getActiveBaseline(machineId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(energyBaselines)
    .where(and(eq(energyBaselines.machineId, machineId), eq(energyBaselines.isActive, true)))
    .limit(1);
}

// ============ ENERGY PERFORMANCE INDICATOR (EnPI) - ISO 50001 ============

export async function createEnPI(enpi: typeof energyPerformanceIndicators.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(energyPerformanceIndicators).values(enpi);
}

export async function getLatestEnPI(machineId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(energyPerformanceIndicators)
    .where(eq(energyPerformanceIndicators.machineId, machineId))
    .orderBy(desc(energyPerformanceIndicators.timestamp))
    .limit(1);
}

export async function getEnPIHistory(
  machineId: number,
  startDate: Date,
  endDate: Date,
  limit: number = 100
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(energyPerformanceIndicators)
    .where(
      and(
        eq(energyPerformanceIndicators.machineId, machineId),
        gte(energyPerformanceIndicators.timestamp, startDate),
        lte(energyPerformanceIndicators.timestamp, endDate)
      )
    )
    .orderBy(desc(energyPerformanceIndicators.timestamp))
    .limit(limit);
}

// ============ PDCA CYCLE - ISO 50001 ============

export async function createPDCACycle(cycle: typeof pdcaCycles.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(pdcaCycles).values(cycle);
}

export async function getPDCACycle(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.select().from(pdcaCycles).where(eq(pdcaCycles.id, id)).limit(1);
}

export async function getPDCACyclesByMachine(machineId: number, limit: number = 10) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(pdcaCycles)
    .where(eq(pdcaCycles.machineId, machineId))
    .orderBy(desc(pdcaCycles.createdAt))
    .limit(limit);
}

export async function updatePDCACycleStatus(
  cycleId: number,
  phase: "do" | "check" | "act",
  status: string,
  data?: Record<string, any>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updateData: any = {};
  if (phase === "do") {
    updateData.doStatus = status;
    if (data?.completionDate) updateData.doCompletionDate = data.completionDate;
    if (data?.actionsLog) updateData.doActionsLog = JSON.stringify(data.actionsLog);
  } else if (phase === "check") {
    updateData.checkStatus = status;
    if (data?.enpiAchieved) updateData.checkEnpiAchieved = data.enpiAchieved;
    if (data?.improvementProof) updateData.checkImprovementProof = data.improvementProof;
    if (data?.completionDate) updateData.checkCompletionDate = data.completionDate;
  } else if (phase === "act") {
    updateData.actStatus = status;
    if (data?.decision) updateData.actDecision = data.decision;
    if (data?.correctiveActions) updateData.actCorrectiveActions = JSON.stringify(data.correctiveActions);
    if (data?.completionDate) updateData.actCompletionDate = data.completionDate;
  }

  return db.update(pdcaCycles).set(updateData).where(eq(pdcaCycles.id, cycleId));
}

// ============ ANOMALIES ============

export async function createAnomaly(anomaly: typeof anomalies.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(anomalies).values(anomaly);
}

export async function getRecentAnomalies(machineId: number, hours: number = 24, limit: number = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);

  return db
    .select()
    .from(anomalies)
    .where(
      and(
        eq(anomalies.machineId, machineId),
        gte(anomalies.timestamp, startDate),
        eq(anomalies.isResolved, false)
      )
    )
    .orderBy(desc(anomalies.timestamp))
    .limit(limit);
}

// ============ RECOMMENDATIONS ============

export async function createRecommendation(rec: typeof recommendations.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(recommendations).values(rec);
}

export async function getRecommendationsByMachine(machineId: number, limit: number = 20) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(recommendations)
    .where(eq(recommendations.machineId, machineId))
    .orderBy(desc(recommendations.createdAt))
    .limit(limit);
}

// ============ ALERTS ============

export async function createAlert(alert: typeof alerts.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(alerts).values(alert);
}

export async function getUnreadAlerts(machineId?: number, limit: number = 50) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (machineId) {
    return db
      .select()
      .from(alerts)
      .where(and(eq(alerts.machineId, machineId), eq(alerts.isRead, false)))
      .orderBy(desc(alerts.createdAt))
      .limit(limit);
  }

  return db
    .select()
    .from(alerts)
    .where(eq(alerts.isRead, false))
    .orderBy(desc(alerts.createdAt))
    .limit(limit);
}

export async function markAlertAsRead(alertId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.update(alerts).set({ isRead: true }).where(eq(alerts.id, alertId));
}

// ============ AUDIT LOG - ISO 50001 CLAUSE 7.5 ============

export async function createAuditLog(log: typeof auditLogs.$inferInsert) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.insert(auditLogs).values(log);
}

export async function getAuditTrail(entityType: string, entityId: number, limit: number = 100) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, entityType), eq(auditLogs.entityId, entityId)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
