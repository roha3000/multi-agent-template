#!/usr/bin/env node

/**
 * Manual Checkpoint Trigger
 * Saves current state and triggers context clearing
 */

const fs = require('fs');
const path = require('path');

console.log('🔄 MANUAL CHECKPOINT TRIGGER');
console.log('========================================');
console.log('Context at 92% - Triggering emergency checkpoint');

// Create checkpoint directory
const checkpointDir = path.join(__dirname, '.claude', 'checkpoints');
if (!fs.existsSync(checkpointDir)) {
  fs.mkdirSync(checkpointDir, { recursive: true });
}

// Create timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const checkpointFile = path.join(checkpointDir, `checkpoint-${timestamp}.json`);

// Save checkpoint data
const checkpointData = {
  timestamp: new Date().toISOString(),
  contextUsage: 0.92,
  reason: 'manual-emergency',
  sessionState: {
    activeTasks: [
      'Production telemetry system running',
      'Dashboard at http://localhost:3000',
      'Todo/plan tracking implemented',
      'Combined project-session view complete'
    ],
    runningProcesses: [
      'production/start.js (telemetry)',
      'track-current-session.js',
      'continuous-loop at port 3030'
    ],
    criticalIssue: 'Continuous loop not detecting context properly'
  },
  files: {
    modified: [
      'production/telemetry-server.js',
      'production/public/dashboard.js',
      'production/public/dashboard.css',
      'track-current-session.js',
      'EMERGENCY_CHECKPOINT.md',
      'PROJECT_SUMMARY.md'
    ]
  },
  nextSteps: [
    'Fix continuous loop context detection',
    'Update checkpoint thresholds to 85%',
    'Clean up duplicate processes',
    'Implement persistent storage'
  ]
};

// Write checkpoint
fs.writeFileSync(checkpointFile, JSON.stringify(checkpointData, null, 2));
console.log(`✅ Checkpoint saved: ${checkpointFile}`);

// Update latest checkpoint symlink
const latestLink = path.join(checkpointDir, 'latest-checkpoint.json');
try {
  if (fs.existsSync(latestLink)) {
    fs.unlinkSync(latestLink);
  }
  fs.copyFileSync(checkpointFile, latestLink);
  console.log('✅ Updated latest checkpoint link');
} catch (err) {
  console.log('⚠️  Could not update latest checkpoint link:', err.message);
}

// Signal to continuous loop (if it was working properly)
const signalFile = path.join(__dirname, '.claude', 'signals', 'clear-context-requested');
const signalDir = path.dirname(signalFile);
if (!fs.existsSync(signalDir)) {
  fs.mkdirSync(signalDir, { recursive: true });
}
fs.writeFileSync(signalFile, JSON.stringify({
  timestamp: new Date().toISOString(),
  reason: 'manual-emergency-at-92-percent',
  requestedBy: 'user'
}));

console.log('✅ Context clear signal created');

// Create recovery instructions
const recoveryFile = path.join(__dirname, 'RECOVERY_INSTRUCTIONS.md');
const recoveryContent = `# Recovery Instructions - Post Context Clear

## Timestamp: ${new Date().toISOString()}

## Current State
- Context was at 92% when checkpoint triggered
- Production telemetry system is running
- Dashboard at http://localhost:3000
- Continuous loop monitor at http://localhost:3030

## To Resume Work:
1. Read PROJECT_SUMMARY.md for project context
2. Read EMERGENCY_CHECKPOINT.md for session state
3. Check dashboard at http://localhost:3000
4. Resume from latest checkpoint in .claude/checkpoints/

## Active Systems:
- Telemetry Server: http://localhost:9464
- Dashboard: http://localhost:3000
- WebSocket: ws://localhost:3001
- Continuous Loop: http://localhost:3030

## Critical Issue to Fix:
The continuous loop is not properly detecting context usage.
It should have triggered checkpoint at 75% but didn't.
Need to fix context detection mechanism.

## Commands to Resume:
\`\`\`bash
# Check running processes
tasklist | findstr node

# View dashboard
start http://localhost:3000

# Check continuous loop
start http://localhost:3030
\`\`\`
`;

fs.writeFileSync(recoveryFile, recoveryContent);
console.log('✅ Recovery instructions created');

console.log('\n========================================');
console.log('📊 CHECKPOINT COMPLETE');
console.log('========================================');
console.log('\nContext can now be cleared safely.');
console.log('All critical state has been preserved.');
console.log('\nTo reload context after clearing:');
console.log('1. Read PROJECT_SUMMARY.md');
console.log('2. Read EMERGENCY_CHECKPOINT.md');
console.log('3. Read RECOVERY_INSTRUCTIONS.md');
console.log('4. Check .claude/checkpoints/latest-checkpoint.json');

process.exit(0);