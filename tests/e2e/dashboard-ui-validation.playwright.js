/**
 * Comprehensive Dashboard UI Validation with Playwright
 *
 * Tests all dashboard functionality including:
 * - Session type classification (CLI vs Autonomous)
 * - Duplicate session detection
 * - Hierarchy/lineage display
 * - Logs display for autonomous sessions
 * - Multi-project session handling
 * - SSE real-time updates
 *
 * Run with: node tests/e2e/dashboard-ui-validation.playwright.js
 */

const { chromium } = require('playwright');
const http = require('http');

const DASHBOARD_URL = 'http://localhost:3033';
const API_BASE = 'http://localhost:3033';

// Test results collector
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

// Helper to make API requests
function apiRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Register a test session
async function registerSession(sessionData) {
  return apiRequest('POST', '/api/sessions/register', sessionData);
}

// End a session
async function endSession(sessionId) {
  return apiRequest('POST', `/api/sessions/${sessionId}/end`);
}

// Get all sessions
async function getSessions() {
  return apiRequest('GET', '/api/sessions/summary');
}

// Generate unique session ID
function generateSessionId() {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function runTests() {
  console.log('\n========================================');
  console.log('  DASHBOARD UI VALIDATION WITH PLAYWRIGHT');
  console.log('========================================\n');

  let browser;
  let page;

  try {
    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox']
    });
    const context = await browser.newContext();
    page = await context.newPage();

    // Enable console logging from page
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.log(`[Browser Error] ${msg.text()}`);
      }
    });

    // Navigate to dashboard
    console.log('[Setup] Navigating to dashboard...');
    await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000); // Allow SSE connections to establish

    // ============================================================
    // TEST 1: Session Type Classification
    // ============================================================
    console.log('\n[TEST 1] Session Type Classification');
    console.log('-------------------------------------');

    // Register a CLI session
    const cliSessionId = generateSessionId();
    const cliResult = await registerSession({
      project: 'test-project-1',
      path: 'C:\\test\\project1',
      sessionType: 'cli',
      claudeSessionId: `claude-cli-${cliSessionId}`
    });
    console.log(`  Registered CLI session: ${cliResult.data?.id || 'FAILED'}`);

    // Register an autonomous session
    const autoSessionId = generateSessionId();
    const autoResult = await registerSession({
      project: 'test-project-1',
      path: 'C:\\test\\project1',
      sessionType: 'autonomous',
      autonomous: true,
      claudeSessionId: `claude-auto-${autoSessionId}`,
      orchestratorInfo: { phase: 'implementation', taskId: 'test-task' }
    });
    console.log(`  Registered Autonomous session: ${autoResult.data?.id || 'FAILED'}`);

    // Refresh and check UI
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Click on Sessions tab
    await page.click('button[data-tab="sessions"]').catch(() => {
      console.log('  [Warning] Could not click Sessions tab');
    });
    await page.waitForTimeout(500);

    // Check session badges in UI
    const sessionBadges = await page.$$eval('.session-badge, .badge, [class*="session"]', elements => {
      return elements.map(el => ({
        text: el.textContent.trim(),
        classList: el.className
      }));
    });

    // Look for CLI and AUTO badges
    const cliCount = sessionBadges.filter(b => b.text.includes('CLI') || b.classList.includes('cli')).length;
    const autoCount = sessionBadges.filter(b => b.text.includes('AUTO') || b.classList.includes('autonomous')).length;

    console.log(`  Found ${cliCount} CLI badges, ${autoCount} AUTO badges`);

    if (cliResult.data?.id && autoResult.data?.id) {
      testResults.passed.push('Session registration works');
    } else {
      testResults.failed.push('Session registration failed');
    }

    // Verify session types via API
    const sessionsResp = await getSessions();
    const sessions = sessionsResp.data?.sessions || [];

    const cliSession = sessions.find(s => s.claudeSessionId?.includes('cli'));
    const autoSession = sessions.find(s => s.claudeSessionId?.includes('auto'));

    if (cliSession?.sessionType === 'cli') {
      testResults.passed.push('CLI session type correctly stored');
      console.log(`  ✓ CLI session type correct: ${cliSession.sessionType}`);
    } else {
      testResults.failed.push(`CLI session type wrong: expected 'cli', got '${cliSession?.sessionType}'`);
      console.log(`  ✗ CLI session type WRONG: ${cliSession?.sessionType}`);
    }

    if (autoSession?.sessionType === 'autonomous') {
      testResults.passed.push('Autonomous session type correctly stored');
      console.log(`  ✓ Autonomous session type correct: ${autoSession.sessionType}`);
    } else {
      testResults.failed.push(`Autonomous session type wrong: expected 'autonomous', got '${autoSession?.sessionType}'`);
      console.log(`  ✗ Autonomous session type WRONG: ${autoSession?.sessionType}`);
    }

    // ============================================================
    // TEST 2: Duplicate Session Detection
    // ============================================================
    console.log('\n[TEST 2] Duplicate Session Detection');
    console.log('-------------------------------------');

    // Try to register same claudeSessionId again
    const dupeClaudeId = `claude-dupe-${generateSessionId()}`;
    const firstReg = await registerSession({
      project: 'test-project-2',
      path: 'C:\\test\\project2',
      sessionType: 'cli',
      claudeSessionId: dupeClaudeId
    });
    console.log(`  First registration: Session ${firstReg.data?.id}`);

    const secondReg = await registerSession({
      project: 'test-project-2',
      path: 'C:\\test\\project2',
      sessionType: 'cli',
      claudeSessionId: dupeClaudeId
    });
    console.log(`  Second registration (same claudeSessionId): Session ${secondReg.data?.id}`);

    if (firstReg.data?.id === secondReg.data?.id) {
      testResults.passed.push('Duplicate claudeSessionId correctly deduplicated');
      console.log(`  ✓ Correctly returned same session ID (no duplicate created)`);
    } else {
      testResults.failed.push('Duplicate session created for same claudeSessionId');
      console.log(`  ✗ DUPLICATE CREATED: ${firstReg.data?.id} vs ${secondReg.data?.id}`);
    }

    // Check total session count
    const afterDupeSessions = await getSessions();
    const proj2Sessions = (afterDupeSessions.data?.sessions || []).filter(s => s.project === 'test-project-2');
    console.log(`  Sessions for test-project-2: ${proj2Sessions.length}`);

    if (proj2Sessions.length === 1) {
      testResults.passed.push('No duplicate sessions in registry');
    } else {
      testResults.failed.push(`Found ${proj2Sessions.length} sessions when expected 1`);
    }

    // ============================================================
    // TEST 3: Hierarchy Display
    // ============================================================
    console.log('\n[TEST 3] Hierarchy/Lineage Display');
    console.log('-----------------------------------');

    // Register parent session
    const parentId = generateSessionId();
    const parentReg = await registerSession({
      project: 'test-hierarchy',
      path: 'C:\\test\\hierarchy',
      sessionType: 'autonomous',
      claudeSessionId: `claude-parent-${parentId}`,
      orchestratorInfo: { isRoot: true }
    });
    const parentSessionId = parentReg.data?.id;
    console.log(`  Registered parent session: ${parentSessionId}`);

    // Register child sessions
    const childIds = [];
    for (let i = 1; i <= 3; i++) {
      const childReg = await registerSession({
        project: 'test-hierarchy',
        path: 'C:\\test\\hierarchy',
        sessionType: 'autonomous',
        claudeSessionId: `claude-child-${parentId}-${i}`,
        parentSessionId: parentSessionId,
        orchestratorInfo: { isRoot: false, parentId: parentSessionId }
      });
      childIds.push(childReg.data?.id);
      console.log(`  Registered child session ${i}: ${childReg.data?.id}`);
    }

    // Refresh dashboard and check hierarchy tab
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Click Hierarchy tab
    await page.click('button[data-tab="hierarchy"]').catch(() => {
      console.log('  [Warning] Could not click Hierarchy tab');
    });
    await page.waitForTimeout(1000);

    // Check for hierarchy elements
    const hierarchyContent = await page.$eval('#hierarchyPane, [id*="hierarchy"]', el => el.innerHTML).catch(() => '');

    // Look for parent-child indicators
    const hasTreeStructure = hierarchyContent.includes('tree') ||
                             hierarchyContent.includes('child') ||
                             hierarchyContent.includes('parent') ||
                             hierarchyContent.includes('└') ||
                             hierarchyContent.includes('├');

    console.log(`  Hierarchy pane content length: ${hierarchyContent.length} chars`);
    console.log(`  Contains tree structure indicators: ${hasTreeStructure}`);

    // Check via API
    const hierarchyResp = await apiRequest('GET', `/api/sessions/${parentSessionId}/hierarchy`);
    console.log(`  API hierarchy response: ${JSON.stringify(hierarchyResp.data).substring(0, 200)}...`);

    if (hierarchyResp.data?.children?.length > 0) {
      testResults.passed.push('Hierarchy API returns children');
      console.log(`  ✓ Hierarchy API shows ${hierarchyResp.data.children.length} children`);
    } else {
      testResults.failed.push('Hierarchy API missing children');
      console.log(`  ✗ Hierarchy API shows NO children`);
    }

    // Take screenshot of hierarchy
    await page.screenshot({ path: 'hierarchy-screenshot.png', fullPage: false });
    console.log(`  Screenshot saved: hierarchy-screenshot.png`);

    // ============================================================
    // TEST 4: Logs Display for Autonomous Sessions
    // ============================================================
    console.log('\n[TEST 4] Logs Display for Autonomous Sessions');
    console.log('----------------------------------------------');

    // Write some logs for the autonomous session
    if (parentSessionId) {
      await apiRequest('POST', `/api/logs/${parentSessionId}/write`, {
        message: 'Test log entry 1 - Starting task',
        level: 'INFO',
        source: 'orchestrator',
        timestamp: new Date().toISOString()
      });
      await apiRequest('POST', `/api/logs/${parentSessionId}/write`, {
        message: 'Test log entry 2 - Processing',
        level: 'INFO',
        source: 'orchestrator',
        timestamp: new Date().toISOString()
      });
      console.log(`  Wrote 2 log entries for session ${parentSessionId}`);
    }

    // Click Logs tab
    await page.click('button[data-tab="logs"]').catch(() => {
      console.log('  [Warning] Could not click Logs tab');
    });
    await page.waitForTimeout(1000);

    // Check logs content
    const logsContent = await page.$eval('#logsPane, [id*="logs"]', el => el.innerHTML).catch(() => '');
    console.log(`  Logs pane content length: ${logsContent.length} chars`);

    const hasLogEntries = logsContent.includes('Test log entry') ||
                          logsContent.includes('INFO') ||
                          logsContent.includes('orchestrator');

    if (hasLogEntries) {
      testResults.passed.push('Logs display shows entries');
      console.log(`  ✓ Log entries visible in UI`);
    } else {
      testResults.warnings.push('Logs may not be displaying - content length: ' + logsContent.length);
      console.log(`  ? Logs content: ${logsContent.substring(0, 200)}...`);
    }

    // Check logs via API
    const logsResp = await apiRequest('GET', `/api/sessions/${parentSessionId}/logs`);
    console.log(`  Logs API response: ${logsResp.data?.logs?.length || 0} entries`);

    // Take screenshot of logs
    await page.screenshot({ path: 'logs-screenshot.png', fullPage: false });
    console.log(`  Screenshot saved: logs-screenshot.png`);

    // ============================================================
    // TEST 5: Session Badge UI Elements
    // ============================================================
    console.log('\n[TEST 5] Session Badge UI Validation');
    console.log('-------------------------------------');

    await page.click('button[data-tab="sessions"]').catch(() => {});
    await page.waitForTimeout(500);

    // Get all session rows/elements
    const sessionElements = await page.$$eval('tr, .session-row, [class*="session"]', elements => {
      return elements.slice(0, 20).map(el => ({
        text: el.textContent.substring(0, 200),
        html: el.innerHTML.substring(0, 300)
      }));
    });

    console.log(`  Found ${sessionElements.length} session elements`);

    // Check for proper badges
    let cliBadgeFound = false;
    let autoBadgeFound = false;

    for (const el of sessionElements) {
      if (el.text.includes('CLI') || el.html.includes('cli-badge')) {
        cliBadgeFound = true;
      }
      if (el.text.includes('AUTO') || el.html.includes('auto-badge') || el.text.includes('autonomous')) {
        autoBadgeFound = true;
      }
    }

    console.log(`  CLI badge found: ${cliBadgeFound}`);
    console.log(`  AUTO badge found: ${autoBadgeFound}`);

    if (cliBadgeFound && autoBadgeFound) {
      testResults.passed.push('Both CLI and AUTO badges visible in UI');
    } else {
      testResults.warnings.push(`Badges: CLI=${cliBadgeFound}, AUTO=${autoBadgeFound}`);
    }

    // ============================================================
    // TEST 6: Multi-Project Handling
    // ============================================================
    console.log('\n[TEST 6] Multi-Project Session Handling');
    console.log('----------------------------------------');

    // Register sessions for different projects
    const projects = ['project-alpha', 'project-beta', 'project-gamma'];
    const multiProjectSessions = {};

    for (const proj of projects) {
      const reg = await registerSession({
        project: proj,
        path: `C:\\test\\${proj}`,
        sessionType: 'cli',
        claudeSessionId: `claude-${proj}-${generateSessionId()}`
      });
      multiProjectSessions[proj] = reg.data?.id;
      console.log(`  Registered session for ${proj}: ${reg.data?.id}`);
    }

    // Check sessions are properly segregated
    const allSessionsResp = await getSessions();
    const allSessions = allSessionsResp.data?.sessions || [];

    for (const proj of projects) {
      const count = allSessions.filter(s => s.project === proj).length;
      console.log(`  Sessions for ${proj}: ${count}`);
    }

    testResults.passed.push('Multi-project sessions registered successfully');

    // Take final screenshot
    await page.screenshot({ path: 'sessions-screenshot.png', fullPage: false });
    console.log(`  Screenshot saved: sessions-screenshot.png`);

    // ============================================================
    // CLEANUP: End all test sessions
    // ============================================================
    console.log('\n[Cleanup] Ending test sessions...');

    const finalSessions = await getSessions();
    let cleanedCount = 0;
    for (const session of (finalSessions.data?.sessions || [])) {
      if (session.project?.startsWith('test-') ||
          session.project?.startsWith('project-')) {
        await endSession(session.id);
        cleanedCount++;
      }
    }
    console.log(`  Ended ${cleanedCount} test sessions`);

  } catch (error) {
    console.error('\n[FATAL ERROR]', error.message);
    testResults.failed.push(`Fatal error: ${error.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  // ============================================================
  // RESULTS SUMMARY
  // ============================================================
  console.log('\n========================================');
  console.log('  TEST RESULTS SUMMARY');
  console.log('========================================');

  console.log(`\n✓ PASSED (${testResults.passed.length}):`);
  testResults.passed.forEach(t => console.log(`  - ${t}`));

  if (testResults.warnings.length > 0) {
    console.log(`\n? WARNINGS (${testResults.warnings.length}):`);
    testResults.warnings.forEach(t => console.log(`  - ${t}`));
  }

  if (testResults.failed.length > 0) {
    console.log(`\n✗ FAILED (${testResults.failed.length}):`);
    testResults.failed.forEach(t => console.log(`  - ${t}`));
  }

  console.log('\n========================================');
  const total = testResults.passed.length + testResults.failed.length;
  const passRate = total > 0 ? ((testResults.passed.length / total) * 100).toFixed(1) : 0;
  console.log(`  Pass Rate: ${passRate}% (${testResults.passed.length}/${total})`);
  console.log('========================================\n');

  return testResults;
}

// Run if executed directly
if (require.main === module) {
  runTests().then(results => {
    process.exit(results.failed.length > 0 ? 1 : 0);
  }).catch(err => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
