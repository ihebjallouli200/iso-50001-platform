const ROLE_LABELS = {
  ADMIN_ENERGIE: "Admin Énergie",
  RESPONSABLE_SITE: "Responsable Site",
  AUDITEUR: "Auditeur",
  OPERATEUR: "Opérateur",
};

const WRITE_MUTATION_ACTION_MAP = {
  "auth.logout": "LOGOUT",
  "alerts.markAsRead": "MARK_ALERT_READ",
  "anomalies.acknowledge": "MARK_ALERT_READ",
  "recommendations.decide": "DECIDE_RECOMMENDATION",
  "imports.run": "RUN_IMPORT",
  "dataQuality.resolve": "RESOLVE_DATA_QUALITY",
  "incidents.ack": "ACK_INCIDENT",
  "incidents.escalate": "ESCALATE_INCIDENT",
  "machines.create": "CREATE_MACHINE",
  "governance.approveBaseline": "VALIDATE_BASELINE",
  "governance.closePdcaCycle": "CLOSE_PDCA",
  "governance.exportAuditReport": "EXPORT_AUDIT_REPORT",
  "inference.anomaly": "RUN_INFERENCE",
  "pdca.transition": "CLOSE_PDCA",
};

const WRITE_MATRIX = {
  ADMIN_ENERGIE: [
    "CREATE_MACHINE",
    "VALIDATE_BASELINE",
    "APPROVE_DOCUMENT",
    "CLOSE_PDCA",
    "EXPORT_AUDIT_REPORT",
    "MARK_ALERT_READ",
    "DECIDE_RECOMMENDATION",
    "RUN_IMPORT",
    "RESOLVE_DATA_QUALITY",
    "ACK_INCIDENT",
    "ESCALATE_INCIDENT",
    "RUN_INFERENCE",
    "LOGOUT",
  ],
  RESPONSABLE_SITE: ["VALIDATE_BASELINE", "CLOSE_PDCA", "MARK_ALERT_READ", "DECIDE_RECOMMENDATION", "RUN_IMPORT", "RESOLVE_DATA_QUALITY", "ACK_INCIDENT", "ESCALATE_INCIDENT", "RUN_INFERENCE", "LOGOUT"],
  AUDITEUR: ["EXPORT_AUDIT_REPORT", "MARK_ALERT_READ", "ACK_INCIDENT", "LOGOUT"],
  OPERATEUR: ["MARK_ALERT_READ", "DECIDE_RECOMMENDATION", "RUN_INFERENCE", "LOGOUT"],
};

function canWriteEndpoint(role, action, context = {}) {
  if (!WRITE_MATRIX[role]) {
    return false;
  }

  if (WRITE_MATRIX[role].includes(action)) {
    return true;
  }

  return Boolean(context.exceptionApproved);
}

function canRoleExecuteMutation(role, mutationName, context = {}) {
  const action = WRITE_MUTATION_ACTION_MAP[mutationName];
  if (!action) {
    return false;
  }

  return canWriteEndpoint(role, action, context);
}

module.exports = {
  ROLE_LABELS,
  WRITE_MUTATION_ACTION_MAP,
  canWriteEndpoint,
  canRoleExecuteMutation,
};
