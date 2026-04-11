export type Role = "ADMIN_ENERGIE" | "RESPONSABLE_SITE" | "AUDITEUR" | "OPERATEUR";

export type SensitiveAction =
  | "CREATE_MACHINE"
  | "VALIDATE_BASELINE"
  | "APPROVE_DOCUMENT"
  | "CLOSE_PDCA"
  | "EXPORT_AUDIT_REPORT";

export type WriteAction = SensitiveAction | "MARK_ALERT_READ" | "LOGOUT";

export type WriteMutationName =
  | "auth.logout"
  | "alerts.markAsRead"
  | "machines.create"
  | "governance.approveBaseline"
  | "governance.closePdcaCycle"
  | "governance.exportAuditReport";

export type LocalAccount = {
  username: string;
  fullName: string;
  role: Role;
  password: string;
};

export type SessionUser = {
  username: string;
  fullName: string;
  role: Role;
};

export const LOCAL_ACCOUNTS: LocalAccount[] = [
  {
    username: "admin.energie",
    fullName: "Admin Énergie",
    role: "ADMIN_ENERGIE",
    password: "Admin50001!",
  },
  {
    username: "resp.site",
    fullName: "Responsable Site",
    role: "RESPONSABLE_SITE",
    password: "Site50001!",
  },
  {
    username: "auditeur.interne",
    fullName: "Auditeur Interne",
    role: "AUDITEUR",
    password: "Audit50001!",
  },
  {
    username: "operateur.l1",
    fullName: "Opérateur Ligne 1",
    role: "OPERATEUR",
    password: "Oper50001!",
  },
];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN_ENERGIE: "Admin Énergie",
  RESPONSABLE_SITE: "Responsable Site",
  AUDITEUR: "Auditeur",
  OPERATEUR: "Opérateur",
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

export const WRITE_MUTATION_ACTION_MAP: Record<WriteMutationName, WriteAction> = {
  "auth.logout": "LOGOUT",
  "alerts.markAsRead": "MARK_ALERT_READ",
  "machines.create": "CREATE_MACHINE",
  "governance.approveBaseline": "VALIDATE_BASELINE",
  "governance.closePdcaCycle": "CLOSE_PDCA",
  "governance.exportAuditReport": "EXPORT_AUDIT_REPORT",
};

export function authenticateLocalAccount(username: string, password: string): SessionUser | null {
  const account = LOCAL_ACCOUNTS.find(
    candidate => candidate.username === username && candidate.password === password,
  );

  if (!account) {
    return null;
  }

  return {
    username: account.username,
    fullName: account.fullName,
    role: account.role,
  };
}

export function canWriteSensitiveAction(
  role: Role,
  action: SensitiveAction,
  context?: { exceptionApproved?: boolean },
): boolean {
  if (SENSITIVE_WRITE_MATRIX[role].includes(action)) {
    return true;
  }

  return Boolean(context?.exceptionApproved);
}

export function canWriteEndpoint(
  role: Role,
  action: WriteAction,
  context?: { exceptionApproved?: boolean },
): boolean {
  if (WRITE_MATRIX[role].includes(action)) {
    return true;
  }

  return Boolean(context?.exceptionApproved);
}

export function canRoleExecuteMutation(
  role: Role,
  mutation: WriteMutationName,
  context?: { exceptionApproved?: boolean },
): boolean {
  return canWriteEndpoint(role, WRITE_MUTATION_ACTION_MAP[mutation], context);
}

export function getRoleLandingPage(role: Role): "dashboard" | "pdca" {
  return role === "OPERATEUR" ? "pdca" : "dashboard";
}