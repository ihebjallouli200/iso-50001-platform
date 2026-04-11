const BASE_URL = process.env.ENMS_BASE_URL || 'http://localhost:4001';

const CREDENTIALS = {
  RESPONSABLE_SITE: { username: 'resp.site', password: 'Site50001!' },
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
  const session = await login('RESPONSABLE_SITE');
  const headers = {
    Authorization: `Bearer ${session.sessionToken}`,
    'Content-Type': 'application/json',
  };

  const healthResponse = await fetch(`${BASE_URL}/api/ingestion/health`, { headers });
  assert(healthResponse.ok, `Expected ingestion health HTTP 200, got ${healthResponse.status}`);
  const healthPayload = await healthResponse.json();
  assert(healthPayload?.data?.components?.timescale, 'Expected timescale component in ingestion health');
  assert(healthPayload?.data?.components?.influxMirror, 'Expected influx mirror component in ingestion health');

  const readinessResponse = await fetch(`${BASE_URL}/api/ingestion/readiness`, { headers });
  assert([200, 503].includes(readinessResponse.status), `Expected readiness HTTP 200 or 503, got ${readinessResponse.status}`);
  const readinessPayload = await readinessResponse.json();
  assert(typeof readinessPayload?.data?.status === 'string', 'Expected readiness status');

  const batchBody = {
    filePath: 'data/raw/synthetic_measurements.csv',
    sourceName: `synthetic_batch_e2e_${Date.now()}`,
    machineId: 1,
    maxRows: 25,
  };

  const batchResponse = await fetch(`${BASE_URL}/api/ingestion/batch/load`, {
    method: 'POST',
    headers,
    body: JSON.stringify(batchBody),
  });
  assert(batchResponse.status === 201, `Expected batch load HTTP 201, got ${batchResponse.status}`);
  const batchPayload = await batchResponse.json();
  assert(batchPayload?.data?.import?.id, 'Expected batch import id');
  assert(batchPayload?.data?.batch && typeof batchPayload.data.batch.integrationMode === 'string', 'Expected batch integrationMode');

  const eventsResponse = await fetch(`${BASE_URL}/api/ingestion/health/events?limit=10`, { headers });
  assert(eventsResponse.ok, `Expected ingestion health events HTTP 200, got ${eventsResponse.status}`);
  const eventsPayload = await eventsResponse.json();
  assert(Array.isArray(eventsPayload?.data?.recentEvents), 'Expected recentEvents array');

  console.log('Ingestion HTTP E2E scenario passed.');
}

run().catch(error => {
  console.error('Ingestion HTTP E2E scenario failed:', error.message);
  process.exit(1);
});
