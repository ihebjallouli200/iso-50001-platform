const BASE_URL = process.env.ENMS_BASE_URL || "http://localhost:4001";

const CREDENTIALS = {
  RESPONSABLE_SITE: { username: "resp.site", password: "Site50001!" },
  OPERATEUR: { username: "operateur.l1", password: "Oper50001!" },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function unwrapListEnvelope(payload, label) {
  assert(payload && typeof payload === "object", `${label}: expected object payload`);
  assert(Array.isArray(payload.data), `${label}: expected data array`);
  assert(payload.meta && typeof payload.meta === "object", `${label}: expected meta object`);
  return payload;
}

async function login(role) {
  const credentials = CREDENTIALS[role];
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });

  assert(response.ok, `Login failed for ${role}: HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data;
}

async function getWithToken(path, token) {
  return fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function postWithToken(path, token, body) {
  return fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function run() {
  const siteSession = await login("RESPONSABLE_SITE");
  const operatorSession = await login("OPERATEUR");

  const meByQueryResponse = await fetch(`${BASE_URL}/api/auth/meByToken?sessionToken=${siteSession.sessionToken}`);
  assert(meByQueryResponse.status === 400, `Expected meByToken query to be rejected, got HTTP ${meByQueryResponse.status}`);

  const liveResponse = await getWithToken("/api/machines/live", siteSession.sessionToken);
  assert(liveResponse.ok, `Expected /api/machines/live success, got HTTP ${liveResponse.status}`);
  const livePayload = unwrapListEnvelope(await liveResponse.json(), "/api/machines/live");
  assert(livePayload.data.length > 0, "Expected non-empty live payload");

  const incidentsPagedResponse = await getWithToken("/api/incidents?limit=2&offset=0", siteSession.sessionToken);
  assert(incidentsPagedResponse.ok, `Expected /api/incidents paged success, got HTTP ${incidentsPagedResponse.status}`);
  const incidentsPagedPayload = await incidentsPagedResponse.json();
  assert(incidentsPagedPayload && typeof incidentsPagedPayload === "object", "Expected incidents paged payload object");
  assert(Array.isArray(incidentsPagedPayload.data), "Expected incidents paged payload.data to be an array");
  assert(Number.isFinite(Number(incidentsPagedPayload.meta?.total)), "Expected incidents paged payload.meta.total");
  assert(Number.isFinite(Number(incidentsPagedPayload.meta?.count)), "Expected incidents paged payload.meta.count");
  assert(incidentsPagedPayload.data.length <= 2, `Expected incidents page size <= 2, got ${incidentsPagedPayload.data.length}`);

  const sloResponse = await getWithToken("/api/slo/dashboard?windowHours=24", siteSession.sessionToken);
  assert(sloResponse.ok, `Expected /api/slo/dashboard success, got HTTP ${sloResponse.status}`);
  const sloPayload = (await sloResponse.json()).data;
  assert(Number(sloPayload?.summary?.totalSlo) > 0, "Expected SLO summary.totalSlo > 0");

  const incidentListResponse = await getWithToken("/api/incidents", siteSession.sessionToken);
  assert(incidentListResponse.ok, `Expected /api/incidents success, got HTTP ${incidentListResponse.status}`);
  const incidentsPayload = unwrapListEnvelope(await incidentListResponse.json(), "/api/incidents");
  const incidents = incidentsPayload.data;
  assert(incidents.length > 0, "Expected non-empty incidents list");

  const targetIncident = incidents[0];
  const escalateAllowedResponse = await postWithToken("/api/incidents/escalate", siteSession.sessionToken, {
    incidentId: targetIncident.id,
    reason: "Validation test critique FE",
    targetTeam: "Plateforme",
  });
  assert(escalateAllowedResponse.ok, `Expected responsable site escalation success, got HTTP ${escalateAllowedResponse.status}`);

  const escalateDeniedResponse = await postWithToken("/api/incidents/escalate", operatorSession.sessionToken, {
    incidentId: targetIncident.id,
    reason: "Tentative opérateur",
    targetTeam: "Plateforme",
  });
  assert(escalateDeniedResponse.status === 403, `Expected operator escalation forbidden, got HTTP ${escalateDeniedResponse.status}`);

  console.log("FE critical HTTP path tests passed.");
}

run().catch(error => {
  console.error("FE critical HTTP path tests failed:", error.message);
  process.exit(1);
});
