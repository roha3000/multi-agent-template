#!/usr/bin/env node

/**
 * Start OTLP Receiver for Claude Code Telemetry
 *
 * This script:
 * 1. Starts the OTLP receiver on port 4318
 * 2. Configures environment for Claude Code telemetry export
 * 3. Monitors and displays incoming metrics
 */

const OTLPReceiver = require('../.claude/core/otlp-receiver');
const path = require('path');
const fs = require('fs');

// Project root
const projectRoot = path.resolve(__dirname, '..');

console.log('[DEBUG] Creating OTLPReceiver instance...');
// Create receiver instance
let receiver;
try {
    receiver = new OTLPReceiver(projectRoot, {
        port: 4318,
        host: 'localhost',
        flushInterval: 5000
    });
    console.log('[DEBUG] OTLPReceiver instance created');
} catch (error) {
    console.error('[DEBUG] Error creating OTLPReceiver:', error.message);
    console.error('[DEBUG] Stack trace:', error.stack);
    process.exit(1);
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    console.log('\n[OTLP] Shutting down receiver...');
    await receiver.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[OTLP] Shutting down receiver...');
    await receiver.stop();
    process.exit(0);
});

// Start the receiver
async function start() {
    try {
        console.log('=====================================');
        console.log('  OpenTelemetry OTLP Receiver');
        console.log('=====================================');
        console.log('');

        await receiver.start();

        console.log('');
        console.log('To enable Claude Code telemetry export:');
        console.log('----------------------------------------');
        console.log('Set these environment variables:');
        console.log('');
        console.log('  export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318');
        console.log('  export OTEL_EXPORTER_OTLP_PROTOCOL=http/json');
        console.log('  export OTEL_SERVICE_NAME=claude-code');
        console.log('  export OTEL_METRIC_EXPORT_INTERVAL=5000');
        console.log('  export OTEL_METRIC_EXPORT_TIMEOUT=5000');
        console.log('');
        console.log('Or add to your .env file:');
        console.log('----------------------------------------');
        console.log('OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318');
        console.log('OTEL_EXPORTER_OTLP_PROTOCOL=http/json');
        console.log('OTEL_SERVICE_NAME=claude-code');
        console.log('OTEL_METRIC_EXPORT_INTERVAL=5000');
        console.log('OTEL_METRIC_EXPORT_TIMEOUT=5000');
        console.log('');
        console.log('Waiting for metrics...');
        console.log('');

        // Create or update .env file with OTLP settings
        const envPath = path.join(projectRoot, '.env');
        const otlpEnvVars = [
            'OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318',
            'OTEL_EXPORTER_OTLP_PROTOCOL=http/json',
            'OTEL_SERVICE_NAME=claude-code',
            'OTEL_METRIC_EXPORT_INTERVAL=5000',
            'OTEL_METRIC_EXPORT_TIMEOUT=5000'
        ];

        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        // Check if OTLP settings already exist
        const hasOtlpSettings = envContent.includes('OTEL_EXPORTER_OTLP_ENDPOINT');

        if (!hasOtlpSettings) {
            // Add OTLP settings to .env file
            if (envContent && !envContent.endsWith('\n')) {
                envContent += '\n';
            }
            envContent += '\n# OpenTelemetry OTLP Settings for Claude Code\n';
            envContent += otlpEnvVars.join('\n') + '\n';

            fs.writeFileSync(envPath, envContent);
            console.log('[OTLP] Updated .env file with OTLP settings');
        }

        // Monitor status periodically
        setInterval(() => {
            const status = receiver.getStatus();
            if (status.metricsBuffered > 0) {
                console.log(`[OTLP] Status: ${status.metricsBuffered} metrics buffered, last flush: ${status.lastFlush}`);
            }
        }, 30000); // Every 30 seconds

    } catch (error) {
        console.error('[OTLP] Failed to start receiver:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    start().catch((error) => {
        console.error('[OTLP] Failed to start:', error.message);
        console.error('[OTLP] Stack:', error.stack);
        process.exit(1);
    });
}

module.exports = { start };