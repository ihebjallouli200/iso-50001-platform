const { spawn } = require('child_process');

const BASE_URL = process.env.ENMS_BASE_URL || 'http://localhost:4001';
const NODE_BIN = process.execPath;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function checkBackendHealth() {
  let response;
  try {
    response = await fetch(`${BASE_URL}/api/health`);
  } catch (error) {
    throw new Error(`Backend inaccessible sur ${BASE_URL} (${error.message})`);
  }

  assert(response.ok, `Backend non prêt sur ${BASE_URL}: HTTP ${response.status}`);
}

function runNodeScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE_BIN, [scriptPath], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Échec ${scriptPath} (exit=${code})`));
    });
  });
}

async function run() {
  await checkBackendHealth();

  console.log('\n[SMOKE] 1/15 Contrats backend hardening...');
  await runNodeScript('backend/tests/backend_hardening_contracts_http.test.js');

  console.log('\n[SMOKE] 2/15 Contrats pagination backend...');
  await runNodeScript('backend/tests/backend_pagination_contracts_http.test.js');

  console.log('\n[SMOKE] 3/15 Inference anomaly contract + RBAC...');
  await runNodeScript('backend/tests/anomaly_inference_http.test.js');

  console.log('\n[SMOKE] 4/15 ISO runtime EnPI/EnB + PDCA transition...');
  await runNodeScript('backend/tests/iso_runtime_http.test.js');

  console.log('\n[SMOKE] 5/15 AI->ISO coupling contract...');
  await runNodeScript('backend/tests/ai_iso_coupling_http.test.js');

  console.log('\n[SMOKE] 6/15 Grafana provisioning contract...');
  await runNodeScript('backend/tests/grafana_provisioning_contract.test.js');

  console.log('\n[SMOKE] 7/15 Unified ISO 50001 E2E chain...');
  await runNodeScript('backend/tests/iso50001_unified_e2e.test.js');

  console.log('\n[SMOKE] 8/15 HTTP critique...');
  await runNodeScript('backend/tests/fe_critical_paths_http.test.js');

  console.log('\n[SMOKE] 9/15 E2E ingestion...');
  await runNodeScript('backend/tests/ingestion_http_e2e.test.js');

  console.log('\n[SMOKE] 10/15 E2E navigateur...');
  await runNodeScript('backend/tests/e2e_roles_browser.test.js');

  console.log('\n[SMOKE] 11/15 ISO50001 compliance manifest contract...');
  await runNodeScript('backend/tests/iso50001_compliance_manifest_contract.test.js');

  console.log('\n[SMOKE] 12/15 ISO50001 closure summary generation...');
  await runNodeScript('scripts/generate_iso50001_closure_report.js');

  console.log('\n[SMOKE] 13/15 ISO50001 closure report contract...');
  await runNodeScript('backend/tests/iso50001_closure_report_contract.test.js');

  console.log('\n[SMOKE] 14/15 Machine-verifiable evidence manifest generation...');
  await runNodeScript('scripts/generate_machine_verifiable_evidence_manifest.js');

  console.log('\n[SMOKE] 15/15 Machine-verifiable evidence manifest contract...');
  await runNodeScript('backend/tests/iso50001_machine_verifiable_evidence_manifest_contract.test.js');

  console.log('\n[SMOKE] Suite backend + HTTP + E2E OK.');
}

run().catch(error => {
  console.error('\\n[SMOKE] Échec:', error.message);
  process.exit(1);
});
