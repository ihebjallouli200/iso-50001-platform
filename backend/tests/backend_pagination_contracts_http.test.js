const BASE_URL = process.env.ENMS_BASE_URL || 'http://localhost:4001';

const CREDENTIALS = {
  RESPONSABLE_SITE: { username: 'resp.site', password: 'Site50001!' },
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function login() {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CREDENTIALS.RESPONSABLE_SITE),
  });

  assert(response.ok, `Login failed: HTTP ${response.status}`);
  const payload = await response.json();
  return payload.data.sessionToken;
}

function assertPaginatedEnvelope(payload, label) {
  assert(payload && typeof payload === 'object', `${label}: expected object payload`);
  assert(Array.isArray(payload.data), `${label}: expected data array`);
  assert(payload.meta && typeof payload.meta === 'object', `${label}: expected meta object`);
  assert(typeof payload.meta.contractVersion === 'string', `${label}: expected contractVersion`);
  assert(Number.isFinite(Number(payload.meta.total)), `${label}: expected total`);
  assert(Number.isFinite(Number(payload.meta.count)), `${label}: expected count`);
  assert(Number.isFinite(Number(payload.meta.limit)), `${label}: expected limit`);
  assert(Number.isFinite(Number(payload.meta.offset)), `${label}: expected offset`);
  assert(typeof payload.meta.hasNext === 'boolean', `${label}: expected hasNext`);
  assert(typeof payload.meta.hasPrevious === 'boolean', `${label}: expected hasPrevious`);
}

async function run() {
  const token = await login();
  const headers = { Authorization: `Bearer ${token}` };

  const endpoints = [
    '/api/incidents?responseMode=paginated',
    '/api/data-quality/issues?responseMode=paginated&machineId=1',
    '/api/imports/journal?responseMode=paginated',
    '/api/data-quality/rejections?responseMode=paginated&machineId=1',
  ];

  for (const endpoint of endpoints) {
    const response = await fetch(`${BASE_URL}${endpoint}`, { headers });
    assert(response.ok, `Expected success for ${endpoint}, got HTTP ${response.status}`);
    const payload = await response.json();
    assertPaginatedEnvelope(payload, endpoint);
    assert(!payload.meta.deprecation, `${endpoint}: did not expect deprecation metadata in explicit paginated mode`);
    assert(response.headers.get('deprecation') === null, `${endpoint}: did not expect Deprecation header in explicit mode`);
  }

  const legacyModeResponse = await fetch(`${BASE_URL}/api/incidents?limit=2&offset=0`, { headers });
  assert(legacyModeResponse.ok, `Expected HTTP 200 for legacy pagination mode, got ${legacyModeResponse.status}`);
  const legacyModePayload = await legacyModeResponse.json();
  assertPaginatedEnvelope(legacyModePayload, 'legacy-mode');
  assert(legacyModePayload.meta?.deprecation?.code === 'response_mode_legacy_deprecated', 'legacy-mode: expected deprecation metadata code');
  assert(legacyModeResponse.headers.get('deprecation') === 'true', 'legacy-mode: expected Deprecation header');
  assert(typeof legacyModeResponse.headers.get('sunset') === 'string' && legacyModeResponse.headers.get('sunset').length > 0, 'legacy-mode: expected Sunset header');

  const invalidModeResponse = await fetch(`${BASE_URL}/api/incidents?responseMode=badmode`, { headers });
  assert(invalidModeResponse.status === 400, `Expected HTTP 400 for invalid responseMode, got ${invalidModeResponse.status}`);
  const invalidModePayload = await invalidModeResponse.json();
  assert(invalidModePayload.error === 'responseMode_invalid', `Expected responseMode_invalid, got ${invalidModePayload.error}`);
  assert(typeof invalidModePayload.meta?.contractVersion === 'string', 'Expected error contractVersion in invalid mode response');

  console.log('Backend pagination contract tests passed.');
}

run().catch(error => {
  console.error('Backend pagination contract tests failed:', error.message);
  process.exit(1);
});
