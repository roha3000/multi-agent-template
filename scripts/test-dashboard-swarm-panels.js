#!/usr/bin/env node
/**
 * Dashboard Swarm Panels Manual Test Script
 *
 * This script sends test data to the swarm API endpoints to verify
 * the dashboard UI renders correctly.
 *
 * Usage:
 *   1. Start the server: npm run monitor:global
 *   2. Run this script: node scripts/test-dashboard-swarm-panels.js
 *   3. Open http://localhost:3033 in your browser
 *   4. Verify the panels render correctly
 */

const http = require('http');

const PORT = process.env.PORT || 3033;
const BASE_URL = `http://localhost:${PORT}`;

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(color, symbol, message) {
  console.log(`${colors[color]}${symbol}${colors.reset} ${message}`);
}

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function checkServerRunning() {
  try {
    await makeRequest('GET', '/api/confidence');
    return true;
  } catch (err) {
    return false;
  }
}

async function testConfidencePanel() {
  log('blue', '🎯', 'Testing Confidence Panel...');

  // Test different confidence levels
  const testCases = [
    { confidence: 85, level: 'healthy', name: 'Healthy (85%)' },
    { confidence: 55, level: 'warning', name: 'Warning (55%)' },
    { confidence: 35, level: 'critical', name: 'Critical (35%)' },
    { confidence: 20, level: 'emergency', name: 'Emergency (20%)' }
  ];

  for (const testCase of testCases) {
    const res = await makeRequest('POST', '/api/confidence', {
      confidence: testCase.confidence,
      level: testCase.level,
      signals: {
        qualityScore: Math.round(testCase.confidence + Math.random() * 10),
        velocity: Math.round(testCase.confidence - 5 + Math.random() * 10),
        iterations: Math.round(testCase.confidence + 5 + Math.random() * 10),
        errorRate: Math.round(100 - testCase.confidence + Math.random() * 10),
        historical: Math.round(testCase.confidence + Math.random() * 15)
      }
    });

    if (res.status === 200) {
      log('green', '  ✓', `${testCase.name} - Sent successfully`);
    } else {
      log('red', '  ✗', `${testCase.name} - Failed: ${res.status}`);
    }

    // Wait for visual inspection
    await sleep(1500);
  }

  // Set final healthy state
  await makeRequest('POST', '/api/confidence', {
    confidence: 78,
    level: 'healthy',
    signals: {
      qualityScore: 82,
      velocity: 75,
      iterations: 71,
      errorRate: 12,
      historical: 88
    }
  });

  log('green', '✓', 'Confidence Panel test complete\n');
}

async function testPlanningPanel() {
  log('blue', '🏆', 'Testing Planning Panel...');

  const mockPlans = [
    {
      strategy: 'conservative',
      totalScore: 72,
      scores: {
        completeness: 80,
        feasibility: 85,
        risk: 60,
        clarity: 75,
        efficiency: 65
      }
    },
    {
      strategy: 'balanced',
      totalScore: 85,
      scores: {
        completeness: 88,
        feasibility: 92,
        risk: 75,
        clarity: 85,
        efficiency: 82
      }
    },
    {
      strategy: 'aggressive',
      totalScore: 68,
      scores: {
        completeness: 70,
        feasibility: 55,
        risk: 50,
        clarity: 78,
        efficiency: 95
      }
    }
  ];

  // Send plans without winner first
  log('cyan', '  →', 'Sending 3 competing plans...');
  let res = await makeRequest('POST', '/api/plans', { plans: mockPlans });
  if (res.status === 200) {
    log('green', '  ✓', 'Plans sent - Check dashboard for 3 cards');
  }
  await sleep(2000);

  // Now set the winner
  log('cyan', '  →', 'Setting balanced strategy as winner...');
  res = await makeRequest('POST', '/api/plans', {
    plans: mockPlans,
    winner: mockPlans[1]
  });
  if (res.status === 200) {
    log('green', '  ✓', 'Winner set - Check dashboard for crown on balanced card');
  }
  await sleep(2000);

  log('green', '✓', 'Planning Panel test complete\n');
}

