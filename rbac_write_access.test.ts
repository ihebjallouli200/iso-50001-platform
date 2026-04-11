import {
  canRoleExecuteMutation,
  WRITE_MUTATION_ACTION_MAP,
  type Role,
  type WriteMutationName,
} from "./auth_rbac";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`RBAC test failed: ${message}`);
  }
}

function runRbacWriteAccessTests() {
  const roles: Role[] = ["ADMIN_ENERGIE", "RESPONSABLE_SITE", "AUDITEUR", "OPERATEUR"];
  const mutations = Object.keys(WRITE_MUTATION_ACTION_MAP) as WriteMutationName[];

  assert(
    JSON.stringify(mutations) ===
      JSON.stringify([
        "auth.logout",
        "alerts.markAsRead",
        "machines.create",
        "governance.approveBaseline",
        "governance.closePdcaCycle",
        "governance.exportAuditReport",
      ]),
    "write mutation coverage list changed unexpectedly",
  );

  for (const mutation of mutations) {
    assert(canRoleExecuteMutation("ADMIN_ENERGIE", mutation) === true, `ADMIN_ENERGIE should access ${mutation}`);
  }

  assert(canRoleExecuteMutation("RESPONSABLE_SITE", "auth.logout") === true, "RESPONSABLE_SITE logout");
  assert(canRoleExecuteMutation("RESPONSABLE_SITE", "alerts.markAsRead") === true, "RESPONSABLE_SITE markAsRead");
  assert(canRoleExecuteMutation("RESPONSABLE_SITE", "machines.create") === false, "RESPONSABLE_SITE create machine");
  assert(canRoleExecuteMutation("RESPONSABLE_SITE", "governance.approveBaseline") === true, "RESPONSABLE_SITE approve baseline");
  assert(canRoleExecuteMutation("RESPONSABLE_SITE", "governance.closePdcaCycle") === true, "RESPONSABLE_SITE close pdca");
  assert(canRoleExecuteMutation("RESPONSABLE_SITE", "governance.exportAuditReport") === false, "RESPONSABLE_SITE export audit");

  assert(canRoleExecuteMutation("AUDITEUR", "auth.logout") === true, "AUDITEUR logout");
  assert(canRoleExecuteMutation("AUDITEUR", "alerts.markAsRead") === true, "AUDITEUR markAsRead");
  assert(canRoleExecuteMutation("AUDITEUR", "machines.create") === false, "AUDITEUR create machine");
  assert(canRoleExecuteMutation("AUDITEUR", "governance.approveBaseline") === false, "AUDITEUR approve baseline");
  assert(canRoleExecuteMutation("AUDITEUR", "governance.closePdcaCycle") === false, "AUDITEUR close pdca");
  assert(canRoleExecuteMutation("AUDITEUR", "governance.exportAuditReport") === true, "AUDITEUR export audit");

  assert(canRoleExecuteMutation("OPERATEUR", "auth.logout") === true, "OPERATEUR logout");
  assert(canRoleExecuteMutation("OPERATEUR", "alerts.markAsRead") === true, "OPERATEUR markAsRead");
  assert(canRoleExecuteMutation("OPERATEUR", "machines.create") === false, "OPERATEUR create machine");
  assert(canRoleExecuteMutation("OPERATEUR", "governance.approveBaseline") === false, "OPERATEUR approve baseline");
  assert(canRoleExecuteMutation("OPERATEUR", "governance.closePdcaCycle") === false, "OPERATEUR close pdca");
  assert(canRoleExecuteMutation("OPERATEUR", "governance.exportAuditReport") === false, "OPERATEUR export audit");

  for (const role of roles) {
    for (const mutation of mutations) {
      if (!canRoleExecuteMutation(role, mutation)) {
        assert(
          canRoleExecuteMutation(role, mutation, { exceptionApproved: true }) === true,
          `${role} should be able to execute ${mutation} with exception`,
        );
      }
    }
  }
}

runRbacWriteAccessTests();
