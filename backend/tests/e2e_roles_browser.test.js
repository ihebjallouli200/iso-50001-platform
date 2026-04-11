const { chromium } = require('playwright');

const BASE_URL = process.env.ENMS_BASE_URL || 'http://localhost:4001';

const ROLE_SCENARIOS = [
  {
    role: 'ADMIN_ENERGIE',
    username: 'admin.energie',
    password: 'Admin50001!',
    allowedViews: ['dashboard', 'machine', 'pdca', 'recommendations', 'governance', 'audit', 'dataQuality', 'incidents', 'settings'],
    blockedViews: [],
  },
  {
    role: 'RESPONSABLE_SITE',
    username: 'resp.site',
    password: 'Site50001!',
    allowedViews: ['dashboard', 'machine', 'pdca', 'recommendations', 'governance', 'dataQuality', 'incidents', 'settings'],
    blockedViews: ['audit'],
  },
  {
    role: 'AUDITEUR',
    username: 'auditeur.interne',
    password: 'Audit50001!',
    allowedViews: ['dashboard', 'machine', 'pdca', 'governance', 'audit', 'dataQuality', 'incidents'],
    blockedViews: ['recommendations', 'settings'],
  },
  {
    role: 'OPERATEUR',
    username: 'operateur.l1',
    password: 'Oper50001!',
    allowedViews: ['dashboard', 'machine', 'pdca', 'recommendations', 'dataQuality'],
    blockedViews: ['governance', 'audit', 'incidents', 'settings'],
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function ensureBackendReachable() {
  const response = await fetch(`${BASE_URL}/api/health`);
  assert(response.ok, `Backend unreachable at ${BASE_URL}: HTTP ${response.status}`);
}

async function login(page, username, password) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

  await page.fill('#username', username);
  await page.fill('#password', password);
  await page.click('#loginBtn');

  await page.waitForFunction(() => document.getElementById('loginView').classList.contains('hidden'));
  const sessionInfo = await page.locator('#topUserRole').innerText();
  assert(sessionInfo && !sessionInfo.includes('—'), `Login did not complete for ${username}`);
}

async function verifyViewVisible(page, viewName) {
  const tab = page.locator(`[data-view="${viewName}"]`);
  await tab.waitFor({ state: 'visible', timeout: 10000 });

  let opened = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tab.click();
    try {
      await page.waitForFunction(
        id => {
          const sectionEl = document.getElementById('v_' + id);
          return !!sectionEl && sectionEl.classList.contains('active');
        },
        viewName,
        { timeout: 10000 },
      );
      opened = true;
      break;
    } catch {
      // retry short, UI render can be delayed by async fetches on some views
    }
  }

  assert(opened, `Expected view ${viewName} to become active`);
}

async function verifyViewHidden(page, viewName) {
  const count = await page.locator(`[data-view="${viewName}"]`).count();
  if (count === 0) {
    return;
  }

  const style = await page.locator(`[data-view="${viewName}"]`).evaluate(el => window.getComputedStyle(el).display);
  assert(style === 'none', `Expected hidden tab for ${viewName}, got display=${style}`);
}

async function logout(page) {
  await page.click('#logoutBtn');
  await page.waitForFunction(() => !document.getElementById('loginView').classList.contains('hidden'));
}

async function runScenario(browser, scenario) {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await login(page, scenario.username, scenario.password);

    for (const blockedView of scenario.blockedViews) {
      await verifyViewHidden(page, blockedView);
    }

    for (const allowedView of scenario.allowedViews) {
      await verifyViewVisible(page, allowedView);
    }

    await logout(page);
  } finally {
    await context.close();
  }
}

async function run() {
  await ensureBackendReachable();

  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of ROLE_SCENARIOS) {
      await runScenario(browser, scenario);
      console.log(`E2E role scenario passed: ${scenario.role}`);
    }

    console.log('Browser E2E role-based suite passed.');
  } finally {
    await browser.close();
  }
}

run().catch(error => {
  console.error('Browser E2E role-based suite failed:', error.message);
  process.exit(1);
});
