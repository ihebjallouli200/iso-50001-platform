const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readText(filePath) {
  assert(fs.existsSync(filePath), `Expected file to exist: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath) {
  const raw = readText(filePath);
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON at ${filePath}: ${error.message}`);
  }
}

function run() {
  const root = process.cwd();
  const matrixPath = path.join(root, 'docs', 'iso50001_exigence_preuve_matrice.md');
  const manifestPath = path.join(root, 'reports', 'iso50001_evidence_manifest.json');
  const unifiedResultPath = path.join(root, 'reports', 'iso50001_unified_e2e_result.json');

  const matrix = readText(matrixPath);
  const manifest = readJson(manifestPath);
  const unified = readJson(unifiedResultPath);

  const expectedTargetClauses = ['6.4', '6.5', '7.5', '8.1', '9.1', '10.2'];
  assert(Array.isArray(manifest.targetClauses), 'Expected manifest.targetClauses array');
  for (const clause of expectedTargetClauses) {
    assert(manifest.targetClauses.includes(clause), `Expected manifest target clause ${clause}`);
  }

  const proofFiles = new Set((manifest.automatedProofs || []).map(item => String(item.file || '')));
  const requiredProofFiles = [
    'backend/tests/iso_runtime_http.test.js',
    'backend/tests/ai_iso_coupling_http.test.js',
    'backend/tests/grafana_provisioning_contract.test.js',
    'backend/tests/iso50001_unified_e2e.test.js',
  ];
  for (const file of requiredProofFiles) {
    assert(proofFiles.has(file), `Expected automated proof in manifest: ${file}`);
  }

  assert(manifest.acceptanceGate?.status === 'passed', `Expected acceptanceGate.status=passed, got ${manifest.acceptanceGate?.status}`);
  assert(typeof manifest.acceptanceGate?.lastVerifiedAt === 'string', 'Expected acceptanceGate.lastVerifiedAt string');
  assert(manifest.acceptanceGate?.requiredSmokeEntryPoint === 'backend/tests/smoke_http_e2e_runner.js', 'Expected smoke entrypoint in manifest');

  assert(unified.status === 'passed', `Expected unified E2E status=passed, got ${unified.status}`);
  assert(unified.assertions?.governanceDeltaThresholdsPassed === true, 'Expected governance delta thresholds assertion true');

  const delta = unified.governanceEvidence?.delta || {};
  assert(Number(delta.anomalyDetectedMlModel) >= 1, `Expected anomalyDetectedMlModel delta >= 1, got ${delta.anomalyDetectedMlModel}`);
  assert(Number(delta.pdcaTransition) >= 2, `Expected pdcaTransition delta >= 2, got ${delta.pdcaTransition}`);
  assert(Number(delta.enpiRecalculated) >= 2, `Expected enpiRecalculated delta >= 2, got ${delta.enpiRecalculated}`);
  assert(Number(delta.aiIsoCouplingApplied) >= 2, `Expected aiIsoCouplingApplied delta >= 2, got ${delta.aiIsoCouplingApplied}`);

  const expectedCoveredLines = [
    '| 6.4 | EnPI |',
    '| 6.5 | Baseline (EnB) |',
    '| 7.5 | Information documentée |',
    '| 8.1 | Maîtrise opérationnelle |',
    '| 9.1 | Suivi/mesure/analyse |',
    '| 10.1-10.2 | NC, actions correctives, amélioration |',
  ];
  for (const linePrefix of expectedCoveredLines) {
    const line = matrix.split('\n').find(row => row.startsWith(linePrefix));
    assert(line, `Expected matrix row starting with: ${linePrefix}`);
    assert(line.includes('| Couvert |'), `Expected Couvert status for matrix row: ${linePrefix}`);
  }

  console.log('ISO50001 compliance manifest contract test passed.');
}

try {
  run();
} catch (error) {
  console.error('ISO50001 compliance manifest contract test failed:', error.message);
  process.exit(1);
}
