#!/usr/bin/env node

/**
 * Simple dashboard starter - serves the enhanced UI and starts OTLP receiver
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const OTLPReceiver = require('./.claude/core/otlp-receiver');

console.log('🚀 Starting Enhanced Multi-Session Dashboard...\n');

// Create Express app
const app = express();
const PORT = 3030;

// Start OTLP Receiver
const receiver = new OTLPReceiver({
    port: 4318,
    host: '0.0.0.0'
});

// Serve the enhanced dashboard UI
app.get('/', (req, res) => {
    const dashboardPath = path.join(__dirname, '.claude/core/web-dashboard-ui.html');
    if (fs.existsSync(dashboardPath)) {
        // Read and serve the file
        const content = fs.readFileSync(dashboardPath, 'utf8');
        res.send(content);
    } else {
        res.status(404).send('Dashboard UI not found');
    }
});

// API endpoints for dashboard data
app.get('/api/sessions', (req, res) => {
    // Mock data for now - will be populated by OTLP metrics
    res.json({
        sessions: [
            {
                sessionId: 'current-session',
                projectPath: process.cwd(),
                model: 'claude-opus-4.5',
                contextUsage: 71, // Your current usage
                tokensUsed: 141000,
                maxTokens: 200000,
                status: 'active',
                executionPlan: 'Monitoring and documentation',
                lastUpdate: new Date().toISOString()
            }
        ]
    });
});

// SSE endpoint for real-time updates
app.get('/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send initial connection message
    res.write('data: {"type":"connected","message":"SSE connection established"}\n\n');

    // Send periodic updates
    const interval = setInterval(() => {
        const update = {
            type: 'update',
            timestamp: new Date().toISOString(),
            sessions: [{
                sessionId: 'current-session',
                contextUsage: 71,
                tokensUsed: 141000,
                status: 'active'
            }]
        };
        res.write(`data: ${JSON.stringify(update)}\n\n`);
    }, 5000);

    // Clean up on disconnect
    req.on('close', () => {
        clearInterval(interval);
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        dashboard: 'running',
        otlpReceiver: receiver.getStatus(),
        timestamp: new Date().toISOString()
    });
});

// Static files (if any)
app.use('/static', express.static(path.join(__dirname, '.claude/core/static')));

// Start OTLP receiver
receiver.start().then(() => {
    console.log('✅ OTLP Receiver started on http://localhost:4318');
    console.log('   Metrics endpoint: http://localhost:4318/v1/metrics\n');

    // Start Express server
    app.listen(PORT, () => {
        console.log('✅ Enhanced Dashboard running on http://localhost:' + PORT);
        console.log('\n📊 Open your browser to: http://localhost:' + PORT);
        console.log('\n🔧 To enable Claude Code telemetry:');
        console.log('   set CLAUDE_CODE_ENABLE_TELEMETRY=1');
        console.log('   set OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics');
        console.log('\nPress Ctrl+C to stop all services\n');
    });
});

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down services...');
    await receiver.stop();
    process.exit(0);
});