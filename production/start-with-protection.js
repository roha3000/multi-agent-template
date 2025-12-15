#!/usr/bin/env node
/**
 * Production Start Script with Multi-Instance Protection
 * Gracefully handles port conflicts and provides helpful feedback
 */

const path = require('path');
const fs = require('fs');
const net = require('net');

// Import servers
const DashboardServer = require('./dashboard-server');
const TelemetryServer = require('./telemetry-server');
const config = require('./config/production.json');

class ProtectedProductionServer {
  constructor() {
    this.servers = [];
    this.pidFile = path.join(__dirname, '..', '.claude', 'production.pid');
    this.lockFile = path.join(__dirname, '..', '.claude', 'production.lock');
    this.ports = {
      dashboard: config.dashboard.port,
      telemetry: config.telemetry.port,
      websocket: config.dashboard.wsPort,
    };
  }

  async checkPort(port, name) {
    return new Promise((resolve) => {
      const tester = net.createServer();

      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`⚠️  Port ${port} (${name}) is already in use`);
          resolve(false);
        } else {
          resolve(true);
        }
      });

      tester.once('listening', () => {
        tester.close();
        resolve(true);
      });

      tester.listen(port, 'localhost');
    });
  }

  async checkAllPorts() {
    const results = {
      dashboard: await this.checkPort(this.ports.dashboard, 'Dashboard'),
      telemetry: await this.checkPort(this.ports.telemetry, 'Telemetry API'),
      websocket: await this.checkPort(this.ports.websocket, 'WebSocket'),
    };

    return Object.values(results).every(available => available);
  }

  createLock() {
    try {
      // Create lock file with exclusive access
      if (fs.existsSync(this.lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
        const lockAge = Date.now() - lockData.timestamp;

        // If lock is older than 5 minutes, assume stale
        if (lockAge > 5 * 60 * 1000) {
          console.log('🔓 Removing stale lock file...');
          fs.unlinkSync(this.lockFile);
        } else {
          return false;
        }
      }

      fs.writeFileSync(this.lockFile, JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        ports: this.ports
      }));

      return true;
    } catch (error) {
      return false;
    }
  }

  releaseLock() {
    try {
      if (fs.existsSync(this.lockFile)) {
        const lockData = JSON.parse(fs.readFileSync(this.lockFile, 'utf8'));
        if (lockData.pid === process.pid) {
          fs.unlinkSync(this.lockFile);
        }
      }
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  writePidFile() {
    const dir = path.dirname(this.pidFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.pidFile, JSON.stringify({
      pid: process.pid,
      started: new Date().toISOString(),
      ports: this.ports,
      command: process.argv.join(' ')
    }, null, 2));
  }

  removePidFile() {
    try {
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  checkExistingInstance() {
    if (fs.existsSync(this.pidFile)) {
      try {
        const pidData = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));

        // Check if process is still running
        try {
          process.kill(pidData.pid, 0);
          return pidData;
        } catch {
          // Process not running, clean up PID file
          console.log('🧹 Cleaning up stale PID file...');
          this.removePidFile();
        }
      } catch (error) {
        // Corrupted PID file, remove it
        this.removePidFile();
      }
    }
    return null;
  }

  async start() {
    console.log('🚀 Starting Claude Session Monitor with Protection...\n');

    // Check for existing instance via PID file
    const existing = this.checkExistingInstance();
    if (existing) {
      console.log('⚠️  Another instance is already running!');
      console.log(`   PID: ${existing.pid}`);
      console.log(`   Started: ${existing.started}`);
      console.log(`   Dashboard: http://localhost:${existing.ports.dashboard}`);
      console.log(`   Telemetry: http://localhost:${existing.ports.telemetry}`);
      console.log('\n💡 To stop the existing instance, run:');
      console.log(`   taskkill /F /PID ${existing.pid}  (Windows)`);
      console.log(`   kill ${existing.pid}  (Unix/Mac)\n`);
      process.exit(0);
    }

    // Try to acquire lock
    if (!this.createLock()) {
      console.log('❌ Could not acquire lock. Another instance may be starting up.');
      console.log('   Please wait a moment and try again.\n');
      process.exit(1);
    }

    // Check port availability
    console.log('🔍 Checking port availability...\n');
    const portsAvailable = await this.checkAllPorts();

    if (!portsAvailable) {
      console.log('\n❌ Cannot start: One or more ports are already in use.');
      console.log('\n💡 Possible solutions:');
      console.log('   1. Stop the existing services');
      console.log('   2. Change ports in production/config/production.json');
      console.log('   3. Use the singleton launcher: node start-monitor-singleton.js\n');

      // Show what's using the ports
      console.log('📊 To see what\'s using these ports:');
      console.log('   netstat -an | findstr LISTENING | findstr "3000 9464 3001"\n');

      this.releaseLock();
      process.exit(1);
    }

    console.log('✅ All ports are available!\n');

    // Write PID file
    this.writePidFile();

    // Display startup banner
    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║                                                           ║');
    console.log('║   Claude Session Monitor - Production Dashboard          ║');
    console.log('║                     (Protected Mode)                     ║');
    console.log('║                                                           ║');
    console.log('║   📊 Dashboard: http://localhost:3000                   ║');
    console.log('║   📡 Telemetry API: http://localhost:9464              ║');
    console.log('║   🔌 WebSocket: ws://localhost:3001                   ║');
    console.log('║                                                           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');
    console.log('Press Ctrl+C to stop\n');

    try {
      // Start servers with error handling
      const dashboard = new DashboardServer(config);
      const telemetry = new TelemetryServer(config);

      // Handle server errors gracefully
      dashboard.app.on('error', (err) => {
        console.error('❌ Dashboard server error:', err.message);
        this.shutdown(1);
      });

      await telemetry.initialize().catch(err => {
        console.error('❌ Failed to initialize telemetry:', err.message);
        this.shutdown(1);
      });

      dashboard.start();

      this.servers = [dashboard, telemetry];

    } catch (error) {
      console.error('❌ Failed to start services:', error.message);
      this.shutdown(1);
    }

    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());

    // Handle unexpected errors
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught exception:', error);
      this.shutdown(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
      this.shutdown(1);
    });
  }

  shutdown(exitCode = 0) {
    console.log('\n🛑 Shutting down gracefully...');

    // Stop all servers
    this.servers.forEach(server => {
      try {
        if (server && server.stop) {
          server.stop();
        }
      } catch (error) {
        console.error('Error stopping server:', error.message);
      }
    });

    // Clean up files
    this.removePidFile();
    this.releaseLock();

    console.log('✅ Shutdown complete\n');
    process.exit(exitCode);
  }
}

// Start the protected server
if (require.main === module) {
  const server = new ProtectedProductionServer();
  server.start().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = ProtectedProductionServer;