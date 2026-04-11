const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.ENMS_BASE_URL || 'http://localhost:4001';
const EVIDENCE_REPORT_PATH = path.join(process.cwd(), 'reports', 'iso50001_unified_e2e_result.json');

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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function writeEvidenceReport(report) {
  fs.mkdirSync(path.dirname(EVIDENCE_REPORT_PATH), { recursive: true });
  fs.writeFileSync(EVIDENCE_REPORT_PATH, JSON.stringify(report, null, 2), 'utf8');
}

async function run() {
  const operator = await login('OPERATEUR');
  const authHeaders = {
    Authorization: `Bearer ${operator.sessionToken}`,
    'Content-Type': 'application/json',
  };

  const eventTypes = [
    'anomalyDetected_ml_model',
    'pdcaTransition',
    'enpiRecalculated',
    'aiIsoCouplingApplied',
  ];

  const beforeEventsByType = {};
  const beforeMaxEventIdByType = {};
  for (const eventType of eventTypes) {
    const beforeRes = await fetchJson(`${BASE_URL}/api/governance/events?type=${encodeURIComponent(eventType)}&limit=200`, {
      headers: { Authorization: `Bearer ${operator.sessionToken}` },
    });
    assert(beforeRes.response.ok, `Expected governance events pre-check ${eventType} HTTP 200, got ${beforeRes.response.status}`);
    assert(Array.isArray(beforeRes.payload?.data), `Expected governance pre-check array for ${eventType}`);
    beforeEventsByType[eventType] = beforeRes.payload.data;
    beforeMaxEventIdByType[eventType] = beforeEventsByType[eventType].reduce((max, item) => {
      const id = Number(item?.id || 0);
      return id > max ? id : max;
    }, 0);
  }

  const createCycle = await fetchJson(`${BASE_URL}/api/pdca/cycles`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      machineId: 1,
      title: `ISO50001 unified cycle ${Date.now()}`,
      objective: 'Unified chained proof for ISO runtime and corrective loop',
      targetEnpi: 1.9,
      phase: 'Plan',
      status: 'Ouvert',
      actions: [],
      attachments: [],
    }),
  });
  assert(createCycle.response.status === 201, `Expected PDCA create HTTP 201, got ${createCycle.response.status}`);
  const pdcaCycleId = Number(createCycle.payload?.data?.id || 0);
  assert(pdcaCycleId > 0, 'Expected valid PDCA cycle id');

  const infer = await fetchJson(`${BASE_URL}/api/inference/anomaly`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      machineId: 1,
      timestamp: new Date().toISOString(),
      sequence: buildAnomalousSequence(),
      autoCreateRecords: true,
      autoCreateRecommendation: true,
    }),
  });
  assert(infer.response.ok, `Expected anomaly inference HTTP 200, got ${infer.response.status}`);
  const inferenceData = infer.payload?.data || {};
  assert(inferenceData?.inference?.predicted === true, 'Expected predicted=true for synthetic anomalous sequence');

  const anomalyId = Number(inferenceData?.createdAnomaly?.id || 0);
  const recommendationId = Number(inferenceData?.createdRecommendation?.id || 0);
  assert(anomalyId > 0, 'Expected created anomaly id');
  assert(recommendationId > 0, 'Expected created recommendation id');
  assert(inferenceData?.coupling?.applied === true, 'Expected coupling applied after inference');

  const enpi = await fetchJson(`${BASE_URL}/api/enpi/current?machineId=1&windowHours=24&reason=iso_unified_e2e`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(enpi.response.ok, `Expected /api/enpi/current HTTP 200, got ${enpi.response.status}`);
  assert(Number.isFinite(Number(enpi.payload?.data?.enpiNormalized)), 'Expected numeric enpiNormalized');

  const enb = await fetchJson(`${BASE_URL}/api/enb/baseline?machineId=1&referenceWindowHours=24`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(enb.response.ok, `Expected /api/enb/baseline HTTP 200, got ${enb.response.status}`);
  assert(Number.isFinite(Number(enb.payload?.data?.baselineEnpi)), 'Expected numeric baselineEnpi');

  const pdcaStatusAfterInference = await fetchJson(`${BASE_URL}/api/pdca/status?cycleId=${pdcaCycleId}`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(pdcaStatusAfterInference.response.ok, `Expected /api/pdca/status HTTP 200, got ${pdcaStatusAfterInference.response.status}`);
  assert(pdcaStatusAfterInference.payload?.data?.currentPhase === 'Do', `Expected phase Do after inference coupling, got ${pdcaStatusAfterInference.payload?.data?.currentPhase}`);

  const recDecision = await fetchJson(`${BASE_URL}/api/recommendations/decide`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      recommendationId,
      decision: 'accepted',
      comment: 'Accepted during unified ISO 50001 e2e',
    }),
  });
  assert(recDecision.response.ok, `Expected recommendation decision HTTP 200, got ${recDecision.response.status}`);
  assert(recDecision.payload?.data?.coupling?.applied === true, 'Expected coupling applied after accepted recommendation');

  const pdcaStatusAfterDecision = await fetchJson(`${BASE_URL}/api/pdca/status?cycleId=${pdcaCycleId}`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(pdcaStatusAfterDecision.response.ok, `Expected /api/pdca/status HTTP 200, got ${pdcaStatusAfterDecision.response.status}`);
  assert(pdcaStatusAfterDecision.payload?.data?.currentPhase === 'Check', `Expected phase Check after recommendation acceptance, got ${pdcaStatusAfterDecision.payload?.data?.currentPhase}`);

  const dashboardDataA = await fetchJson(`${BASE_URL}/api/analytics/energy-timeline?machineId=1&windowHours=24`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(dashboardDataA.response.ok, `Expected /api/analytics/energy-timeline HTTP 200, got ${dashboardDataA.response.status}`);
  assert(Array.isArray(dashboardDataA.payload?.data), 'Expected energy timeline data array');
  assert(dashboardDataA.payload.data.length > 0, 'Expected non-empty energy timeline data');

  const dashboardDataB = await fetchJson(`${BASE_URL}/api/analytics/site-comparison?windowHours=24`, {
    headers: { Authorization: `Bearer ${operator.sessionToken}` },
  });
  assert(dashboardDataB.response.ok, `Expected /api/analytics/site-comparison HTTP 200, got ${dashboardDataB.response.status}`);
  assert(Array.isArray(dashboardDataB.payload?.data), 'Expected site comparison data array');
  assert(dashboardDataB.payload.data.length > 0, 'Expected non-empty site comparison data');

  const afterEventsByType = {};
  for (const eventType of eventTypes) {
    const eventsRes = await fetchJson(`${BASE_URL}/api/governance/events?type=${encodeURIComponent(eventType)}&limit=200`, {
      headers: { Authorization: `Bearer ${operator.sessionToken}` },
    });
    assert(eventsRes.response.ok, `Expected governance events ${eventType} HTTP 200, got ${eventsRes.response.status}`);
    assert(Array.isArray(eventsRes.payload?.data), `Expected governance events array for ${eventType}`);
    afterEventsByType[eventType] = eventsRes.payload.data;
    assert(afterEventsByType[eventType].length > 0, `Expected at least one governance event for ${eventType}`);
  }

  const governanceDeltas = {
    anomalyDetectedMlModel: afterEventsByType.anomalyDetected_ml_model.filter(item => Number(item?.id || 0) > Number(beforeMaxEventIdByType.anomalyDetected_ml_model || 0)).length,
    pdcaTransition: afterEventsByType.pdcaTransition.filter(item => Number(item?.id || 0) > Number(beforeMaxEventIdByType.pdcaTransition || 0)).length,
    enpiRecalculated: afterEventsByType.enpiRecalculated.filter(item => Number(item?.id || 0) > Number(beforeMaxEventIdByType.enpiRecalculated || 0)).length,
    aiIsoCouplingApplied: afterEventsByType.aiIsoCouplingApplied.filter(item => Number(item?.id || 0) > Number(beforeMaxEventIdByType.aiIsoCouplingApplied || 0)).length,
  };

  assert(governanceDeltas.anomalyDetectedMlModel >= 1, `Expected anomalyDetected_ml_model delta >= 1, got ${governanceDeltas.anomalyDetectedMlModel}`);
  assert(governanceDeltas.pdcaTransition >= 2, `Expected pdcaTransition delta >= 2, got ${governanceDeltas.pdcaTransition}`);
  assert(governanceDeltas.enpiRecalculated >= 2, `Expected enpiRecalculated delta >= 2, got ${governanceDeltas.enpiRecalculated}`);
  assert(governanceDeltas.aiIsoCouplingApplied >= 2, `Expected aiIsoCouplingApplied delta >= 2, got ${governanceDeltas.aiIsoCouplingApplied}`);

  const transitionForCycle = afterEventsByType.pdcaTransition.find(event => Number(event?.payload?.pdcaCycleId) === pdcaCycleId);
  assert(transitionForCycle, 'Expected pdcaTransition event for created cycle');

  const anomalyEventForRun = afterEventsByType.anomalyDetected_ml_model.find(event => Number(event?.payload?.anomalyId) === anomalyId);
  assert(anomalyEventForRun, `Expected anomalyDetected_ml_model event for anomalyId=${anomalyId}`);

  const evidenceReport = {
    generatedAt: new Date().toISOString(),
    testId: 'ISO50001_UNIFIED_E2E_V1',
    baseUrl: BASE_URL,
    machineId: 1,
    artifacts: {
      pdcaCycleId,
      anomalyId,
      recommendationId,
      finalPdcaPhase: pdcaStatusAfterDecision.payload?.data?.currentPhase,
      enpiNormalized: Number(enpi.payload?.data?.enpiNormalized || 0),
      baselineEnpi: Number(enb.payload?.data?.baselineEnpi || 0),
      dashboardDataAvailability: {
        energyTimelineCount: Number(dashboardDataA.payload?.meta?.count || dashboardDataA.payload?.data?.length || 0),
        siteComparisonCount: Number(dashboardDataB.payload?.meta?.count || dashboardDataB.payload?.data?.length || 0),
      },
    },
    governanceEvidence: {
      before: {
        anomalyDetectedMlModel: Number(beforeEventsByType.anomalyDetected_ml_model.length),
        pdcaTransition: Number(beforeEventsByType.pdcaTransition.length),
        enpiRecalculated: Number(beforeEventsByType.enpiRecalculated.length),
        aiIsoCouplingApplied: Number(beforeEventsByType.aiIsoCouplingApplied.length),
      },
      after: {
        anomalyDetectedMlModel: Number(afterEventsByType.anomalyDetected_ml_model.length),
        pdcaTransition: Number(afterEventsByType.pdcaTransition.length),
        enpiRecalculated: Number(afterEventsByType.enpiRecalculated.length),
        aiIsoCouplingApplied: Number(afterEventsByType.aiIsoCouplingApplied.length),
      },
      delta: governanceDeltas,
    },
    assertions: {
      inferencePredicted: true,
      pdcaAfterInference: 'Do',
      pdcaAfterRecommendationAccepted: 'Check',
      dashboardDataAvailable: true,
      governanceTrailComplete: true,
      governanceDeltaThresholdsPassed: true,
    },
    status: 'passed',
  };

  writeEvidenceReport(evidenceReport);
  console.log('ISO 50001 unified E2E chain test passed.');
}

run().catch(error => {
  const failureReport = {
    generatedAt: new Date().toISOString(),
    testId: 'ISO50001_UNIFIED_E2E_V1',
    status: 'failed',
    error: error.message,
  };
  try {
    writeEvidenceReport(failureReport);
  } catch (_ignored) {
    // ignore secondary report write failure
  }
  console.error('ISO 50001 unified E2E chain test failed:', error.message);
  process.exit(1);
});
