#!/usr/bin/env node

/**
 * Dashboard Backend - Provides API endpoints for the enhanced dashboard
 */

const express = require('express');
const cors = require('cors');
const OTLPReceiver = require('./.claude/core/otlp-receiver');

const app = express();
app.use(cors());
app.use(express.json());

// Start OTLP Receiver
const receiver = new OTLPReceiver({ port: 4318 });
receiver.start().then(() => {
    console.log('✅ OTLP Receiver running on port 4318');
});

// Track sessions and metrics
const sessions = new Map();
const projects = new Map();

// Mock current session with your actual data
const currentSession = {
    sessionId: 'claude-current-' + Date.now(),
    projectPath: process.cwd(),
    projectName: 'multi-agent-template',
    model: 'claude-opus-4.1',
    status: 'active',
    contextUsage: 71,
    tokensUsed: 141000,
    maxTokens: 200000,
    inputTokens: 120000,
    outputTokens: 21000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    executionPlan: 'Setting up OTLP dashboard and monitoring',
    checkpointStatus: 'monitoring',
    lastUpdate: new Date().toISOString()
};

sessions.set(currentSession.sessionId, currentSession);
projects.set(currentSession.projectPath, currentSession.projectName);

// API Endpoints
app.get('/api/sessions', (req, res) => {
    res.json(Array.from(sessions.values()));
});

app.get('/api/sessions/:id', (req, res) => {
    const session = sessions.get(req.params.id);
    if (session) {
        res.json(session);
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

app.get('/api/projects', (req, res) => {
    const projectList = Array.from(projects.entries()).map(([path, name]) => ({
        path,
        name,
        sessions: Array.from(sessions.values()).filter(s => s.projectPath === path)
    }));
    res.json(projectList);
});

app.get('/api/metrics', (req, res) => {
    const totalTokens = Array.from(sessions.values()).reduce((sum, s) => sum + s.tokensUsed, 0);
    const activeSessions = Array.from(sessions.values()).filter(s => s.status === 'active').length;

    res.json({
        totalTokensUsed: totalTokens,
        activeSessions,
        totalSessions: sessions.size,
        totalProjects: projects.size,
        timestamp: new Date().toISOString()
    });
});

// SSE endpoint for real-time updates
app.get('/api/events', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    // Send initial data
    res.write(`data: ${JSON.stringify({
        type: 'init',
        sessions: Array.from(sessions.values()),
        metrics: {
            totalTokensUsed: currentSession.tokensUsed,
            activeSessions: 1
        }
    })}\n\n`);

    // Send updates every 2 seconds
    const interval = setInterval(() => {
        // Simulate token usage increase
        currentSession.tokensUsed += Math.floor(Math.random() * 100);
        currentSession.contextUsage = Math.min(95, currentSession.contextUsage + 0.1);
        currentSession.lastUpdate = new Date().toISOString();

        // Check for checkpoint trigger
        if (currentSession.contextUsage >= 95) {
            currentSession.checkpointStatus = 'triggered';
            currentSession.executionPlan = 'CHECKPOINT: Saving state before compaction';
        } else if (currentSession.contextUsage >= 85) {
            currentSession.checkpointStatus = 'warning';
        }

        res.write(`data: ${JSON.stringify({
            type: 'update',
            session: currentSession,
            metrics: {
                totalTokensUsed: currentSession.tokensUsed,
                contextUsage: currentSession.contextUsage
            }
        })}\n\n`);
    }, 2000);

    // Clean up on disconnect
    req.on('close', () => {
        clearInterval(interval);
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        otlpReceiver: receiver.getStatus(),
        sessions: sessions.size,
        projects: projects.size
    });
});

const PORT = 3032;
app.listen(PORT, () => {
    console.log(`✅ Dashboard Backend API running on port ${PORT}`);
    console.log('\n📊 API Endpoints:');
    console.log(`   http://localhost:${PORT}/api/sessions`);
    console.log(`   http://localhost:${PORT}/api/projects`);
    console.log(`   http://localhost:${PORT}/api/metrics`);
    console.log(`   http://localhost:${PORT}/api/events (SSE)`);
    console.log('\n🎯 Dashboard should now show your session data!');
});