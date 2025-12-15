#!/usr/bin/env node
/**
 * Singleton Monitor Launcher
 * Ensures only one monitor instance runs across all sessions
 */

const { spawn, execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const MONITOR_PORT = 3000;
const TELEMETRY_PORT = 9464;
const PID_FILE = path.join(__dirname, '.claude', 'monitor.pid');

class MonitorSingleton {
  constructor() {
    this.pidFile = PID_FILE;
    this.ensureDirectories();
  }

  ensureDirectories() {
    const dir = path.dirname(this.pidFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async isPortInUse(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          resolve(true);
        } else {
          resolve(false);
        }
      });
      server.once('listening', () => {
        server.close();
        resolve(false);
      });
      server.listen(port, 'localhost');
    });
  }

  async isMonitorRunning() {
    // Check if key ports are in use
    const dashboardInUse = await this.isPortInUse(MONITOR_PORT);
    const telemetryInUse = await this.isPortInUse(TELEMETRY_PORT);

    // Check PID file
    if (fs.existsSync(this.pidFile)) {
      const pid = fs.readFileSync(this.pidFile, 'utf8').trim();
      try {
        // Check if process is still running (Windows compatible)
        if (process.platform === 'win32') {
          try {
            execSync(`tasklist /FI "PID eq ${pid}" | findstr ${pid}`, { stdio: 'ignore' });
            return true;
          } catch {
            // Process not found
            fs.unlinkSync(this.pidFile);
          }
        } else {
          // Unix-like systems
          process.kill(parseInt(pid), 0);
          return true;
        }
      } catch {
        // Process doesn't exist, clean up PID file
        fs.unlinkSync(this.pidFile);
      }
    }

    return dashboardInUse || telemetryInUse;
  }

  async startMonitor() {
    console.log('🚀 Starting monitor services...');

    // Start the production monitor
    const monitor = spawn('node', ['start.js'], {
      cwd: path.join(__dirname, 'production'),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Write PID file
    fs.writeFileSync(this.pidFile, monitor.pid.toString());

    // Optional: Start OTLP services
    const otlp = spawn('node', ['start-services.js'], {
      cwd: __dirname,
      detached: true,
      stdio: 'ignore'
    });

    console.log(`✅ Monitor started with PID: ${monitor.pid}`);
    console.log(`✅ OTLP services started with PID: ${otlp.pid}`);
    console.log(`📊 Dashboard: http://localhost:${MONITOR_PORT}`);
    console.log(`📡 Telemetry: http://localhost:${TELEMETRY_PORT}`);

    // Allow parent process to exit while children continue
    monitor.unref();
    otlp.unref();

    return { monitor: monitor.pid, otlp: otlp.pid };
  }

  async ensureMonitorRunning() {
    const isRunning = await this.isMonitorRunning();

    if (isRunning) {
      console.log('✅ Monitor is already running');
      console.log(`📊 Dashboard: http://localhost:${MONITOR_PORT}`);
      console.log(`📡 Telemetry: http://localhost:${TELEMETRY_PORT}`);
      return { status: 'already-running' };
    } else {
      console.log('🔍 Monitor not detected, starting new instance...');
      const pids = await this.startMonitor();
      return { status: 'started', pids };
    }
  }

  async stopMonitor() {
    if (fs.existsSync(this.pidFile)) {
      const pid = fs.readFileSync(this.pidFile, 'utf8').trim();
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        } else {
          process.kill(parseInt(pid), 'SIGTERM');
        }
        fs.unlinkSync(this.pidFile);
        console.log('✅ Monitor stopped');
      } catch (err) {
        console.error('Failed to stop monitor:', err.message);
      }
    }
  }

  async status() {
    const isRunning = await this.isMonitorRunning();
    if (isRunning) {
      console.log('✅ Monitor Status: RUNNING');
      if (fs.existsSync(this.pidFile)) {
        const pid = fs.readFileSync(this.pidFile, 'utf8').trim();
        console.log(`   PID: ${pid}`);
      }
      console.log(`   Dashboard: http://localhost:${MONITOR_PORT}`);
      console.log(`   Telemetry: http://localhost:${TELEMETRY_PORT}`);
    } else {
      console.log('❌ Monitor Status: NOT RUNNING');
    }
  }
}

// CLI Interface
async function main() {
  const singleton = new MonitorSingleton();
  const command = process.argv[2];

  switch (command) {
    case 'start':
      await singleton.ensureMonitorRunning();
      break;
    case 'stop':
      await singleton.stopMonitor();
      break;
    case 'status':
      await singleton.status();
      break;
    case 'restart':
      await singleton.stopMonitor();
      await new Promise(resolve => setTimeout(resolve, 2000));
      await singleton.ensureMonitorRunning();
      break;
    default:
      // Default action: ensure running
      await singleton.ensureMonitorRunning();
  }
}

// Export for use in other scripts
module.exports = MonitorSingleton;

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}