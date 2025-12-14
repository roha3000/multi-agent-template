/**
 * Continuous Loop Manager
 *
 * Manages the lifecycle of the continuous loop background process:
 * - Starting the process
 * - Checking if already running
 * - Stopping the process
 * - Managing PID file
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

class ContinuousLoopManager {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.pidFile = path.join(this.projectRoot, '.claude', 'continuous-loop.pid');
    this.logFile = path.join(this.projectRoot, '.claude', 'logs', 'continuous-loop.log');

    // Ensure log directory exists
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    this.logger = winston.createLogger({
      level: options.logLevel || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `${timestamp} [ContinuousLoopManager] ${level.toUpperCase()}: ${message} ${metaStr}`;
        })
      ),
      transports: [
        new winston.transports.File({ filename: this.logFile })
      ]
    });
  }

  /**
   * Check if the continuous loop is currently running
   * @returns {Object} { running: boolean, pid: number|null, port: number|null }
   */
  isRunning() {
    try {
      if (!fs.existsSync(this.pidFile)) {
        return { running: false, pid: null, port: null };
      }

      const pidData = JSON.parse(fs.readFileSync(this.pidFile, 'utf8'));
      const { pid, port, startedAt } = pidData;

      // Check if process is actually running
      try {
        process.kill(pid, 0); // Signal 0 checks if process exists without killing it

        this.logger.info('Continuous loop process found', { pid, port, startedAt });
        return { running: true, pid, port, startedAt };
      } catch (error) {
        // Process doesn't exist - clean up stale PID file
        this.logger.warn('Stale PID file found, cleaning up', { pid });
        fs.unlinkSync(this.pidFile);
        return { running: false, pid: null, port: null };
      }
    } catch (error) {
      this.logger.error('Error checking if continuous loop is running', { error: error.message });
      return { running: false, pid: null, port: null };
    }
  }

  /**
   * Start the continuous loop background process
   * @param {Object} config - Configuration from continuous-loop-config.json
   * @returns {Promise<Object>} { success: boolean, pid: number, port: number, message: string }
   */
  async start(config = {}) {
    const status = this.isRunning();

    if (status.running) {
      this.logger.info('Continuous loop already running', { pid: status.pid, port: status.port });
      return {
        success: true,
        alreadyRunning: true,
        pid: status.pid,
        port: status.port,
        message: `Continuous loop already running (PID: ${status.pid}, Port: ${status.port})`
      };
    }

    try {
      // Get port from config
      const port = config.dashboard?.port || 3030;

      // Start the process in detached mode
      const scriptPath = path.join(this.projectRoot, 'start-continuous-loop.js');

      this.logger.info('Starting continuous loop process', { scriptPath, port });

      const child = spawn('node', [scriptPath], {
        detached: true,
        stdio: 'ignore', // Don't pipe stdio - let it run independently
        cwd: this.projectRoot,
        env: {
          ...process.env,
          CONTINUOUS_LOOP_BACKGROUND: 'true' // Signal that we're running in background
        }
      });

      // Unref so parent can exit
      child.unref();

      // Write PID file
      const pidData = {
        pid: child.pid,
        port,
        startedAt: new Date().toISOString(),
        startedBy: 'auto-start'
      };

      fs.writeFileSync(this.pidFile, JSON.stringify(pidData, null, 2));

      this.logger.info('Continuous loop process started', { pid: child.pid, port });

      // Wait a bit to ensure it started successfully
      await new Promise(resolve => setTimeout(resolve, config.autoStartDelay || 2000));

      // Verify it's still running
      const verifyStatus = this.isRunning();
      if (!verifyStatus.running) {
        throw new Error('Process started but exited immediately');
      }

      return {
        success: true,
        alreadyRunning: false,
        pid: child.pid,
        port,
        message: `Continuous loop started (PID: ${child.pid}, Port: ${port})`
      };

    } catch (error) {
      this.logger.error('Failed to start continuous loop', { error: error.message, stack: error.stack });

      // Clean up PID file if it exists
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }

      return {
        success: false,
        alreadyRunning: false,
        pid: null,
        port: null,
        message: `Failed to start continuous loop: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Stop the continuous loop process
   * @returns {Promise<Object>} { success: boolean, message: string }
   */
  async stop() {
    const status = this.isRunning();

    if (!status.running) {
      this.logger.info('Continuous loop not running');
      return {
        success: true,
        wasRunning: false,
        message: 'Continuous loop is not running'
      };
    }

    try {
      this.logger.info('Stopping continuous loop process', { pid: status.pid });

      // Send SIGTERM for graceful shutdown
      process.kill(status.pid, 'SIGTERM');

      // Wait up to 5 seconds for graceful shutdown
      let attempts = 0;
      while (attempts < 50) {
        try {
          process.kill(status.pid, 0);
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        } catch (error) {
          // Process is gone
          break;
        }
      }

      // If still running, force kill
      try {
        process.kill(status.pid, 0);
        this.logger.warn('Process did not exit gracefully, forcing kill', { pid: status.pid });
        process.kill(status.pid, 'SIGKILL');
      } catch (error) {
        // Process is gone
      }

      // Clean up PID file
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }

      this.logger.info('Continuous loop process stopped', { pid: status.pid });

      return {
        success: true,
        wasRunning: true,
        pid: status.pid,
        message: `Continuous loop stopped (PID: ${status.pid})`
      };

    } catch (error) {
      this.logger.error('Error stopping continuous loop', { error: error.message });

      // Try to clean up PID file anyway
      if (fs.existsSync(this.pidFile)) {
        fs.unlinkSync(this.pidFile);
      }

      return {
        success: false,
        wasRunning: true,
        message: `Error stopping continuous loop: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Restart the continuous loop process
   * @param {Object} config - Configuration from continuous-loop-config.json
   * @returns {Promise<Object>} Result of restart operation
   */
  async restart(config = {}) {
    this.logger.info('Restarting continuous loop');

    const stopResult = await this.stop();
    if (!stopResult.success) {
      return {
        success: false,
        message: `Failed to stop process during restart: ${stopResult.message}`
      };
    }

    // Wait a bit before restarting
    await new Promise(resolve => setTimeout(resolve, 1000));

    return await this.start(config);
  }

  /**
   * Get detailed status of the continuous loop
   * @returns {Object} Detailed status information
   */
  getStatus() {
    const runningStatus = this.isRunning();

    return {
      running: runningStatus.running,
      pid: runningStatus.pid,
      port: runningStatus.port,
      startedAt: runningStatus.startedAt,
      uptime: runningStatus.startedAt
        ? Date.now() - new Date(runningStatus.startedAt).getTime()
        : null,
      pidFile: this.pidFile,
      logFile: this.logFile
    };
  }
}

module.exports = ContinuousLoopManager;
