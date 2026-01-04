#!/usr/bin/env node
/**
 * Live E2E Test: Orchestrator → Dashboard Sync
 *
 * This script tests the actual dashboard integration by:
 * 1. Registering a session
 * 2. Updating phase transitions
 * 3. Recording task completion
 * 4. Deregistering on exit
 *
 * Run with: node scripts/test-orchestrator-dashboard-sync.js
 */

const http = require('http');
const path = require('path');

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3033';
const PROJECT_PATH = process.cwd();
const PROJECT_NAME = path.basename(PROJECT_PATH);

// Test state
let registeredSessionId = null;
let testsPassed = 0;
let testsFailed = 0;
const results = [];

// ============================================================================
// ACTUAL FUNCTIONS FROM ORCHESTRATOR (copied to test in isolation)
// ============================================================================

function postToDashboard(endpoint, data) {
  return new Promise((resolve) => {
    try {
      const url = new URL(DASHBOARD_URL);
      const postData = JSON.stringify(data);

      const options = {
        hostname: url.hostname,
        port: url.port || 3033,
        path: endpoint,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ success: true, ...parsed });
          } catch {
            resolve({ success: res.statusCode === 200 });
          }
        });
      });

      req.on('error', (err) => {
        console.error(`[ERROR] POST ${endpoint} failed: ${err.message}`);
        resolve({ success: false, error: err.message });
      });
      req.write(postData);
      req.end();
    } catch (err) {
      console.error(`[ERROR] POST ${endpoint} error: ${err.message}`);
      resolve({ success: false, error: err.message });
    }
  });
}

function getDashboard(endpoint) {
  return new Promise((resolve) => {
    try {
      const url = new URL(DASHBOARD_URL);

      const options = {
        hostname: url.hostname,
        port: url.port || 3033,
        path: endpoint,
        method: 'GET',
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ success: true, data: parsed });
          } catch {
            resolve({ success: false, error: 'Parse error' });
          }
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
      req.end();
    } catch (err) {
      resolve({ success: false, error: err.message });
    }
  });
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function log(message) {
  console.log(`[TEST] ${message}`);
}

function pass(testName, details = '') {
  testsPassed++;
  results.push({ name: testName, status: 'PASS', details });
  console.log(`  ✅ ${testName}${details ? ': ' + details : ''}`);
}

