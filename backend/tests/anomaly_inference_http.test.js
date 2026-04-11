const BASE_URL = process.env.ENMS_BASE_URL || 'http://localhost:4001';

const CREDENTIALS = {
  ADMIN_ENERGIE: { username: 'admin.energie', password: 'Admin50001!' },
  OPERATEUR: { username: 'operateur.l1', password: 'Oper50001!' },
  AUDITEUR: { username: 'auditeur.interne', password: 'Audit50001!' },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function login(role) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CREDENTIALS[role]),
  });

  assert(response.ok, `Login failed for ${role}: HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data;
}

function buildAnomalousSequence(length = 30) {
  const seq = [];
  for (let index = 0; index < length; index += 1) {
    seq.push([
      45 + index * 0.2,
      50 + index * 0.2,
      0.65,
      8.5,
      8.1,
      1.5,
      1.2,
      1.0,
      1800,
      280,
      1,
      0.35,
    ]);
  }
  return seq;
}

async function run() {
  const operator = await login('OPERATEUR');
  const admin = await login('ADMIN_ENERGIE');
  const auditor = await login('AUDITEUR');

  const anonymousInfer = await fetch(`${BASE_URL}/api/inference/anomaly`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ machineId: 1, sequence: buildAnomalousSequence() }),
  });
  assert(anonymousInfer.status === 401, `Expected anonymous inference HTTP 401, got ${anonymousInfer.status}`);

  const auditorInfer = await fetch(`${BASE_URL}/api/inference/anomaly`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auditor.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ machineId: 1, sequence: buildAnomalousSequence() }),
  });
  assert(auditorInfer.status === 403, `Expected AUDITEUR inference HTTP 403, got ${auditorInfer.status}`);

  const modelsList = await fetch(`${BASE_URL}/api/models/versions`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(modelsList.ok, `Expected /api/models/versions HTTP 200, got ${modelsList.status}`);
  const modelsPayload = await modelsList.json();
  assert(Array.isArray(modelsPayload?.data?.items), 'Expected models list data.items array');
  assert(modelsPayload.data.items.length > 0, 'Expected at least one model version');
  assert(modelsPayload?.data?.active?.version, 'Expected active model version');
  const activeVersion = String(modelsPayload.data.active.version);

  const activationForbidden = await fetch(`${BASE_URL}/api/models/activate-version`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${operator.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version: activeVersion }),
  });
  assert(activationForbidden.status === 403, `Expected OPERATOR activate-version HTTP 403, got ${activationForbidden.status}`);

  const activationOk = await fetch(`${BASE_URL}/api/models/activate-version`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${admin.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ version: activeVersion }),
  });
  assert(activationOk.ok, `Expected ADMIN activate-version HTTP 200, got ${activationOk.status}`);
  const activationPayload = await activationOk.json();
  assert(activationPayload?.data?.success === true, 'Expected activate-version success true');
  assert(String(activationPayload?.data?.active?.version) === activeVersion, 'Expected activated version to match target');
  assert(activationPayload?.data?.event?.type === 'modelVersionActivated', 'Expected governance event modelVersionActivated');

  const beforeAnomaliesResponse = await fetch(`${BASE_URL}/api/anomalies?status=open&machineId=1`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(beforeAnomaliesResponse.ok, `Expected anomalies before inference HTTP 200, got ${beforeAnomaliesResponse.status}`);
  const beforeAnomalies = await beforeAnomaliesResponse.json();
  const beforeCount = Number(beforeAnomalies?.meta?.count || 0);

  const inferResponse = await fetch(`${BASE_URL}/api/inference/anomaly`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${operator.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      machineId: 1,
      timestamp: new Date().toISOString(),
      sequence: buildAnomalousSequence(),
      autoCreateRecords: true,
      autoCreateRecommendation: true,
    }),
  });

  assert(inferResponse.ok, `Expected inference HTTP 200, got ${inferResponse.status}`);
  const inferPayload = await inferResponse.json();
  const result = inferPayload.data;

  assert(result && result.inference, 'Expected inference payload data.inference');
  assert(typeof result.inference.predicted === 'boolean', 'Expected inference.predicted boolean');
  assert(Number.isFinite(Number(result.inference.anomalyScore)), 'Expected numeric anomalyScore');
  assert(Number.isFinite(Number(result.inference.threshold)), 'Expected numeric threshold');
  assert(typeof result.inference.modelVersion === 'string' && result.inference.modelVersion.length > 0, 'Expected modelVersion string');
  assert(typeof result.inference.inferenceId === 'string' && result.inference.inferenceId.length > 0, 'Expected inferenceId string');

  // Auto-create behavior should attach records when prediction is positive.
  assert(result.inference.predicted === true, 'Expected predicted=true for synthetic anomalous sequence');
  assert(result.createdAnomaly && Number(result.createdAnomaly.id) > 0, 'Expected createdAnomaly in response');
  assert(result.createdRecommendation && Number(result.createdRecommendation.id) > 0, 'Expected createdRecommendation in response');

  const afterAnomaliesResponse = await fetch(`${BASE_URL}/api/anomalies?status=open&machineId=1`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(afterAnomaliesResponse.ok, `Expected anomalies after inference HTTP 200, got ${afterAnomaliesResponse.status}`);
  const afterAnomalies = await afterAnomaliesResponse.json();
  const afterCount = Number(afterAnomalies?.meta?.count || 0);
  assert(afterCount >= beforeCount + 1, `Expected anomalies count to increase by >=1, before=${beforeCount}, after=${afterCount}`);

  const eventsResponse = await fetch(`${BASE_URL}/api/governance/events?type=anomalyDetected_ml_model&limit=5`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(eventsResponse.ok, `Expected governance events HTTP 200, got ${eventsResponse.status}`);
  const eventsPayload = await eventsResponse.json();
  assert(Array.isArray(eventsPayload?.data), 'Expected governance events list');
  assert(eventsPayload.data.length >= 1, 'Expected at least one anomalyDetected_ml_model event');

  console.log('Anomaly inference contract + RBAC + auto-create tests passed.');
}

run().catch(error => {
  console.error('Anomaly inference contract + RBAC + auto-create tests failed:', error.message);
  process.exit(1);
});
