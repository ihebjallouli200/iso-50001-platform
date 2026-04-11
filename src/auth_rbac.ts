export type Role = "ADMIN_ENERGIE" | "RESPONSABLE_SITE" | "AUDITEUR" | "OPERATEUR";

export type SensitiveAction =
  | "CREATE_MACHINE"
  | "VALIDATE_BASELINE"
  | "APPROVE_DOCUMENT"
  | "CLOSE_PDCA"
  | "EXPORT_AUDIT_REPORT";

export type WriteAction = SensitiveAction | "MARK_ALERT_READ" | "LOGOUT";

export type SessionUser = {
  username: string;
  fullName: string;
  role: Role;
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN_ENERGIE: "Admin Énergie",
  RESPONSABLE_SITE: "Responsable Site",
  AUDITEUR: "Auditeur",
  OPERATEUR: "Opérateur",
};

export const ROLE_ICONS: Record<Role, string> = {
  ADMIN_ENERGIE: "⚡",
  RESPONSABLE_SITE: "🏭",
  AUDITEUR: "📋",
  OPERATEUR: "🔧",
};

const SENSITIVE_WRITE_MATRIX: Record<Role, SensitiveAction[]> = {
  ADMIN_ENERGIE: [
    "CREATE_MACHINE",
    "VALIDATE_BASELINE",
    "APPROVE_DOCUMENT",
    "CLOSE_PDCA",
    "EXPORT_AUDIT_REPORT",
  ],
  RESPONSABLE_SITE: ["VALIDATE_BASELINE", "CLOSE_PDCA"],
  AUDITEUR: ["EXPORT_AUDIT_REPORT"],
  OPERATEUR: [],
};

const WRITE_MATRIX: Record<Role, WriteAction[]> = {
  ADMIN_ENERGIE: [
    "CREATE_MACHINE",
    "VALIDATE_BASELINE",
    "APPROVE_DOCUMENT",
    "CLOSE_PDCA",
    "EXPORT_AUDIT_REPORT",
    "MARK_ALERT_READ",
    "LOGOUT",
  ],
  RESPONSABLE_SITE: ["VALIDATE_BASELINE", "CLOSE_PDCA", "MARK_ALERT_READ", "LOGOUT"],
  AUDITEUR: ["EXPORT_AUDIT_REPORT", "MARK_ALERT_READ", "LOGOUT"],
  OPERATEUR: ["MARK_ALERT_READ", "LOGOUT"],
};

export function canWriteSensitiveAction(
  role: Role,
  action: SensitiveAction,
): boolean {
  return SENSITIVE_WRITE_MATRIX[role].includes(action);
}

export function canWriteEndpoint(role: Role, action: WriteAction): boolean {
  return WRITE_MATRIX[role].includes(action);
}

export function getRoleLandingPage(role: Role): "dashboard" | "pdca" {
  return role === "OPERATEUR" ? "pdca" : "dashboard";
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}