async function testComplexityBadge() {
  log('blue', '⭐', 'Testing Complexity Badge...');

  const testCases = [
    { score: 25, strategy: 'fast-path', name: 'Simple (1-2 stars)' },
    { score: 55, strategy: 'standard', name: 'Standard (3-4 stars)' },
    { score: 85, strategy: 'competitive', name: 'Complex (5 stars)' }
  ];

  for (const testCase of testCases) {
    const res = await makeRequest('POST', '/api/complexity', {
      score: testCase.score,
      strategy: testCase.strategy,
      dimensions: {
        dependencyDepth: Math.round(testCase.score + Math.random() * 15),
        acceptanceCriteria: Math.round(testCase.score - 10 + Math.random() * 20),
        effortEstimate: Math.round(testCase.score + Math.random() * 10),
        technicalKeywords: Math.round(testCase.score - 5 + Math.random() * 15),
        historicalSuccess: Math.round(70 + Math.random() * 20)
      }
    });

    if (res.status === 200) {
      log('green', '  ✓', `${testCase.name} - Sent successfully`);
    } else {
      log('red', '  ✗', `${testCase.name} - Failed: ${res.status}`);
    }

    await sleep(1500);
  }

  // Set final state
  await makeRequest('POST', '/api/complexity', {
    score: 72,
    strategy: 'competitive',
    dimensions: {
      dependencyDepth: 85,
      acceptanceCriteria: 68,
      effortEstimate: 75,
      technicalKeywords: 70,
      historicalSuccess: 82
    }
  });

  log('green', '✓', 'Complexity Badge test complete\n');
}

async function testBulkUpdate() {
  log('blue', '📦', 'Testing Bulk Update...');

  const res = await makeRequest('POST', '/api/swarm/state', {
    confidence: {
      confidence: 82,
      level: 'healthy',
      signals: {
        qualityScore: 88,
        velocity: 78,
        iterations: 75,
        errorRate: 8,
        historical: 90
      }
    },
    plans: {
      plans: [
        { strategy: 'conservative', totalScore: 75, scores: { completeness: 80, feasibility: 88, risk: 65, clarity: 78, efficiency: 70 } },
        { strategy: 'balanced', totalScore: 88, scores: { completeness: 90, feasibility: 95, risk: 80, clarity: 88, efficiency: 85 } },
        { strategy: 'aggressive', totalScore: 70, scores: { completeness: 72, feasibility: 60, risk: 55, clarity: 80, efficiency: 92 } }
      ],
      winner: { strategy: 'balanced', totalScore: 88 }
    },
    complexity: {
      score: 68,
      strategy: 'standard',
      dimensions: {
        dependencyDepth: 75,
        acceptanceCriteria: 62,
        effortEstimate: 70,
        technicalKeywords: 65,
        historicalSuccess: 80
      }
    }
  });

  if (res.status === 200) {
    log('green', '  ✓', 'Bulk update sent - All panels should update simultaneously');
  } else {
    log('red', '  ✗', `Bulk update failed: ${res.status}`);
  }

  log('green', '✓', 'Bulk Update test complete\n');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log(colors.bright + '  Dashboard Swarm Panels Test Script' + colors.reset);
  console.log('='.repeat(60) + '\n');

  // Check if server is running
  log('yellow', '⏳', 'Checking if server is running...');
  const serverRunning = await checkServerRunning();

  if (!serverRunning) {
    log('red', '✗', 'Server is not running!');
    console.log('\n  Please start the server first:');
    console.log(colors.cyan + '    npm run monitor:global' + colors.reset);
    console.log('\n  Then run this script again.');
    process.exit(1);
  }

  log('green', '✓', `Server is running at ${BASE_URL}\n`);

  console.log(colors.yellow + '  Open your browser to: ' + colors.cyan + `${BASE_URL}` + colors.reset);
  console.log(colors.yellow + '  Watch the dashboard as test data is sent...\n' + colors.reset);

  await sleep(2000);

  // Run tests
  await testConfidencePanel();
  await testPlanningPanel();
  await testComplexityBadge();
  await testBulkUpdate();

  console.log('='.repeat(60));
  console.log(colors.bright + colors.green + '  All tests complete!' + colors.reset);
  console.log('='.repeat(60));
  console.log('\n  Visual Verification Checklist:');
  console.log('  ' + colors.cyan + '□' + colors.reset + ' Confidence gauge shows 82% with green color');
  console.log('  ' + colors.cyan + '□' + colors.reset + ' 5 signal bars visible with values');
  console.log('  ' + colors.cyan + '□' + colors.reset + ' Trend line shows confidence history');
  console.log('  ' + colors.cyan + '□' + colors.reset + ' 3 plan cards visible (Conservative, Balanced, Aggressive)');
  console.log('  ' + colors.cyan + '□' + colors.reset + ' Balanced card has crown/winner indicator');
  console.log('  ' + colors.cyan + '□' + colors.reset + ' Criteria bars show in each plan card');
  console.log('  ' + colors.cyan + '□' + colors.reset + ' Complexity badge shows "Standard" with 3-4 stars');
  console.log('  ' + colors.cyan + '□' + colors.reset + ' Hovering complexity badge shows dimension tooltip');
  console.log('\n');
}

main().catch(err => {
  log('red', '✗', `Error: ${err.message}`);
  process.exit(1);
});
