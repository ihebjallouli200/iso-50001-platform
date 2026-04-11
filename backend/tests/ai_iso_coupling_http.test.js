const BASE_URL = process.env.ENMS_BASE_URL || 'http://localhost:4001';

const CREDENTIALS = {
  OPERATEUR: { username: 'operateur.l1', password: 'Oper50001!' },
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

  const createCycleResponse = await fetch(`${BASE_URL}/api/pdca/cycles`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${operator.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      machineId: 1,
      title: `AI-ISO coupling cycle ${Date.now()}`,
      objective: 'Verifier couplage automatique anomaly->PDCA->EnPI',
      targetEnpi: 1.9,
      phase: 'Plan',
      status: 'Ouvert',
      actions: [],
      attachments: [],
    }),
  });

  assert(createCycleResponse.status === 201, `Expected create PDCA HTTP 201, got ${createCycleResponse.status}`);
  const createCyclePayload = await createCycleResponse.json();
  const cycleId = Number(createCyclePayload?.data?.id || 0);
  assert(cycleId > 0, 'Expected valid pdca cycle id');

  const inferenceResponse = await fetch(`${BASE_URL}/api/inference/anomaly`, {
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

  assert(inferenceResponse.ok, `Expected inference HTTP 200, got ${inferenceResponse.status}`);
  const inferencePayload = await inferenceResponse.json();
  const inferenceData = inferencePayload?.data || {};
  assert(inferenceData?.inference?.predicted === true, 'Expected predicted=true for coupling test sequence');
  assert(Number(inferenceData?.createdAnomaly?.id) > 0, 'Expected anomaly created');
  assert(Number(inferenceData?.createdRecommendation?.id) > 0, 'Expected recommendation created');
  assert(inferenceData?.coupling?.applied === true, 'Expected coupling.applied=true on strong anomaly');

  const statusAfterInferenceResponse = await fetch(`${BASE_URL}/api/pdca/status?cycleId=${cycleId}`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(statusAfterInferenceResponse.ok, `Expected pdca status HTTP 200, got ${statusAfterInferenceResponse.status}`);
  const statusAfterInferencePayload = await statusAfterInferenceResponse.json();
  assert(statusAfterInferencePayload?.data?.currentPhase === 'Do', `Expected PDCA phase Do after inference coupling, got ${statusAfterInferencePayload?.data?.currentPhase}`);

  const recommendationId = Number(inferenceData?.createdRecommendation?.id || 0);
  const decideResponse = await fetch(`${BASE_URL}/api/recommendations/decide`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${operator.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recommendationId,
      decision: 'accepted',
      comment: 'Accepted for coupling transition test',
    }),
  });

  assert(decideResponse.ok, `Expected recommendation decision HTTP 200, got ${decideResponse.status}`);
  const decidePayload = await decideResponse.json();
  assert(decidePayload?.data?.coupling?.applied === true, 'Expected coupling.applied=true on accepted recommendation');

  const statusAfterDecisionResponse = await fetch(`${BASE_URL}/api/pdca/status?cycleId=${cycleId}`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(statusAfterDecisionResponse.ok, `Expected pdca status HTTP 200, got ${statusAfterDecisionResponse.status}`);
  const statusAfterDecisionPayload = await statusAfterDecisionResponse.json();
  assert(statusAfterDecisionPayload?.data?.currentPhase === 'Check', `Expected PDCA phase Check after recommendation acceptance, got ${statusAfterDecisionPayload?.data?.currentPhase}`);

  const couplingEventsResponse = await fetch(`${BASE_URL}/api/governance/events?type=aiIsoCouplingApplied&limit=10`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(couplingEventsResponse.ok, `Expected aiIsoCouplingApplied events HTTP 200, got ${couplingEventsResponse.status}`);
  const couplingEventsPayload = await couplingEventsResponse.json();
  assert(Array.isArray(couplingEventsPayload?.data), 'Expected aiIsoCouplingApplied event list');
  assert(couplingEventsPayload.data.length >= 1, 'Expected at least one aiIsoCouplingApplied event');

  const enpiEventsResponse = await fetch(`${BASE_URL}/api/governance/events?type=enpiRecalculated&limit=10`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(enpiEventsResponse.ok, `Expected enpiRecalculated events HTTP 200, got ${enpiEventsResponse.status}`);
  const enpiEventsPayload = await enpiEventsResponse.json();
  assert(Array.isArray(enpiEventsPayload?.data), 'Expected enpiRecalculated event list');
  assert(enpiEventsPayload.data.length >= 1, 'Expected at least one enpiRecalculated event');

  console.log('AI-to-ISO coupling contract test passed.');
}

run().catch(error => {
  console.error('AI-to-ISO coupling contract test failed:', error.message);
  process.exit(1);
});
