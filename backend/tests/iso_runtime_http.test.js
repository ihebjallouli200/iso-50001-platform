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

async function run() {
  const operator = await login('OPERATEUR');
  const admin = await login('ADMIN_ENERGIE');
  const auditor = await login('AUDITEUR');

  const anonymousEnpi = await fetch(`${BASE_URL}/api/enpi/current?machineId=1`);
  assert(anonymousEnpi.status === 401, `Expected anonymous /api/enpi/current HTTP 401, got ${anonymousEnpi.status}`);

  const enpiResponse = await fetch(`${BASE_URL}/api/enpi/current?machineId=1&windowHours=24&regressionR2=0.62&reason=monitoring_tick`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(enpiResponse.ok, `Expected /api/enpi/current HTTP 200, got ${enpiResponse.status}`);
  const enpiPayload = await enpiResponse.json();
  assert(Number.isFinite(Number(enpiPayload?.data?.enpiValue)), 'Expected numeric enpiValue');
  assert(Number.isFinite(Number(enpiPayload?.data?.enpiNormalized)), 'Expected numeric enpiNormalized');
  assert(typeof enpiPayload?.data?.status === 'string', 'Expected string status');
  assert(enpiPayload?.data?.diagnostics?.fallbackApplied === true, 'Expected fallbackApplied=true when regressionR2 below threshold');

  const enbResponse = await fetch(`${BASE_URL}/api/enb/baseline?machineId=1&referenceWindowHours=24`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(enbResponse.ok, `Expected /api/enb/baseline HTTP 200, got ${enbResponse.status}`);
  const enbPayload = await enbResponse.json();
  assert(Number.isFinite(Number(enbPayload?.data?.baselineEnpi)), 'Expected numeric baselineEnpi');

  const createCycleResponse = await fetch(`${BASE_URL}/api/pdca/cycles`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${operator.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      machineId: 1,
      title: `ISO runtime transition cycle ${Date.now()}`,
      objective: 'Valider transitions PDCA strictes avec journalisation',
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
  assert(cycleId > 0, 'Expected valid created PDCA cycle id');

  const auditorTransition = await fetch(`${BASE_URL}/api/pdca/transition`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${auditor.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pdcaCycleId: cycleId,
      toPhase: 'Do',
      reason: 'Should fail for auditor role',
    }),
  });
  assert(auditorTransition.status === 403, `Expected AUDITEUR transition HTTP 403, got ${auditorTransition.status}`);

  const adminTransitionDo = await fetch(`${BASE_URL}/api/pdca/transition`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${admin.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pdcaCycleId: cycleId,
      toPhase: 'Do',
      reason: 'Start execution phase',
      linkedAnomalyId: 1,
      linkedRecommendationId: 1,
    }),
  });
  assert(adminTransitionDo.ok, `Expected ADMIN transition Plan->Do HTTP 200, got ${adminTransitionDo.status}`);

  const invalidTransition = await fetch(`${BASE_URL}/api/pdca/transition`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${admin.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pdcaCycleId: cycleId,
      toPhase: 'Act',
      reason: 'Invalid direct jump',
    }),
  });
  assert(invalidTransition.status === 409, `Expected invalid PDCA transition HTTP 409, got ${invalidTransition.status}`);

  const statusResponse = await fetch(`${BASE_URL}/api/pdca/status?cycleId=${cycleId}`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(statusResponse.ok, `Expected /api/pdca/status HTTP 200, got ${statusResponse.status}`);
  const statusPayload = await statusResponse.json();
  assert(statusPayload?.data?.currentPhase === 'Do', `Expected currentPhase=Do, got ${statusPayload?.data?.currentPhase}`);
  assert(statusPayload?.data?.nextAllowedPhase === 'Check', 'Expected nextAllowedPhase=Check after Plan->Do');

  const governanceResponse = await fetch(`${BASE_URL}/api/governance/events?type=pdcaTransition&limit=5`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(governanceResponse.ok, `Expected governance events HTTP 200, got ${governanceResponse.status}`);
  const governancePayload = await governanceResponse.json();
  assert(Array.isArray(governancePayload?.data), 'Expected governance events list');
  assert(governancePayload.data.length >= 1, 'Expected at least one pdcaTransition governance event');
  const transitionEvent = governancePayload.data.find(event => Number(event?.payload?.pdcaCycleId) === cycleId);
  assert(transitionEvent, 'Expected pdcaTransition event for created cycle');
  assert(transitionEvent?.payload?.before_value && transitionEvent?.payload?.after_value, 'Expected before_value and after_value in governance event payload');

  console.log('ISO runtime EnPI/EnB + PDCA transition/status tests passed.');
}

run().catch(error => {
  console.error('ISO runtime EnPI/EnB + PDCA transition/status tests failed:', error.message);
  process.exit(1);
});
