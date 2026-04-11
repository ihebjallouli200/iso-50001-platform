import type { SessionUser } from "./auth_rbac";

export const SESSION_TOKEN_KEY = "enms-session-token";

function getToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** Unwrap the backend envelope { data, meta } for success responses */
async function unwrap<T>(res: Response): Promise<T> {
  const json = await res.json();
  // The backend wraps success in { data, meta }
  if (json && typeof json === "object" && "data" in json) {
    return json.data as T;
  }
  return json as T;
}

/* ============================================
   AUTH
   ============================================ */

type LoginResponse = {
  sessionToken: string;
  user: {
    id?: number;
    username: string;
    fullName: string;
    role: SessionUser["role"];
  };
  expiresAt?: string;
};

export async function loginWithApi(
  username: string,
  password: string,
): Promise<{ sessionUser: SessionUser; sessionToken: string } | null> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return null;

    const json = await res.json();
    // Backend wraps in { data: { sessionToken, user, expiresAt }, meta }
    const payload: LoginResponse = json?.data ?? json;
    if (!payload?.sessionToken || !payload?.user) return null;

    return {
      sessionUser: {
        username: payload.user.username,
        fullName: payload.user.fullName,
        role: payload.user.role,
      },
      sessionToken: payload.sessionToken,
    };
  } catch {
    return null;
  }
}

export async function resolveSessionUser(
  sessionToken: string,
): Promise<SessionUser | null> {
  try {
    const res = await fetch("/api/auth/meByToken", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const payload = json?.data ?? json;
    if (!payload) return null;
    return {
      username: payload.username,
      fullName: payload.fullName,
      role: payload.role,
    };
  } catch {
    return null;
  }
}

export async function logoutWithApi(sessionToken: string): Promise<void> {
  try {
    await fetch("/api/auth/logoutByToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ sessionToken }),
    });
  } catch {
    /* ignore */
  }
}

/* ============================================
   GENERIC FETCHERS
   ============================================ */

async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path, { headers: authHeaders() });
    if (!res.ok) return null;
    return unwrap<T>(res);
  } catch {
    return null;
  }
}

/** Like apiGet but guarantees an array return — safe for list endpoints */
async function apiGetArray<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(path, { headers: authHeaders() });
    if (!res.ok) return [];
    const data = await unwrap<T[]>(res);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function apiPost<T>(path: string, body: unknown = {}): Promise<T | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return unwrap<T>(res);
  } catch {
    return null;
  }
}

