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
  const summaryPath = path.join(root, 'reports', 'iso50001_closure_summary.json');
  const summaryMdPath = path.join(root, 'reports', 'iso50001_closure_summary.md');
  const manifestPath = path.join(root, 'reports', 'iso50001_evidence_manifest.json');
  const unifiedPath = path.join(root, 'reports', 'iso50001_unified_e2e_result.json');

  const summary = readJson(summaryPath);
  const summaryMd = readText(summaryMdPath);
  const manifest = readJson(manifestPath);
  const unified = readJson(unifiedPath);

  assert(summary.summaryVersion === '1.0.0', `Expected summaryVersion=1.0.0, got ${summary.summaryVersion}`);
  assert(summary.acceptanceGate?.status === 'passed', `Expected summary acceptance status passed, got ${summary.acceptanceGate?.status}`);
  assert(summary.unifiedE2E?.status === 'passed', `Expected summary unified status passed, got ${summary.unifiedE2E?.status}`);

  const expectedClauses = ['6.4', '6.5', '7.5', '8.1', '9.1', '10.2'];
  const summaryClauseMap = new Map((summary.targetClauses || []).map(item => [String(item.clause), String(item.status)]));
  for (const clause of expectedClauses) {
    assert(summaryClauseMap.has(clause), `Expected clause ${clause} in closure summary`);
    assert(summaryClauseMap.get(clause) === 'Couvert', `Expected clause ${clause} status Couvert in summary`);
  }

  const manifestProofCount = Array.isArray(manifest.automatedProofs) ? manifest.automatedProofs.length : 0;
  assert((summary.automatedProofs || []).length === manifestProofCount, 'Expected summary automatedProofs to match manifest');

  const delta = summary.unifiedE2E?.governanceDelta || {};
  assert(Number(delta.anomalyDetectedMlModel) >= 1, `Expected anomaly delta >= 1, got ${delta.anomalyDetectedMlModel}`);
  assert(Number(delta.pdcaTransition) >= 2, `Expected pdca delta >= 2, got ${delta.pdcaTransition}`);
  assert(Number(delta.enpiRecalculated) >= 2, `Expected enpi delta >= 2, got ${delta.enpiRecalculated}`);
  assert(Number(delta.aiIsoCouplingApplied) >= 2, `Expected coupling delta >= 2, got ${delta.aiIsoCouplingApplied}`);

  assert(summary.unifiedE2E.testId === unified.testId, 'Expected summary unified testId to match unified report');
  assert(summary.acceptanceGate.lastVerifiedAt === manifest.acceptanceGate.lastVerifiedAt, 'Expected summary lastVerifiedAt to match manifest');

  assert(summaryMd.includes('ISO50001 Technical Closure Summary'), 'Expected summary markdown header');
  assert(summaryMd.includes('Acceptance gate: passed'), 'Expected summary markdown acceptance gate line');

  console.log('ISO50001 closure report contract test passed.');
}

try {
  run();
} catch (error) {
  console.error('ISO50001 closure report contract test failed:', error.message);
  process.exit(1);
}
