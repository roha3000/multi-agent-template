#!/usr/bin/env node

/**
 * Quick start script for OTLP services
 */

const OTLPReceiver = require('./.claude/core/otlp-receiver');
const express = require('express');
const path = require('path');
const fs = require('fs');

console.log('🚀 Starting OTLP Services...\n');

// Start OTLP Receiver
const receiver = new OTLPReceiver({
    port: 4318,
    host: '0.0.0.0'
});

receiver.start().then(() => {
    console.log('✅ OTLP Receiver running on http://localhost:4318');
    console.log('   Endpoint: http://localhost:4318/v1/metrics\n');
});

// Start Dashboard Server
const app = express();
const DASHBOARD_PORT = 3030;

// Serve the dashboard UI
const dashboardPath = path.join(__dirname, '.claude/core/web-dashboard-ui.html');

app.get('/', (req, res) => {
    if (fs.existsSync(dashboardPath)) {
        res.sendFile(dashboardPath);
    } else {
        res.send(`
            <h1>Dashboard Starting...</h1>
            <p>OTLP Receiver is running on port 4318</p>
            <p>Configure Claude Code with:</p>
            <pre>
set CLAUDE_CODE_ENABLE_TELEMETRY=1
set OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics
            </pre>
        `);
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        otlpReceiver: receiver.getStatus(),
        timestamp: new Date().toISOString()
    });
});

app.listen(DASHBOARD_PORT, () => {
    console.log(`✅ Dashboard running on http://localhost:${DASHBOARD_PORT}`);
    console.log('   Health check: http://localhost:3030/health\n');
    console.log('📊 To enable Claude Code telemetry, run:');
    console.log('   set CLAUDE_CODE_ENABLE_TELEMETRY=1');
    console.log('   set OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics\n');
    console.log('Press Ctrl+C to stop all services');
});

// Handle shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down services...');
    await receiver.stop();
    process.exit(0);
});