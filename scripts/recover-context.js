#!/usr/bin/env node

/**
 * Context Recovery Tool
 * Helps restore Claude session context after compaction
 */

const fs = require('fs');
const path = require('path');

console.log('\n========================================');
console.log('   CLAUDE CONTEXT RECOVERY TOOL');
console.log('========================================\n');

// Find latest checkpoint
const checkpointDir = path.join(__dirname, '..', '.claude', 'checkpoints');
if (!fs.existsSync(checkpointDir)) {
    console.error('❌ No checkpoints directory found');
    process.exit(1);
}

const checkpoints = fs.readdirSync(checkpointDir)
    .filter(f => f.endsWith('.json'))
    .sort((a, b) => b.localeCompare(a));

if (checkpoints.length === 0) {
    console.error('❌ No checkpoint files found');
    process.exit(1);
}

const latestCheckpoint = checkpoints[0];
const checkpointPath = path.join(checkpointDir, latestCheckpoint);
const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));

console.log('📁 Latest Checkpoint:', latestCheckpoint);
console.log('⏰ Saved at:', checkpoint.timestamp);
console.log('\n📊 SESSION STATE AT CHECKPOINT:');
console.log('================================');
console.log('Session ID:', checkpoint.session.sessionId);
console.log('Model:', checkpoint.session.model);
console.log('Context Usage:', checkpoint.session.contextUsage + '%');
console.log('Tokens Used:', checkpoint.session.tokensUsed.toLocaleString());
console.log('Status:', checkpoint.session.checkpointStatus);

if (checkpoint.session.executionPlan) {
    console.log('\n📋 EXECUTION STATE:');
    console.log('Current Task:', checkpoint.session.executionPlan.current);

    if (checkpoint.session.executionPlan.completed) {
        console.log('\nCompleted Tasks:');
        checkpoint.session.executionPlan.completed.forEach(task => {
            console.log('  ' + task);
        });
    }

    if (checkpoint.session.executionPlan.next) {
        console.log('\nNext Tasks:');
        checkpoint.session.executionPlan.next.forEach(task => {
            console.log('  ' + task);
        });
    }
}

if (checkpoint.session.project) {
    console.log('\n🚀 PROJECT DETAILS:');
    console.log('Name:', checkpoint.session.project.name);
    console.log('Description:', checkpoint.session.project.description);

    if (checkpoint.session.project.achievements) {
        console.log('\nAchievements:');
        checkpoint.session.project.achievements.forEach(a => {
            console.log('  ✓', a);
        });
    }
}

console.log('\n📝 RECOVERY INSTRUCTIONS:');
console.log('================================');
console.log('1. Copy and paste this into your new Claude session:\n');

const recoveryPrompt = `Please restore my session context from the following checkpoint:

**Session Details:**
- Session ID: ${checkpoint.session.sessionId}
- Model: ${checkpoint.session.model}
- Previous Context Usage: ${checkpoint.session.contextUsage}%

**Current Task:**
${checkpoint.session.executionPlan?.current || 'Not specified'}

**Completed Work:**
${checkpoint.session.executionPlan?.completed?.join('\n') || 'None listed'}

**Next Tasks:**
${checkpoint.session.executionPlan?.next?.join('\n') || 'None listed'}

**Critical Files to Read:**
${checkpoint.essentialContext?.criticalFiles?.map(f => '- ' + f).join('\n') || '- PROJECT_SUMMARY.md\n- .claude/dev-docs/plan.md\n- .claude/dev-docs/tasks.md'}

Please read these files and continue from where we left off.`;

console.log('---START COPY---');
console.log(recoveryPrompt);
console.log('---END COPY---');

console.log('\n2. After pasting, Claude should:');
console.log('   - Read the critical files');
console.log('   - Understand the project state');
console.log('   - Continue with the next tasks');

console.log('\n✅ Recovery preparation complete!');
console.log('\n💡 TIP: Run this script after any compaction to quickly restore context.');

// Save recovery prompt to file for easy access
const recoveryFile = path.join(__dirname, '..', 'RECOVERY_PROMPT.md');
fs.writeFileSync(recoveryFile, `# Context Recovery Prompt\n\nGenerated: ${new Date().toISOString()}\nCheckpoint: ${latestCheckpoint}\n\n${recoveryPrompt}`);
console.log(`\n📄 Recovery prompt saved to: RECOVERY_PROMPT.md`);