const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(filePath) {
  assert(fs.existsSync(filePath), `Expected file to exist: ${filePath}`);
  const raw = fs.readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON at ${filePath}: ${error.message}`);
  }
}

function run() {
  const root = process.cwd();
  const filePath = path.join(root, 'reports', 'iso50001_machine_verifiable_evidence_manifest.json');
  const manifest = readJson(filePath);

  assert(manifest.manifestType === 'machine_verifiable_evidence', `Expected manifestType=machine_verifiable_evidence, got ${manifest.manifestType}`);
  assert(manifest.manifestVersion === '1.0.0', `Expected manifestVersion=1.0.0, got ${manifest.manifestVersion}`);

  const tests = Array.isArray(manifest.tests) ? manifest.tests : [];
  assert(tests.length >= 4, `Expected at least 4 tests in machine-verifiable manifest, got ${tests.length}`);
  for (const test of tests) {
    assert(typeof test.id === 'string' && test.id.length > 0, 'Expected test.id');
    assert(typeof test.file === 'string' && test.file.length > 0, 'Expected test.file');
    assert(typeof test.verification?.command === 'string' && test.verification.command.startsWith('node '), 'Expected node verification command');
  }

  const apiChecks = Array.isArray(manifest.apiChecks) ? manifest.apiChecks : [];
  assert(apiChecks.length >= 4, `Expected at least 4 apiChecks, got ${apiChecks.length}`);
  for (const check of apiChecks) {
    assert(typeof check.endpoint === 'string' && check.endpoint.includes('/api/'), 'Expected apiChecks endpoint');
    assert(Array.isArray(check.expectedContract) && check.expectedContract.length > 0, 'Expected apiChecks expectedContract');
  }

  const governanceQueries = Array.isArray(manifest.governanceQueries) ? manifest.governanceQueries : [];
  assert(governanceQueries.length >= 4, `Expected at least 4 governance queries, got ${governanceQueries.length}`);
  for (const query of governanceQueries) {
    assert(typeof query.query === 'string' && query.query.startsWith('/api/governance/events?type='), 'Expected governance query format');
    assert(Number(query.observedDelta) >= Number(query.expectedDeltaMin), `Expected observedDelta >= expectedDeltaMin for ${query.id}`);
  }

  const definitions = manifest.dashboardDefinitions || {};
  assert(typeof definitions.file === 'string' && definitions.file.endsWith('.json'), 'Expected dashboardDefinitions.file');
  assert(Number(definitions.panelCount) >= 5, `Expected dashboard panel count >= 5, got ${definitions.panelCount}`);
  const requiredPanels = Array.isArray(definitions.requiredPanels) ? definitions.requiredPanels : [];
  const actualPanelTitles = new Set((definitions.panels || []).map(panel => String(panel.title || '')));
  for (const title of requiredPanels) {
    assert(actualPanelTitles.has(title), `Expected dashboard panel title in definitions: ${title}`);
  }

  assert(manifest.acceptanceGate?.status === 'passed', `Expected acceptanceGate.status=passed, got ${manifest.acceptanceGate?.status}`);
  assert(manifest.traceability?.unifiedE2E?.status === 'passed', `Expected traceability unified status passed, got ${manifest.traceability?.unifiedE2E?.status}`);

  console.log('ISO50001 machine-verifiable evidence manifest contract test passed.');
}

try {
  run();
} catch (error) {
  console.error('ISO50001 machine-verifiable evidence manifest contract test failed:', error.message);
  process.exit(1);
}
