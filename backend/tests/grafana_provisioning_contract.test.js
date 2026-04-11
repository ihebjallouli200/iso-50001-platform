const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  assert(fs.existsSync(filePath), `Expected file to exist: ${filePath}`);
  return fs.readFileSync(filePath, 'utf8');
}

function run() {
  const root = process.cwd();

  const composePath = path.join(root, 'docker-compose.yml');
  const compose = read(composePath);
  assert(compose.includes('grafana:'), 'Expected docker-compose.yml to define grafana service');
  assert(compose.includes('3000:3000'), 'Expected grafana service port mapping 3000:3000');
  assert(compose.includes('/etc/grafana/provisioning/datasources'), 'Expected datasource provisioning mount');
  assert(compose.includes('/etc/grafana/provisioning/dashboards'), 'Expected dashboard provisioning mount');
  assert(compose.includes('/var/lib/grafana/dashboards'), 'Expected dashboard content mount');

  const datasourcePath = path.join(root, 'configs', 'grafana', 'provisioning', 'datasources', 'datasources.yml');
  const datasource = read(datasourcePath);
  assert(datasource.includes('ENMS-Timescale'), 'Expected ENMS-Timescale datasource definition');
  assert(datasource.includes('ENMS-Influx'), 'Expected ENMS-Influx datasource definition');

  const providersPath = path.join(root, 'configs', 'grafana', 'provisioning', 'dashboards', 'dashboards.yml');
  const providers = read(providersPath);
  assert(providers.includes('/var/lib/grafana/dashboards'), 'Expected dashboard provider path');

  const dashboardPath = path.join(root, 'configs', 'grafana', 'dashboards', 'iso50001_operational_runtime.json');
  const dashboardRaw = read(dashboardPath);
  let dashboard = null;
  try {
    dashboard = JSON.parse(dashboardRaw);
  } catch (error) {
    throw new Error(`Dashboard JSON parse failed: ${error.message}`);
  }

  assert(Array.isArray(dashboard.panels), 'Expected dashboard.panels array');
  assert(dashboard.panels.length >= 5, `Expected at least 5 panels, got ${dashboard.panels.length}`);

  const titles = dashboard.panels.map(panel => String(panel.title || ''));
  const requiredTitles = [
    'EnPI realtime vs EnB',
    'PDCA current status',
    'Anomalies + AI score',
    'Forecast vs actual',
    'EnPI drift alert (24h)',
  ];

  for (const title of requiredTitles) {
    assert(titles.includes(title), `Expected dashboard panel title: ${title}`);
  }

  console.log('Grafana provisioning contract test passed.');
}

try {
  run();
} catch (error) {
  console.error('Grafana provisioning contract test failed:', error.message);
  process.exit(1);
}