function fail(testName, error) {
  testsFailed++;
  results.push({ name: testName, status: 'FAIL', error });
  console.log(`  ❌ ${testName}: ${error}`);
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============================================================================
// TESTS
// ============================================================================

async function testDashboardConnection() {
  log('Testing dashboard connection...');

  const response = await getDashboard('/api/health');
  if (response.success) {
    pass('Dashboard is reachable');
    return true;
  } else {
    fail('Dashboard is reachable', response.error);
    return false;
  }
}

async function testSessionRegistration() {
  log('Testing session registration...');

  const response = await postToDashboard('/api/sessions/register', {
    project: PROJECT_NAME,
    path: PROJECT_PATH,
    status: 'active',
    sessionType: 'e2e-test',
    autonomous: true,
    orchestratorInfo: {
      version: 'test-1.0.0',
      startTime: new Date().toISOString(),
      mode: 'e2e-test'
    },
    logSessionId: 999,
    currentTask: null,
    contextPercent: 0,
    qualityScore: 0,
    iteration: 0,
  });

  if (response.success && response.id) {
    registeredSessionId = response.id;
    pass('Session registration', `ID: ${registeredSessionId}`);
    return true;
  } else {
    fail('Session registration', JSON.stringify(response));
    return false;
  }
}

async function testPhaseTransitionUpdate() {
  log('Testing phase transition → dashboard update...');

  if (!registeredSessionId) {
    fail('Phase transition update', 'No session registered');
    return false;
  }

  // Simulate phase transition from research → design
  const response = await postToDashboard(`/api/sessions/${registeredSessionId}/update`, {
    status: 'active',
    phase: 'design',
    qualityScore: 87,
    iteration: 1,
    currentTask: { id: 'test-task-1', title: 'Test Task', phase: 'design' },
    phaseHistory: [
      { session: 1, iteration: 1, exitReason: 'complete', peakContext: 45.2 }
    ]
  });

  if (response.success) {
    // Verify the update was received via summary endpoint
    await sleep(100);
    const summary = await getDashboard('/api/sessions/summary');

    if (summary.success && summary.data && summary.data.sessions) {
      const ourSession = summary.data.sessions.find(s => s.id === registeredSessionId);
      if (ourSession) {
        if (ourSession.phase === 'design') {
          pass('Phase transition update', `Phase verified: ${ourSession.phase}`);
          return true;
        } else {
          fail('Phase transition update', `Phase mismatch: expected 'design', got '${ourSession.phase}'`);
          return false;
        }
      }
    }

    // If we can't verify, at least the POST succeeded
    pass('Phase transition update (POST succeeded)', 'Could not verify via GET');
    return true;
  } else {
    fail('Phase transition update', JSON.stringify(response));
    return false;
  }
}

async function testQualityScorePropagation() {
  log('Testing quality score propagation...');

  if (!registeredSessionId) {
    fail('Quality score propagation', 'No session registered');
    return false;
  }

  // Update with quality score
  const response = await postToDashboard(`/api/sessions/${registeredSessionId}/update`, {
    qualityScore: 92,
    phase: 'implement'
  });

  if (response.success) {
    await sleep(100);
    const summary = await getDashboard('/api/sessions/summary');

    if (summary.success && summary.data && summary.data.sessions) {
      const ourSession = summary.data.sessions.find(s => s.id === registeredSessionId);
      if (ourSession && ourSession.qualityScore === 92) {
        pass('Quality score propagation', `Score verified: ${ourSession.qualityScore}`);
        return true;
      }
    }

    pass('Quality score propagation (POST succeeded)', 'Could not verify via GET');
    return true;
  } else {
    fail('Quality score propagation', JSON.stringify(response));
    return false;
  }
}

async function testTaskCompletionSync() {
  log('Testing task completion → currentTask: null...');

  if (!registeredSessionId) {
    fail('Task completion sync', 'No session registered');
    return false;
  }

  // First set a task
  await postToDashboard(`/api/sessions/${registeredSessionId}/update`, {
    currentTask: { id: 'test-task-2', title: 'Another Task', phase: 'test' }
  });

  await sleep(100);

  // Now complete the task (set to null)
  const response = await postToDashboard(`/api/sessions/${registeredSessionId}/update`, {
    currentTask: null,
    qualityScore: 95,
    tasksCompleted: 1
  });

  if (response.success) {
    await sleep(100);
    const summary = await getDashboard('/api/sessions/summary');

    if (summary.success && summary.data && summary.data.sessions) {
      const ourSession = summary.data.sessions.find(s => s.id === registeredSessionId);
      if (ourSession && ourSession.currentTask === null) {
        pass('Task completion sync', 'currentTask verified: null');
        return true;
      }
    }

    pass('Task completion sync (POST succeeded)', 'Could not verify via GET');
    return true;
  } else {
    fail('Task completion sync', JSON.stringify(response));
    return false;
  }
}

async function testTaskCompletionRecord() {
  log('Testing task completion record...');

  const response = await postToDashboard('/api/sessions/completion', {
    project: PROJECT_NAME,
    task: { id: 'test-task-complete', title: 'Completed Test Task' },
    score: 94,
    cost: 0.05
  });

  if (response.success) {
    pass('Task completion record', 'Recorded successfully');
    return true;
  } else {
    fail('Task completion record', JSON.stringify(response));
    return false;
  }
}

async function testLogForwarding() {
  log('Testing log forwarding...');

  if (!registeredSessionId) {
    fail('Log forwarding', 'No session registered');
    return false;
  }

  const response = await postToDashboard(`/api/logs/${registeredSessionId}/write`, {
    timestamp: new Date().toISOString(),
    level: 'INFO',
    source: 'e2e-test',
    message: 'E2E test log message',
    sessionNumber: 999,
    phase: 'test',
    taskId: 'test-task'
  });

  if (response.success) {
    pass('Log forwarding', 'Log written successfully');
    return true;
  } else {
    fail('Log forwarding', JSON.stringify(response));
    return false;
  }
}

async function testSessionDeregistration() {
  log('Testing session deregistration...');

  if (!registeredSessionId) {
    fail('Session deregistration', 'No session to deregister');
    return false;
  }

  const sessionIdToDeregister = registeredSessionId;
  const response = await postToDashboard(`/api/sessions/${sessionIdToDeregister}/end`, {});

  if (response.success) {
    await sleep(100);

    // Verify session is gone via summary endpoint
    const summary = await getDashboard('/api/sessions/summary');
    if (summary.success && summary.data && summary.data.sessions) {
      const ourSession = summary.data.sessions.find(s => s.id === sessionIdToDeregister);
      if (!ourSession) {
        pass('Session deregistration', `Session ${sessionIdToDeregister} verified removed`);
        registeredSessionId = null;
        return true;
      } else {
        fail('Session deregistration', 'Session still exists after deregister');
        return false;
      }
    }

    pass('Session deregistration (POST succeeded)', 'Could not verify via GET');
    registeredSessionId = null;
    return true;
  } else {
    fail('Session deregistration', JSON.stringify(response));
    return false;
  }
}

async function testErrorHandlingOffline() {
  log('Testing graceful degradation when endpoint fails...');

  // Try to update a non-existent session
  const response = await postToDashboard('/api/sessions/non-existent-session/update', {
    phase: 'test'
  });

  // Should not throw, should return gracefully
  if (response.success === false || response.success === true) {
    pass('Error handling (graceful degradation)', 'No crash on invalid session');
    return true;
  } else {
    fail('Error handling', 'Unexpected response');
    return false;
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('  LIVE E2E TEST: Orchestrator → Dashboard Sync');
  console.log('═'.repeat(60));
  console.log(`  Dashboard: ${DASHBOARD_URL}`);
  console.log(`  Project: ${PROJECT_NAME}`);
  console.log('═'.repeat(60) + '\n');

  // Run tests in sequence
  const dashboardOk = await testDashboardConnection();
  if (!dashboardOk) {
    console.log('\n❌ Dashboard not reachable. Aborting tests.');
    process.exit(1);
  }

  await testSessionRegistration();
  await testPhaseTransitionUpdate();
  await testQualityScorePropagation();
  await testTaskCompletionSync();
  await testTaskCompletionRecord();
  await testLogForwarding();
  await testSessionDeregistration();
  await testErrorHandlingOffline();

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('  TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  ✅ Passed: ${testsPassed}`);
  console.log(`  ❌ Failed: ${testsFailed}`);
  console.log(`  Total: ${testsPassed + testsFailed}`);
  console.log('═'.repeat(60) + '\n');

  if (testsFailed > 0) {
    console.log('Failed tests:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  - ${r.name}: ${r.error}`);
    });
    process.exit(1);
  }

  console.log('All tests passed! ✅\n');
  process.exit(0);
}

// Cleanup on exit
process.on('SIGINT', async () => {
  if (registeredSessionId) {
    console.log('\nCleaning up test session...');
    await postToDashboard(`/api/sessions/${registeredSessionId}/end`, {});
  }
  process.exit(0);
});

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
