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

function run() {
  const root = process.cwd();
  const baseManifestPath = path.join(root, 'reports', 'iso50001_evidence_manifest.json');
  const unifiedPath = path.join(root, 'reports', 'iso50001_unified_e2e_result.json');
  const dashboardPath = path.join(root, 'configs', 'grafana', 'dashboards', 'iso50001_operational_runtime.json');

  const baseManifest = readJson(baseManifestPath);
  const unified = readJson(unifiedPath);
  const dashboard = readJson(dashboardPath);

  const dashboardPanels = Array.isArray(dashboard.panels) ? dashboard.panels : [];

  const manifest = {
    generatedAt: new Date().toISOString(),
    manifestType: 'machine_verifiable_evidence',
    manifestVersion: '1.0.0',
    scope: baseManifest.scope,
    targetClauses: baseManifest.targetClauses,
    acceptanceGate: {
      status: baseManifest.acceptanceGate?.status || 'unknown',
      requiredSmokeEntryPoint: baseManifest.acceptanceGate?.requiredSmokeEntryPoint || null,
      lastVerifiedAt: baseManifest.acceptanceGate?.lastVerifiedAt || null,
    },
    tests: (baseManifest.automatedProofs || []).map(test => ({
      id: test.id,
      file: test.file,
      covers: test.covers,
      description: test.description,
      verification: {
        type: 'node_test',
        command: `node ${test.file}`,
      },
    })),
    apiChecks: [
      {
        id: 'API-ENPI-CURRENT',
        endpoint: 'GET /api/enpi/current?machineId=1&windowHours=24',
        expectedContract: ['data.enpiValue:number', 'data.enpiNormalized:number', 'data.status:string', 'meta.contractVersion:string'],
        coveredByTests: ['TEST-ISO-RUNTIME', 'TEST-ISO-UNIFIED-E2E'],
      },
      {
        id: 'API-ENB-BASELINE',
        endpoint: 'GET /api/enb/baseline?machineId=1&referenceWindowHours=24',
        expectedContract: ['data.baselineEnpi:number', 'data.sampleSize:number', 'meta.contractVersion:string'],
        coveredByTests: ['TEST-ISO-RUNTIME', 'TEST-ISO-UNIFIED-E2E'],
      },
      {
        id: 'API-PDCA-TRANSITION',
        endpoint: 'POST /api/pdca/transition',
        expectedContract: ['data.success:boolean', 'data.cycle.id:number', 'data.transition.fromPhase:string', 'data.transition.toPhase:string'],
        coveredByTests: ['TEST-ISO-RUNTIME', 'TEST-AI-ISO-COUPLING', 'TEST-ISO-UNIFIED-E2E'],
      },
      {
        id: 'API-INFERENCE-ANOMALY',
        endpoint: 'POST /api/inference/anomaly',
        expectedContract: ['data.inference.predicted:boolean', 'data.createdAnomaly.id:number', 'data.createdRecommendation.id:number', 'data.coupling.applied:boolean'],
        coveredByTests: ['TEST-AI-ISO-COUPLING', 'TEST-ISO-UNIFIED-E2E'],
      },
    ],
    governanceQueries: [
      {
        id: 'GOV-ANOMALY-DETECTED',
        query: '/api/governance/events?type=anomalyDetected_ml_model&limit=200',
        expectedDeltaMin: 1,
        observedDelta: Number(unified.governanceEvidence?.delta?.anomalyDetectedMlModel || 0),
      },
      {
        id: 'GOV-PDCA-TRANSITION',
        query: '/api/governance/events?type=pdcaTransition&limit=200',
        expectedDeltaMin: 2,
        observedDelta: Number(unified.governanceEvidence?.delta?.pdcaTransition || 0),
      },
      {
        id: 'GOV-ENPI-RECALCULATED',
        query: '/api/governance/events?type=enpiRecalculated&limit=200',
        expectedDeltaMin: 2,
        observedDelta: Number(unified.governanceEvidence?.delta?.enpiRecalculated || 0),
      },
      {
        id: 'GOV-AI-ISO-COUPLING',
        query: '/api/governance/events?type=aiIsoCouplingApplied&limit=200',
        expectedDeltaMin: 2,
        observedDelta: Number(unified.governanceEvidence?.delta?.aiIsoCouplingApplied || 0),
      },
    ],
    dashboardDefinitions: {
      file: 'configs/grafana/dashboards/iso50001_operational_runtime.json',
      dashboardUid: dashboard.uid || null,
      dashboardTitle: dashboard.title || null,
      panelCount: dashboardPanels.length,
      requiredPanels: [
        'EnPI realtime vs EnB',
        'PDCA current status',
        'Anomalies + AI score',
        'Forecast vs actual',
        'EnPI drift alert (24h)',
      ],
      panels: dashboardPanels.map(panel => ({
        id: panel.id,
        title: panel.title,
        type: panel.type,
        datasourceUid: panel.datasource?.uid || null,
      })),
    },
    traceability: {
      evidenceArtifacts: baseManifest.evidenceArtifacts || [],
      unifiedE2E: {
        file: 'reports/iso50001_unified_e2e_result.json',
        testId: unified.testId || null,
        status: unified.status || 'unknown',
        generatedAt: unified.generatedAt || null,
      },
    },
  };

  const outputPath = path.join(root, 'reports', 'iso50001_machine_verifiable_evidence_manifest.json');
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');

  console.log('ISO50001 machine-verifiable evidence manifest generated.');
}

try {
  run();
} catch (error) {
  console.error('ISO50001 machine-verifiable evidence manifest generation failed:', error.message);
  process.exit(1);
}
