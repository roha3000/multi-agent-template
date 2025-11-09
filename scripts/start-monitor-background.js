#!/usr/bin/env node

/**
 * Start Usage Monitor in Background
 *
 * Launches the usage monitor in a separate process/terminal window
 * that stays open in the background.
 *
 * Usage:
 *   node scripts/start-monitor-background.js
 *   npm run monitor:bg
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Usage Monitor in background...\n');

// Determine the appropriate command based on OS
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const isLinux = process.platform === 'linux';

let command, args;

if (isWindows) {
  // Windows: Start in new terminal window
  command = 'start';
  args = [
    'cmd.exe',
    '/c',
    `title Usage Monitor && node "${path.join(__dirname, 'usage-monitor.js')}"`
  ];
} else if (isMac) {
  // macOS: Open in new Terminal window
  const script = `tell application "Terminal"
    do script "cd ${process.cwd()} && node ${path.join(__dirname, 'usage-monitor.js')}"
    activate
  end tell`;

  command = 'osascript';
  args = ['-e', script];
} else if (isLinux) {
  // Linux: Try common terminal emulators
  const terminals = [
    { cmd: 'gnome-terminal', args: ['--', 'node', path.join(__dirname, 'usage-monitor.js')] },
    { cmd: 'konsole', args: ['-e', 'node', path.join(__dirname, 'usage-monitor.js')] },
    { cmd: 'xterm', args: ['-e', 'node', path.join(__dirname, 'usage-monitor.js')] }
  ];

  // Try to find an available terminal
  const { execSync } = require('child_process');
  for (const term of terminals) {
    try {
      execSync(`which ${term.cmd}`, { stdio: 'ignore' });
      command = term.cmd;
      args = term.args;
      break;
    } catch (e) {
      // Terminal not found, try next
    }
  }

  if (!command) {
    console.error('❌ No terminal emulator found. Please install gnome-terminal, konsole, or xterm.');
    process.exit(1);
  }
}

try {
  if (isWindows) {
    // Windows requires special handling
    const { exec } = require('child_process');
    const monitorPath = path.join(__dirname, 'usage-monitor.js');
    exec(`start "Usage Monitor" cmd /c "node ${monitorPath}"`, (error) => {
      if (error) {
        console.error('❌ Failed to start monitor:', error.message);
        process.exit(1);
      }
    });
  } else {
    // macOS and Linux
    const monitor = spawn(command, args, {
      detached: true,
      stdio: 'ignore'
    });

    monitor.unref();
  }

  console.log('✅ Usage Monitor started in separate window!');
  console.log('   The monitor will continue running in the background.');
  console.log('   Close the terminal window to stop monitoring.\n');

} catch (error) {
  console.error('❌ Failed to start monitor:', error.message);
  console.error('\nTry running manually:');
  console.error('  npm run monitor\n');
  process.exit(1);
}
