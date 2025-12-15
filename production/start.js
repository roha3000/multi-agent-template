#!/usr/bin/env node

/**
 * Production Startup Script
 * Starts both telemetry and dashboard servers
 */

const { spawn } = require('child_process');
const path = require('path');

const config = require('./config/production.json');

console.log('🚀 Starting Claude Session Monitor...\n');

// Start telemetry server
const telemetry = spawn('node', [path.join(__dirname, 'telemetry-server.js')], {
  stdio: 'inherit',
  env: process.env
});

// Start dashboard server (wait a bit for telemetry to initialize)
setTimeout(() => {
  const dashboard = spawn('node', [path.join(__dirname, 'dashboard-server.js')], {
    stdio: 'inherit',
    env: process.env
  });

  dashboard.on('error', (error) => {
    console.error('Dashboard error:', error);
  });

  dashboard.on('exit', (code) => {
    if (code !== 0) {
      console.error(`Dashboard exited with code ${code}`);
    }
    process.exit(code);
  });
}, 2000);

telemetry.on('error', (error) => {
  console.error('Telemetry error:', error);
});

telemetry.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Telemetry server exited with code ${code}`);
  }
  process.exit(code);
});

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down gracefully...');
  telemetry.kill('SIGINT');
  process.exit(0);
});

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   Claude Session Monitor - Production Dashboard          ║
║                                                           ║
║   📊 Dashboard: http://${config.dashboard.host}:${config.dashboard.port}                   ║
║   📡 Telemetry API: http://${config.telemetry.host}:${config.telemetry.port}              ║
║   🔌 WebSocket: ws://${config.dashboard.host}:${config.dashboard.wsPort}                   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝

Press Ctrl+C to stop
`);