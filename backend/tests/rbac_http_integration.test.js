const { canRoleExecuteMutation } = require("../core/rbac");

const BASE_URL = process.env.ENMS_BASE_URL || "http://localhost:4001";

const CREDENTIALS = {
  ADMIN_ENERGIE: { username: "admin.energie", password: "Admin50001!" },
  RESPONSABLE_SITE: { username: "resp.site", password: "Site50001!" },
  AUDITEUR: { username: "auditeur.interne", password: "Audit50001!" },
  OPERATEUR: { username: "operateur.l1", password: "Oper50001!" },
};

const WRITE_ENDPOINT_TESTS = [
  {
    mutation: "machines.create",
    path: "/api/machines",
    method: "POST",
    body: {
      siteId: "SITE-TEST",
      machineCode: `MCH-${Date.now()}`,
      machineName: "Machine Test RBAC",
      machineType: "compressor",
    },
  },
  {
    mutation: "alerts.markAsRead",
    path: "/api/alerts/mark-read",
    method: "POST",
    body: { alertId: 1 },
  },
  {
    mutation: "governance.approveBaseline",
    path: "/api/governance/approve-baseline",
    method: "POST",
    body: { baselineId: 1001, reason: "Test approbation RBAC" },
  },
  {
    mutation: "governance.closePdcaCycle",
    path: "/api/governance/close-pdca",
    method: "POST",
    body: { pdcaCycleId: 2002, reason: "Test clôture RBAC" },
  },
  {
    mutation: "governance.exportAuditReport",
    path: "/api/governance/export-audit",
    method: "POST",
    body: { from: "2026-01-01", to: "2026-04-01" },
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function login(role) {
  const credentials = CREDENTIALS[role];
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    throw new Error(`Login failed for role ${role}: ${response.status}`);
  }

  const data = await response.json();
  return data.data.sessionToken;
}

async function callWriteEndpoint(sessionToken, endpoint) {
  const response = await fetch(`${BASE_URL}${endpoint.path}`, {
    method: endpoint.method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(endpoint.body),
  });

  return response.status;
}

async function run() {
  for (const role of Object.keys(CREDENTIALS)) {
    const sessionToken = await login(role);

    for (const endpoint of WRITE_ENDPOINT_TESTS) {
      const status = await callWriteEndpoint(sessionToken, endpoint);
      const expectedAllowed = canRoleExecuteMutation(role, endpoint.mutation);

      if (expectedAllowed) {
        assert(
          status !== 403,
          `Expected ${role} authorized on ${endpoint.mutation}, got HTTP ${status}`,
        );
      } else {
        assert(
          status === 403,
          `Expected ${role} forbidden on ${endpoint.mutation}, got HTTP ${status}`,
        );
      }
    }
  }

  console.log("RBAC integration tests passed for all write mutations.");
}

run().catch(error => {
  console.error("RBAC integration tests failed:", error.message);
  process.exit(1);
});