async function apiPut<T>(path: string, body: unknown = {}): Promise<T | null> {
  try {
    const res = await fetch(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return unwrap<T>(res);
  } catch {
    return null;
  }
}

/* ============================================
   MACHINES
   ============================================ */

export type Machine = {
  id: number;
  siteId: string;
  siteName: string;
  machineCode: string;
  machineName: string;
  machineType: string;
  isActive: boolean;
};

export type MachineLive = {
  id: number;
  machineId: number;
  powerKw: number;
  enpi: number;
  loadPct: number;
  status: string;
  updatedAt: string;
  machineName?: string;
  machineCode?: string;
  siteName?: string;
};

export const fetchMachines = () => apiGetArray<Machine>("/api/machines");
export const fetchMachinesLive = () => apiGetArray<MachineLive>("/api/machines/live");

/* ============================================
   ALERTS
   ============================================ */

export type Alert = {
  id: number;
  machineId: number;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

export const fetchUnreadAlerts = () => apiGetArray<Alert>("/api/alerts/unread");
export const markAlertRead = (alertId: number) =>
  apiPost("/api/alerts/mark-read", { alertId });

/* ============================================
   ANOMALIES
   ============================================ */

export type Anomaly = {
  id: number;
  machineId: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  metric: string;
  observedValue: number;
  threshold: number;
  status: string;
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  acknowledgementNote: string | null;
};

export const fetchAnomalies = (params?: { status?: string }) => {
  const qs = params?.status ? `?status=${params.status}` : "";
  return apiGetArray<Anomaly>(`/api/anomalies${qs}`);
};

export const acknowledgeAnomaly = (anomalyId: number, note: string) =>
  apiPost("/api/anomalies/acknowledge", { anomalyId, note });

/* ============================================
   RECOMMENDATIONS
   ============================================ */

export type Recommendation = {
  id: number;
  machineId: number;
  title: string;
  justification: string;
  estimatedImpact: {
    energySavingPct: number;
    co2SavingKgMonth: number;
    paybackMonths: number;
  };
  confidenceScore: number;
  status: string;
  createdAt: string;
};

export const fetchRecommendations = () => apiGetArray<Recommendation>("/api/recommendations");
export const decideRecommendation = (
  recommendationId: number,
  decision: string,
  comment: string,
) => apiPost("/api/recommendations/decide", { recommendationId, decision, comment });

/* ============================================
   PDCA
   ============================================ */

export type PdcaCycle = {
  id: number;
  machineId: number;
  title: string;
  objective: string;
  targetEnpi: number;
  phase: string;
  status: string;
  actions: string[];
  attachments: string[];
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closeReason: string | null;
};

export const fetchPdcaCycles = () => apiGetArray<PdcaCycle>("/api/pdca/cycles");
export const fetchPdcaCycle = (id: number) => apiGet<PdcaCycle>(`/api/pdca/cycles/${id}`);
export const createPdcaCycle = (body: {
  title: string;
  objective: string;
  machineId: number;
  targetEnpi: number;
}) => apiPost<PdcaCycle>("/api/pdca/cycles", body);
export const updatePdcaCycle = (id: number, body: unknown) =>
  apiPut<PdcaCycle>(`/api/pdca/cycles/${id}`, body);
export const transitionPdcaCycle = (
  pdcaCycleId: number,
  toPhase: string,
  reason: string,
) => apiPost("/api/pdca/transition", { pdcaCycleId, toPhase, reason });
export const closePdcaCycle = (pdcaCycleId: number, reason: string) =>
  apiPost("/api/governance/close-pdca", { pdcaCycleId, reason });

/* ============================================
   APPROVALS
   ============================================ */

export type Approval = {
  id: number;
  entityType: string;
  entityId: number;
  title: string;
  requestedByUserId: number;
  requestedByName: string;
  status: string;
  comment: string;
  decidedByUserId: number | null;
  decidedAt: string | null;
  createdAt: string;
};

export const fetchApprovals = () => apiGetArray<Approval>("/api/approvals");
export const decideApproval = (
  approvalId: number,
  decision: string,
  comment: string,
) => apiPost("/api/approvals/decide", { approvalId, decision, comment });

/* ============================================
   AUDIT
   ============================================ */

export type AuditMatrixItem = {
  clause: string;
  title: string;
  status: string;
  summary: string;
  evidenceIds: number[];
};

export type AuditEvidence = {
  id: number;
  clause: string;
  label: string;
  sourceType: string;
  sourceRef: string;
  status: string;
  updatedAt: string;
  details: string;
};

export type NonConformity = {
  id: number;
  clause: string;
  title: string;
  severity: string;
  status: string;
  description: string;
  createdByName: string;
  createdAt: string;
  correctiveActions: {
    id: number;
    action: string;
    owner: string;
    dueDate: string;
    status: string;
    note: string;
  }[];
};

export const fetchAuditMatrix = () => apiGetArray<AuditMatrixItem>("/api/audit/matrix");
export const fetchAuditEvidence = (clause: string) =>
  apiGetArray<AuditEvidence>(`/api/audit/evidence?clause=${clause}`);
export const fetchNonConformities = () => apiGetArray<NonConformity>("/api/audit/nonconformities");
export const exportPreAudit = () => apiPost("/api/audit/export-preaudit", {});
export const createNonConformity = (body: {
  clause: string;
  title: string;
  description: string;
  correctiveAction: string;
  owner: string;
  dueDate: string;
}) => apiPost<NonConformity>("/api/audit/nonconformities", body);

/* ============================================
   GOVERNANCE
   ============================================ */

export const fetchGovernanceEvents = (limit = 20) =>
  apiGet(`/api/governance/events?limit=${limit}`);

/* ============================================
   ANALYTICS
   ============================================ */

export type EnergyTimelinePoint = {
  id: number;
  machineId: number;
  timestamp: string;
  enpi: number;
  powerKw: number;
  loadPct: number;
  eventType: string;
  kva?: number;
  cosPhi?: number;
  thdVoltage?: number;
  oee?: number;
};

export const fetchEnergyTimeline = (machineId: number, windowHours = 24) =>
  apiGetArray<EnergyTimelinePoint>(
    `/api/analytics/energy-timeline?machineId=${machineId}&windowHours=${windowHours}`,
  );

export type CauseActionCorrelation = {
  id: number;
  machineId: number;
  cause: string;
  action: string;
  correlationScore: number;
  expectedGainPct: number;
  variables: { variable: string; contribution: number; direction: string }[];
};

export const fetchCauseActionCorrelations = (machineId: number) =>
  apiGetArray<CauseActionCorrelation>(
    `/api/analytics/cause-action-correlation?machineId=${machineId}`,
  );

export type SiteComparison = {
  siteId: string;
  siteName: string;
  avgEnpi: number;
  totalPowerKw: number;
  machineCount: number;
};

export const fetchSiteComparison = () =>
  apiGetArray<SiteComparison>("/api/analytics/site-comparison");

/* ============================================
   PLATFORM HEALTH & INGESTION
   ============================================ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fetchIngestionHealth = () => apiGet<any>("/api/ingestion/health");

export type ImportJournalEntry = {
  id: number;
  sourceName: string;
  sourceType: string;
  status: string;
  rowCount: number;
  insertedRows: number;
  rejectedRows: number;
  startedAt: string;
  completedAt: string;
  errorMessage?: string;
};

export const fetchImportJournal = () =>
  apiGetArray<ImportJournalEntry>("/api/imports/journal?limit=50");

export type DataQualityItem = {
  machineId: number;
  machineCode: string;
  machineName: string;
  sourceName: string;
  rowCount: number;
  validRowCount: number;
  missingRatePct: number;
  typeErrorRatePct: number;
  duplicateRatePct: number;
  outlierRatePct: number;
  qualityScore: number;
  status: string;
  openIssues: number;
  majorIssues: number;
};

export const fetchDataQualitySummary = () =>
  apiGetArray<DataQualityItem>("/api/data-quality/summary");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fetchSloDashboard = () => apiGet<any>("/api/slo/dashboard");

export const fetchPlatformHealth = () => apiGet("/api/platform/health");

/* ============================================
   DOCUMENTS
   ============================================ */

export const fetchDocumentVersions = () => apiGet("/api/documents/versions");
