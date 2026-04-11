const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.ENMS_BASE_URL || 'http://localhost:4001';
const LEGACY_USAGE_METRICS_FILE = path.join(__dirname, '..', 'data', 'legacy_usage_metrics.json');

const CREDENTIALS = {
  ADMIN_ENERGIE: { username: 'admin.energie', password: 'Admin50001!' },
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
  const contractResponse = await fetch(`${BASE_URL}/api/contract`);
  assert(contractResponse.ok, `Expected /api/contract HTTP 200, got ${contractResponse.status}`);
  const contractPayload = await contractResponse.json();
  assert(contractPayload?.data?.contractVersion, 'Expected contract payload version');
  assert(contractPayload?.meta?.contractVersion === contractPayload?.data?.contractVersion, 'Expected aligned meta/data contractVersion');
  assert(contractPayload?.data?.listResponseModes?.legacyPolicy === 'warn', 'Expected default legacy policy = warn');
  assert(typeof contractPayload?.data?.listResponseModes?.legacySunsetAt === 'string', 'Expected legacy sunset timestamp');
  assert(typeof contractPayload?.data?.listResponseModes?.legacyAutoDenyAt === 'string', 'Expected legacy auto deny timestamp');
  assert(typeof contractPayload?.data?.listResponseModes?.legacyAutoDenyActive === 'boolean', 'Expected legacy auto deny active flag');
  const initialLegacyUsageTotal = Number(contractPayload?.data?.telemetry?.legacyUsage?.totalCount || 0);

  const invalidJsonResponse = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"username":"admin.energie"',
  });
  assert(invalidJsonResponse.status === 400, `Expected invalid JSON HTTP 400, got ${invalidJsonResponse.status}`);
  const invalidJsonPayload = await invalidJsonResponse.json();
  assert(invalidJsonPayload.error === 'invalid_json_body', `Expected invalid_json_body, got ${invalidJsonPayload.error}`);
  assert(typeof invalidJsonPayload.message === 'string' && invalidJsonPayload.message.length > 0, 'Expected standardized error.message');
  assert(invalidJsonPayload.meta && typeof invalidJsonPayload.meta.contractVersion === 'string', 'Expected error meta.contractVersion');

  const session = await login('RESPONSABLE_SITE');
  const headers = {
    Authorization: `Bearer ${session.sessionToken}`,
    'Content-Type': 'application/json',
  };

  const ingestionHealthResponse = await fetch(`${BASE_URL}/api/ingestion/health`, { headers });
  assert(ingestionHealthResponse.ok, `Expected ingestion health HTTP 200, got ${ingestionHealthResponse.status}`);
  const ingestionHealthPayload = await ingestionHealthResponse.json();
  assert(typeof ingestionHealthPayload?.data?.integrationMode === 'string', 'Expected ingestion health integrationMode');
  assert(ingestionHealthPayload?.data?.components?.timescale, 'Expected ingestion health timescale component');
  assert(ingestionHealthPayload?.data?.components?.influxMirror, 'Expected ingestion health influxMirror component');
  assert(ingestionHealthPayload?.data?.activity?.influxRetry, 'Expected ingestion health influx retry metrics');

  const ingestionReadinessResponse = await fetch(`${BASE_URL}/api/ingestion/readiness`, { headers });
  assert([200, 503].includes(ingestionReadinessResponse.status), `Expected ingestion readiness HTTP 200 or 503, got ${ingestionReadinessResponse.status}`);
  const ingestionReadinessPayload = await ingestionReadinessResponse.json();
  assert(typeof ingestionReadinessPayload?.data?.status === 'string', 'Expected readiness status');
  assert(typeof ingestionReadinessPayload?.data?.strict === 'boolean', 'Expected readiness strict boolean');
  assert(typeof ingestionReadinessPayload?.data?.checks?.timescale?.healthy === 'boolean', 'Expected readiness timescale check');

  const invalidIncidentsLimit = await fetch(`${BASE_URL}/api/incidents?limit=abc`, { headers });
  assert(invalidIncidentsLimit.status === 400, `Expected incidents invalid limit HTTP 400, got ${invalidIncidentsLimit.status}`);
  const invalidLimitPayload = await invalidIncidentsLimit.json();
  assert(invalidLimitPayload.error === 'limit_invalid', `Expected limit_invalid, got ${invalidLimitPayload.error}`);
  assert(typeof invalidLimitPayload.meta?.contractVersion === 'string', 'Expected error meta.contractVersion for invalid limit');

  const importBody = {
    sourceName: `Synthetic Backend Hardening ${Date.now()}`,
    sourceType: 'synthetic_csv',
    fileName: 'synthetic_backend_hardening.csv',
    machineId: 1,
    rowCount: 50,
    rejectedRows: 2,
  };
  const createdImport = await fetch(`${BASE_URL}/api/imports/run`, {
    method: 'POST',
    headers,
    body: JSON.stringify(importBody),
  });
  assert(createdImport.status === 201, `Expected import creation HTTP 201, got ${createdImport.status}`);
  const createdImportPayload = await createdImport.json();
  assert(createdImportPayload && createdImportPayload.data, 'Expected wrapped import creation payload');

  const journalPage1Response = await fetch(`${BASE_URL}/api/imports/journal?limit=1&offset=0`, { headers });
  assert(journalPage1Response.ok, `Expected journal page1 success, got HTTP ${journalPage1Response.status}`);
  const journalPage1 = await journalPage1Response.json();
  assert(journalPage1 && typeof journalPage1 === 'object', 'Expected paginated journal object');
  assert(Array.isArray(journalPage1.data), 'Expected paginated journal data array');
  assert(Number.isFinite(Number(journalPage1.meta?.total)), 'Expected paginated journal total');
  assert(Number.isFinite(Number(journalPage1.meta?.count)), 'Expected paginated journal count');
  assert(typeof journalPage1.meta?.contractVersion === 'string', 'Expected success meta.contractVersion');
  assert(journalPage1.meta?.deprecation?.code === 'response_mode_legacy_deprecated', 'Expected explicit legacy deprecation metadata');
  assert(journalPage1.meta?.deprecation?.enforcementMode === 'warn', 'Expected warn enforcement mode while before auto deny date');
  assert(journalPage1.data.length === 1, `Expected exactly 1 journal entry on page1, got ${journalPage1.data.length}`);

  const contractAfterLegacyResponse = await fetch(`${BASE_URL}/api/contract`);
  assert(contractAfterLegacyResponse.ok, `Expected /api/contract after legacy call HTTP 200, got ${contractAfterLegacyResponse.status}`);
  const contractAfterLegacyPayload = await contractAfterLegacyResponse.json();
  const legacyUsage = contractAfterLegacyPayload?.data?.telemetry?.legacyUsage;
  assert(Number(legacyUsage?.totalCount) >= initialLegacyUsageTotal + 1, 'Expected telemetry legacy usage totalCount to increase after legacy call');
  const importsJournalUsage = (legacyUsage?.perEndpoint || []).find(item => item.endpoint === '/api/imports/journal');
  assert(importsJournalUsage && Number(importsJournalUsage.count) >= 1, 'Expected legacy usage tracked for /api/imports/journal');

  assert(fs.existsSync(LEGACY_USAGE_METRICS_FILE), 'Expected legacy usage metrics file to exist on disk');
  const persistedMetricsPayload = JSON.parse(fs.readFileSync(LEGACY_USAGE_METRICS_FILE, 'utf8'));
  const persistedImportsJournalUsage = (persistedMetricsPayload?.perEndpoint || []).find(item => item.endpoint === '/api/imports/journal');
  assert(persistedImportsJournalUsage && Number(persistedImportsJournalUsage.count) >= 1, 'Expected persisted legacy usage for /api/imports/journal');

  const resetForbiddenResponse = await fetch(`${BASE_URL}/api/admin/contract/metrics/reset`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ reason: 'forbidden-check' }),
  });
  assert(resetForbiddenResponse.status === 403, `Expected reset forbidden HTTP 403 for non-admin, got ${resetForbiddenResponse.status}`);

  const resetHistoryForbiddenResponse = await fetch(`${BASE_URL}/api/admin/contract/metrics/resets`, {
    headers,
  });
  assert(resetHistoryForbiddenResponse.status === 403, `Expected reset history forbidden HTTP 403 for non-admin, got ${resetHistoryForbiddenResponse.status}`);

  const resetHistoryCsvForbiddenResponse = await fetch(`${BASE_URL}/api/admin/contract/metrics/resets/export.csv`, {
    headers,
  });
  assert(resetHistoryCsvForbiddenResponse.status === 403, `Expected reset history CSV forbidden HTTP 403 for non-admin, got ${resetHistoryCsvForbiddenResponse.status}`);

  const adminSession = await login('ADMIN_ENERGIE');
  const adminHeaders = {
    Authorization: `Bearer ${adminSession.sessionToken}`,
    'Content-Type': 'application/json',
  };

  const resetSuccessResponse = await fetch(`${BASE_URL}/api/admin/contract/metrics/reset`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ reason: 'backend-hardening-test' }),
  });
  assert(resetSuccessResponse.ok, `Expected reset success HTTP 200, got ${resetSuccessResponse.status}`);
  const resetSuccessPayload = await resetSuccessResponse.json();
  assert(resetSuccessPayload?.data?.success === true, 'Expected reset success flag');
  assert(Number(resetSuccessPayload?.data?.before?.totalCount) >= 1, 'Expected reset before.totalCount >= 1');
  assert(Number(resetSuccessPayload?.data?.after?.totalCount) === 0, 'Expected reset after.totalCount = 0');
  assert(typeof resetSuccessPayload?.data?.audit?.resetAt === 'string', 'Expected reset audit timestamp');
  assert(resetSuccessPayload?.data?.audit?.resetBy?.role === 'ADMIN_ENERGIE', 'Expected reset audit admin role');
  assert(resetSuccessPayload?.data?.audit?.reason === 'backend-hardening-test', 'Expected reset audit reason');

  const resetHistoryAdminResponse = await fetch(`${BASE_URL}/api/admin/contract/metrics/resets?limit=10&offset=0`, {
    headers: adminHeaders,
  });
  assert(resetHistoryAdminResponse.ok, `Expected reset history HTTP 200 for admin, got ${resetHistoryAdminResponse.status}`);
  const resetHistoryAdminPayload = await resetHistoryAdminResponse.json();
  assert(Array.isArray(resetHistoryAdminPayload?.data), 'Expected reset history data array');
  assert(Number(resetHistoryAdminPayload?.meta?.total) >= 1, 'Expected reset history total >= 1');
  assert(typeof resetHistoryAdminPayload?.meta?.contractVersion === 'string', 'Expected reset history meta.contractVersion');
  const latestReset = resetHistoryAdminPayload.data[0];
  assert(latestReset?.reason === 'backend-hardening-test', 'Expected latest reset history reason');
  assert(latestReset?.resetBy?.role === 'ADMIN_ENERGIE', 'Expected latest reset history role');
  assert(typeof latestReset?.resetAt === 'string', 'Expected latest reset history timestamp');

  const resetHistoryCsvAdminResponse = await fetch(`${BASE_URL}/api/admin/contract/metrics/resets/export.csv`, {
    headers: adminHeaders,
  });
  assert(resetHistoryCsvAdminResponse.ok, `Expected reset history CSV HTTP 200 for admin, got ${resetHistoryCsvAdminResponse.status}`);
  assert((resetHistoryCsvAdminResponse.headers.get('content-type') || '').includes('text/csv'), 'Expected CSV content-type for reset history export');
  const resetHistoryCsvText = await resetHistoryCsvAdminResponse.text();
  assert(resetHistoryCsvText.includes('id,resetAt,reason,resetByUserId,resetByUserName,resetByRole,beforeTotalCount,beforeEndpointsTouched'), 'Expected CSV header line');
  assert(resetHistoryCsvText.includes('backend-hardening-test'), 'Expected CSV export to include reset reason');

  const contractAfterResetResponse = await fetch(`${BASE_URL}/api/contract`);
  assert(contractAfterResetResponse.ok, `Expected /api/contract after reset HTTP 200, got ${contractAfterResetResponse.status}`);
  const contractAfterResetPayload = await contractAfterResetResponse.json();
  assert(Number(contractAfterResetPayload?.data?.telemetry?.legacyUsage?.totalCount) === 0, 'Expected contract telemetry totalCount = 0 after reset');
  assert(Number(contractAfterResetPayload?.data?.telemetry?.resetHistory?.count) >= 1, 'Expected contract reset history summary count >= 1');
  assert(Number(contractAfterResetPayload?.data?.telemetry?.resetHistory?.ttlDays) >= 1, 'Expected contract reset history summary ttlDays >= 1');

  const persistedAfterResetPayload = JSON.parse(fs.readFileSync(LEGACY_USAGE_METRICS_FILE, 'utf8'));
  assert(Array.isArray(persistedAfterResetPayload?.perEndpoint) && persistedAfterResetPayload.perEndpoint.length === 0, 'Expected persisted perEndpoint empty after reset');
  assert(Array.isArray(persistedAfterResetPayload?.resetHistory) && persistedAfterResetPayload.resetHistory.length >= 1, 'Expected persisted reset history entries');

  const influxFlushResponse = await fetch(`${BASE_URL}/api/admin/ingestion/influx/flush`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ force: true, maxItems: 100 }),
  });
  assert(influxFlushResponse.ok, `Expected influx flush HTTP 200 for admin, got ${influxFlushResponse.status}`);
  const influxFlushPayload = await influxFlushResponse.json();
  assert(influxFlushPayload?.data?.result && typeof influxFlushPayload.data.result.ok === 'boolean', 'Expected influx flush result.ok');

  const journalPage2Response = await fetch(`${BASE_URL}/api/imports/journal?limit=1&offset=1`, { headers });
  assert(journalPage2Response.ok, `Expected journal page2 success, got HTTP ${journalPage2Response.status}`);
  const journalPage2 = await journalPage2Response.json();
  assert(journalPage2 && Array.isArray(journalPage2.data), 'Expected journal page2 data array');
  if (journalPage2.data.length > 0) {
    assert(journalPage1.data[0].id !== journalPage2.data[0].id, 'Expected different entries between offset 0 and offset 1');
  }

  const invalidWindowResponse = await fetch(`${BASE_URL}/api/slo/dashboard?windowHours=foo`, { headers });
  assert(invalidWindowResponse.status === 400, `Expected slo invalid window HTTP 400, got ${invalidWindowResponse.status}`);
  const invalidWindowPayload = await invalidWindowResponse.json();
  assert(invalidWindowPayload.error === 'windowHours_invalid', `Expected windowHours_invalid, got ${invalidWindowPayload.error}`);

  console.log('Backend hardening contract tests passed.');
}

run().catch(error => {
  console.error('Backend hardening contract tests failed:', error.message);
  process.exit(1);
});
