const fs = require('fs');
const path = require('path');

function readText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
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

function splitClauseNumber(value) {
  const parts = String(value || '').trim().split('.');
  return {
    major: Number(parts[0] || 0),
    minor: Number(parts[1] || 0),
  };
}

function isClauseCoveredByCell(targetClause, clauseCell) {
  const cell = String(clauseCell || '').trim();
  const target = String(targetClause || '').trim();
  if (!cell || !target) {
    return false;
  }

  if (cell === target) {
    return true;
  }

  if (cell.includes('-')) {
    const [startRaw, endRaw] = cell.split('-').map(token => String(token || '').trim());
    if (!startRaw || !endRaw) {
      return false;
    }

    const start = splitClauseNumber(startRaw);
    const end = splitClauseNumber(endRaw);
    const targetNum = splitClauseNumber(target);
    if (!Number.isFinite(start.major) || !Number.isFinite(end.major) || !Number.isFinite(targetNum.major)) {
      return false;
    }

    if (targetNum.major !== start.major || targetNum.major !== end.major) {
      return false;
    }

    return targetNum.minor >= start.minor && targetNum.minor <= end.minor;
  }

  return false;
}

function parseClauseStatus(matrixMarkdown, targetClause) {
  const rows = matrixMarkdown.split('\n').filter(row => row.startsWith('| '));
  for (const row of rows) {
    const cells = row.split('|').map(cell => cell.trim()).filter(Boolean);
    if (cells.length < 2) {
      continue;
    }

    const clauseCell = cells[0];
    if (!isClauseCoveredByCell(targetClause, clauseCell)) {
      continue;
    }

    return cells[cells.length - 1] || null;
  }

  return null;
}

function buildMarkdown(summary) {
  const lines = [];
  lines.push('# ISO50001 Technical Closure Summary');
  lines.push('');
  lines.push(`- Generated at: ${summary.generatedAt}`);
  lines.push(`- Scope: ${summary.scope}`);
  lines.push(`- Acceptance gate: ${summary.acceptanceGate.status}`);
  lines.push(`- Last verified at: ${summary.acceptanceGate.lastVerifiedAt}`);
  lines.push('');
  lines.push('## Target Clauses');
  for (const clause of summary.targetClauses) {
    lines.push(`- ${clause.clause}: ${clause.status}`);
  }
  lines.push('');
  lines.push('## Unified E2E Result');
  lines.push(`- Test ID: ${summary.unifiedE2E.testId}`);
  lines.push(`- Status: ${summary.unifiedE2E.status}`);
  lines.push(`- PDCA final phase: ${summary.unifiedE2E.finalPdcaPhase}`);
  lines.push(`- Governance delta: anomaly=${summary.unifiedE2E.governanceDelta.anomalyDetectedMlModel}, pdca=${summary.unifiedE2E.governanceDelta.pdcaTransition}, enpi=${summary.unifiedE2E.governanceDelta.enpiRecalculated}, coupling=${summary.unifiedE2E.governanceDelta.aiIsoCouplingApplied}`);
  lines.push('');
  lines.push('## Automated Proof Files');
  for (const proof of summary.automatedProofs) {
    lines.push(`- ${proof.id}: ${proof.file}`);
  }
  return lines.join('\n');
}

function run() {
  const root = process.cwd();
  const manifestPath = path.join(root, 'reports', 'iso50001_evidence_manifest.json');
  const matrixPath = path.join(root, 'docs', 'iso50001_exigence_preuve_matrice.md');
  const unifiedPath = path.join(root, 'reports', 'iso50001_unified_e2e_result.json');

  const manifest = readJson(manifestPath);
  const unified = readJson(unifiedPath);
  const matrix = readText(matrixPath);

  const targetClauses = (manifest.targetClauses || []).map(clause => ({
    clause,
    status: parseClauseStatus(matrix, clause) || 'Unknown',
  }));

  const summary = {
    generatedAt: new Date().toISOString(),
    summaryVersion: '1.0.0',
    scope: manifest.scope || 'unknown',
    acceptanceGate: {
      status: manifest.acceptanceGate?.status || 'unknown',
      lastVerifiedAt: manifest.acceptanceGate?.lastVerifiedAt || null,
      requiredSmokeEntryPoint: manifest.acceptanceGate?.requiredSmokeEntryPoint || null,
    },
    targetClauses,
    automatedProofs: manifest.automatedProofs || [],
    evidenceArtifacts: manifest.evidenceArtifacts || [],
    unifiedE2E: {
      testId: unified.testId || null,
      status: unified.status || 'unknown',
      finalPdcaPhase: unified.artifacts?.finalPdcaPhase || null,
      governanceDelta: {
        anomalyDetectedMlModel: Number(unified.governanceEvidence?.delta?.anomalyDetectedMlModel || 0),
        pdcaTransition: Number(unified.governanceEvidence?.delta?.pdcaTransition || 0),
        enpiRecalculated: Number(unified.governanceEvidence?.delta?.enpiRecalculated || 0),
        aiIsoCouplingApplied: Number(unified.governanceEvidence?.delta?.aiIsoCouplingApplied || 0),
      },
    },
  };

  const jsonOut = path.join(root, 'reports', 'iso50001_closure_summary.json');
  const mdOut = path.join(root, 'reports', 'iso50001_closure_summary.md');

  fs.writeFileSync(jsonOut, JSON.stringify(summary, null, 2), 'utf8');
  fs.writeFileSync(mdOut, buildMarkdown(summary), 'utf8');

  console.log('ISO50001 closure summary generated.');
}

try {
  run();
} catch (error) {
  console.error('ISO50001 closure summary generation failed:', error.message);
  process.exit(1);
}
