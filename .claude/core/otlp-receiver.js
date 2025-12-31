/**
 * OTLP Receiver for Claude Code Telemetry
 *
 * This module creates an OpenTelemetry OTLP receiver that listens for
 * metrics from Claude Code and integrates them with our UsageTracker.
 *
 * Expected metrics:
 * - claude_code.token.usage (counter with model, type attributes)
 * - claude_code.request.duration (histogram)
 * - claude_code.request.count (counter)
 */

const express = require('express');
const { MeterProvider, PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { Resource } = require('@opentelemetry/resources');
const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
const EventEmitter = require('events');

class OTLPReceiver extends EventEmitter {
    constructor(options = {}) {
        super();

        // Support both old (projectRoot, options) and new (options) signatures
        if (typeof options === 'string') {
            // Old signature: (projectRoot, options)
            this.projectRoot = options;
            options = arguments[1] || {};
        } else {
            // New signature: (options)
            this.projectRoot = options.projectRoot;
        }

        this.port = options.port !== undefined ? options.port : 4318;
        this.host = options.host || 'localhost';
        this.app = express();
        this.server = null;
        this.isRunning = false;

        // Use provided instances (usageTracker is optional - metrics can be handled via events)
        this.usageTracker = options.usageTracker || null;
        this.metricProcessor = options.metricProcessor || null;

        // Metrics storage for processing
        this.metricsBuffer = [];
        this.lastFlush = Date.now();
        this.flushInterval = options.flushInterval || 5000; // Flush every 5 seconds

        // Setup middleware
        this.setupMiddleware();
        this.setupRoutes();

        // Start periodic flush
        this.startPeriodicFlush();
    }

    setupMiddleware() {
        // Parse JSON bodies
        this.app.use(express.json({ limit: '10mb' }));

        // Parse protobuf bodies (OTLP uses protobuf by default)
        this.app.use(express.raw({
            type: 'application/x-protobuf',
            limit: '10mb'
        }));

        // CORS headers for browser-based exporters
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Content-Type, x-requested-with');
            next();
        });

        // Request logging
        this.app.use((req, res, next) => {
            console.log(`[OTLP] ${new Date().toISOString()} ${req.method} ${req.path}`);
            next();
        });
    }

    setupRoutes() {
        // OTLP metrics endpoint (both JSON and protobuf)
        this.app.post('/v1/metrics', this.handleMetrics.bind(this));

        // Legacy collectors endpoint for compatibility
        this.app.post('/v1/collectors/metrics', this.handleMetrics.bind(this));

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'healthy',
                uptime: process.uptime(),
                metricsReceived: this.metricsBuffer.length,
                lastFlush: new Date(this.lastFlush).toISOString()
            });
        });

        // Options for CORS preflight - handle all paths
        this.app.use((req, res, next) => {
            if (req.method === 'OPTIONS') {
                res.sendStatus(204);
            } else {
                next();
            }
        });
    }

    handleMetrics(req, res) {
        try {
            let metricsData;

            // Handle different content types
            if (req.headers['content-type']?.includes('application/json')) {
                metricsData = req.body;
            } else if (req.headers['content-type']?.includes('application/x-protobuf')) {
                // For protobuf, we'd need to decode it
                // For now, we'll focus on JSON format
                console.log('[OTLP] Protobuf format detected - converting to JSON');
                // This is a placeholder - real protobuf handling would require @opentelemetry/otlp-transformer
                res.status(501).json({ error: 'Protobuf not yet implemented, please use JSON format' });
                return;
            } else {
                metricsData = req.body;
            }

            console.log('[OTLP] Received metrics:', JSON.stringify(metricsData, null, 2));

            // Process the metrics
            this.processMetrics(metricsData);

            // Send success response (OTLP expects empty response on success)
            res.status(200).json({});

        } catch (error) {
            console.error('[OTLP] Error handling metrics:', error);
            res.status(500).json({ error: error.message });
        }
    }

    processMetrics(metricsData) {
        // If a metricProcessor is provided, use it
        if (this.metricProcessor) {
            this.metricProcessor.processMetrics(metricsData);
        }

        const processedMetrics = [];

        // OTLP metric structure has resourceMetrics array
        if (metricsData.resourceMetrics) {
            for (const resourceMetric of metricsData.resourceMetrics) {
                // Each resource has scopeMetrics
                if (resourceMetric.scopeMetrics) {
                    for (const scopeMetric of resourceMetric.scopeMetrics) {
                        // Each scope has metrics
                        if (scopeMetric.metrics) {
                            for (const metric of scopeMetric.metrics) {
                                this.processMetric(metric);
                                processedMetrics.push(metric);

                                // Emit individual metric event
                                this.emit('metrics:processed', { metrics: [metric] });
                            }
                        }
                    }
                }
            }
        }

        // Emit batch event
        if (processedMetrics.length > 0) {
            this.emit('metrics:batch', processedMetrics);
        }
    }

    processMetric(metric) {
        console.log(`[OTLP] Processing metric: ${metric.name}`);

        // Handle claude_code.token.usage specifically
        if (metric.name === 'claude_code.token.usage' || metric.name === 'claude_code_token_usage') {
            this.processTokenUsageMetric(metric);
        }
        // Handle request duration
        else if (metric.name === 'claude_code.request.duration' || metric.name === 'claude_code_request_duration') {
            this.processRequestDurationMetric(metric);
        }
        // Handle request count
        else if (metric.name === 'claude_code.request.count' || metric.name === 'claude_code_request_count') {
            this.processRequestCountMetric(metric);
        }
        // Store other metrics for future processing
        else {
            this.metricsBuffer.push({
                timestamp: Date.now(),
                metric: metric
            });
        }
    }

    processTokenUsageMetric(metric) {
        // Extract data points from the metric
        let dataPoints = [];

        // Handle different metric types (gauge, sum, etc.)
        if (metric.sum && metric.sum.dataPoints) {
            dataPoints = metric.sum.dataPoints;
        } else if (metric.gauge && metric.gauge.dataPoints) {
            dataPoints = metric.gauge.dataPoints;
        }

        for (const dataPoint of dataPoints) {
            // Extract attributes (model, type, etc.)
            const attributes = {};
            if (dataPoint.attributes) {
                for (const attr of dataPoint.attributes) {
                    attributes[attr.key] = attr.value?.stringValue || attr.value?.intValue || attr.value?.doubleValue;
                }
            }

            // Extract the token count
            const tokenCount = dataPoint.asInt || dataPoint.asDouble || dataPoint.value || 0;

            console.log(`[OTLP] Token usage: model=${attributes.model}, type=${attributes.type}, count=${tokenCount}`);

            // Track in UsageTracker
            if (attributes.model && attributes.type && tokenCount > 0) {
                this.trackTokenUsage(attributes.model, attributes.type, tokenCount);
            }
        }
    }

    processRequestDurationMetric(metric) {
        // Handle histogram data for request duration
        if (metric.histogram && metric.histogram.dataPoints) {
            for (const dataPoint of metric.histogram.dataPoints) {
                console.log(`[OTLP] Request duration: count=${dataPoint.count}, sum=${dataPoint.sum}ms`);
                // Could track average request time, latency percentiles, etc.
            }
        }
    }

    processRequestCountMetric(metric) {
        // Handle counter for total requests
        let dataPoints = [];
        if (metric.sum && metric.sum.dataPoints) {
            dataPoints = metric.sum.dataPoints;
        }

        for (const dataPoint of dataPoints) {
            const count = dataPoint.asInt || dataPoint.asDouble || dataPoint.value || 0;
            console.log(`[OTLP] Request count: ${count}`);
        }
    }

    async trackTokenUsage(model, type, count) {
        try {
            // Create usage entry
            const usage = {
                orchestrationId: `otlp-${Date.now()}`, // Generate unique ID for each metric
                timestamp: new Date().toISOString(),
                model: model,
                inputTokens: type === 'input' ? count : 0,
                outputTokens: type === 'output' ? count : 0,
                cacheCreationTokens: type === 'cache_creation' ? count : 0,
                cacheReadTokens: type === 'cache_read' ? count : 0,
                metadata: {
                    source: 'otlp',
                    type: type
                }
            };

            // Track the usage if usageTracker is available
            if (this.usageTracker) {
                await this.usageTracker.recordUsage(usage);
            }

            // Always emit event for external handlers (e.g., global-context-manager)
            this.emit('metrics', [{
                name: 'claude_code.token.usage',
                model: model,
                type: type,
                count: count,
                usage: usage
            }]);

            console.log(`[OTLP] Tracked usage: ${model} - ${type}: ${count} tokens`);

        } catch (error) {
            console.error('[OTLP] Error tracking token usage:', error);
        }
    }

    mapTokenType(otlpType) {
        // Map OTLP token types to UsageTracker format
        const typeMap = {
            'input': 'input',
            'output': 'output',
            'cache_read': 'cacheRead',
            'cache_write': 'cacheCreation',
            'cache_creation': 'cacheCreation',
            'total': 'total'
        };

        return typeMap[otlpType.toLowerCase()] || 'input';
    }

    startPeriodicFlush() {
        this.flushTimer = setInterval(() => {
            if (this.metricsBuffer.length > 0) {
                this.flushMetrics();
            }
        }, this.flushInterval);
    }

    flushMetrics() {
        console.log(`[OTLP] Flushing ${this.metricsBuffer.length} buffered metrics`);

        // Process any buffered metrics
        for (const buffered of this.metricsBuffer) {
            // Could batch process or aggregate metrics here
            console.log(`[OTLP] Buffered metric: ${buffered.metric.name}`);
        }

        // Clear buffer
        this.metricsBuffer = [];
        this.lastFlush = Date.now();
    }

    async start() {
        if (this.isRunning) {
            console.log('[OTLP] Receiver already running');
            return;
        }

        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, this.host, () => {
                this.isRunning = true;
                console.log(`[OTLP] Receiver listening on http://${this.host}:${this.port}`);
                console.log('[OTLP] Endpoints:');
                console.log(`  - Metrics: http://${this.host}:${this.port}/v1/metrics`);
                console.log(`  - Health: http://${this.host}:${this.port}/health`);
                resolve();
            });

            this.server.on('error', (error) => {
                this.isRunning = false;
                console.error('[OTLP] Server error:', error);
                reject(error);
            });
        });
    }

    async stop() {
        if (!this.isRunning || !this.server) {
            console.log('[OTLP] Receiver not running');
            return;
        }

        // Stop the flush timer
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }

        // Flush any remaining metrics
        if (this.metricsBuffer.length > 0) {
            this.flushMetrics();
        }

        return new Promise((resolve) => {
            this.server.close(() => {
                this.isRunning = false;
                console.log('[OTLP] Receiver stopped');
                resolve();
            });
        });
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            port: this.port,
            host: this.host,
            metricsBuffered: this.metricsBuffer.length,
            lastFlush: new Date(this.lastFlush).toISOString(),
            uptime: this.isRunning ? process.uptime() : 0
        };
    }
}

module.exports = OTLPReceiver;