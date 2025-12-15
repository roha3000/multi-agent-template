#!/usr/bin/env node
/**
 * Session Start Hook for Claude Code
 * Prompts user to start monitoring framework at session beginning
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class SessionMonitorPrompt {
  constructor() {
    this.projectRoot = process.cwd();
    this.monitorScript = path.join(this.projectRoot, 'start-monitor-singleton.js');
    this.sessionFile = path.join(this.projectRoot, '.claude', 'last-session.json');
    this.promptShownFile = path.join(this.projectRoot, '.claude', 'monitor-prompt-shown.flag');
  }

  isNewSession() {
    // Check if this is a new Claude session
    // Method 1: Check if prompt was already shown recently
    if (fs.existsSync(this.promptShownFile)) {
      const stats = fs.statSync(this.promptShownFile);
      const hoursSincePrompt = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60);

      // If prompted within last 2 hours, don't prompt again
      if (hoursSincePrompt < 2) {
        return false;
      }
    }

    return true;
  }

  markPromptShown() {
    const dir = path.dirname(this.promptShownFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.promptShownFile, new Date().toISOString());
  }

  async checkMonitorStatus() {
    try {
      // Check if monitor is already running
      const MonitorSingleton = require(this.monitorScript);
      const monitor = new MonitorSingleton();
      const isRunning = await monitor.isMonitorRunning();
      return isRunning;
    } catch (error) {
      return false;
    }
  }

  generatePrompt() {
    return `
🎯 **Multi-Agent Monitoring Framework Available**

Would you like to start the OpenTelemetry monitoring dashboard for this session?

This will provide:
- Real-time token usage tracking
- Context usage monitoring
- Session checkpoint management
- Multi-agent coordination dashboard

**Options:**
1. Yes - Start the monitoring framework
2. No - Continue without monitoring
3. Status - Check if already running

You can also start it manually anytime with: \`node start-monitor-singleton.js\`

Please respond with your choice (1/2/3):
`;
  }

  async execute() {
    // Only run in Claude Code environment
    if (!process.env.CLAUDE_CODE && !process.env.CLAUDE_SESSION) {
      return;
    }

    if (!this.isNewSession()) {
      return;
    }

    // Mark that we've shown the prompt
    this.markPromptShown();

    // Check if monitor is already running
    const isRunning = await this.checkMonitorStatus();

    if (isRunning) {
      console.log('✅ Monitoring framework is already running');
      console.log('📊 Dashboard: http://localhost:3000');
      return;
    }

    // Generate the prompt for Claude to ask the user
    console.log(this.generatePrompt());

    // Note: The actual user response will be handled by Claude
    // This hook just triggers the prompt
  }
}

// Export for testing
module.exports = SessionMonitorPrompt;

// Run if called directly
if (require.main === module) {
  const prompt = new SessionMonitorPrompt();
  prompt.execute().catch(console.error);
}