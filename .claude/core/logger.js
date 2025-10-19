/**
 * Logger - Centralized logging for multi-agent framework
 *
 * Provides structured logging with Winston to replace console.log statements.
 * Keeps it simple with console and file transports only.
 *
 * @module logger
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Define custom format for readable logs
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, component, ...meta }) => {
    const componentTag = component ? `[${component}]` : '';
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level.toUpperCase().padEnd(7)} ${componentTag} ${message}${metaStr}`;
  })
);

// Create the logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  transports: [
    // Console transport - always show in development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        customFormat
      )
    }),

    // Error log file - errors only
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),

    // Combined log file - all levels
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ],

  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ],

  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

/**
 * Creates a child logger with a component tag
 * @param {string} component - Component name (e.g., 'StateManager', 'SessionInit')
 * @returns {Object} Child logger with component context
 */
function createComponentLogger(component) {
  return logger.child({ component });
}

/**
 * Log levels:
 * - error: Critical errors that need immediate attention
 * - warn: Warning messages for non-critical issues
 * - info: General informational messages
 * - debug: Detailed debugging information
 *
 * Usage examples:
 *
 * const logger = require('./logger').createComponentLogger('StateManager');
 *
 * logger.info('State saved successfully', { phase: 'implementation' });
 * logger.warn('Backup creation failed', { reason: 'disk full' });
 * logger.error('State validation failed', { errors: validationErrors });
 * logger.debug('Loading state', { path: statePath });
 */

module.exports = {
  logger,
  createComponentLogger
};
