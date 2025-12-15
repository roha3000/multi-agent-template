#!/usr/bin/env node

/**
 * Test OTLP Metrics Sender
 *
 * Sends sample metrics to the OTLP receiver to verify it's working correctly.
 * This simulates what Claude Code would send.
 */

const axios = require('axios');

// OTLP endpoint
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
const METRICS_URL = `${OTLP_ENDPOINT}/v1/metrics`;

// Sample OTLP metrics payload (JSON format)
function createSampleMetrics() {
    const now = Date.now() * 1000000; // nanoseconds

    return {
        resourceMetrics: [{
            resource: {
                attributes: [{
                    key: 'service.name',
                    value: { stringValue: 'claude-code' }
                }, {
                    key: 'service.version',
                    value: { stringValue: '1.0.0' }
                }]
            },
            scopeMetrics: [{
                scope: {
                    name: 'claude-code-metrics',
                    version: '1.0.0'
                },
                metrics: [
                    // Token usage metric
                    {
                        name: 'claude_code.token.usage',
                        description: 'Token usage by model and type',
                        unit: 'tokens',
                        sum: {
                            dataPoints: [
                                {
                                    attributes: [
                                        { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
                                        { key: 'type', value: { stringValue: 'input' } }
                                    ],
                                    startTimeUnixNano: now - 5000000000, // 5 seconds ago
                                    timeUnixNano: now,
                                    asInt: 1250
                                },
                                {
                                    attributes: [
                                        { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
                                        { key: 'type', value: { stringValue: 'output' } }
                                    ],
                                    startTimeUnixNano: now - 5000000000,
                                    timeUnixNano: now,
                                    asInt: 875
                                },
                                {
                                    attributes: [
                                        { key: 'model', value: { stringValue: 'claude-opus-4-5-20251101' } },
                                        { key: 'type', value: { stringValue: 'cache_read' } }
                                    ],
                                    startTimeUnixNano: now - 5000000000,
                                    timeUnixNano: now,
                                    asInt: 320
                                }
                            ],
                            aggregationTemporality: 2, // Cumulative
                            isMonotonic: true
                        }
                    },
                    // Request duration histogram
                    {
                        name: 'claude_code.request.duration',
                        description: 'Request duration in milliseconds',
                        unit: 'ms',
                        histogram: {
                            dataPoints: [{
                                attributes: [
                                    { key: 'model', value: { stringValue: 'claude-3-opus-20240229' } }
                                ],
                                startTimeUnixNano: now - 5000000000,
                                timeUnixNano: now,
                                count: 3,
                                sum: 4500, // Total of 3 requests
                                bucketCounts: [0, 1, 1, 1, 0, 0], // Distribution across buckets
                                explicitBounds: [100, 500, 1000, 2000, 5000] // Bucket boundaries
                            }],
                            aggregationTemporality: 2 // Cumulative
                        }
                    },
                    // Request count
                    {
                        name: 'claude_code.request.count',
                        description: 'Total number of requests',
                        unit: 'requests',
                        sum: {
                            dataPoints: [{
                                attributes: [
                                    { key: 'model', value: { stringValue: 'claude-3-opus-20240229' } },
                                    { key: 'status', value: { stringValue: 'success' } }
                                ],
                                startTimeUnixNano: now - 5000000000,
                                timeUnixNano: now,
                                asInt: 3
                            }],
                            aggregationTemporality: 2,
                            isMonotonic: true
                        }
                    }
                ]
            }]
        }]
    };
}

// Send metrics to OTLP receiver
async function sendMetrics() {
    try {
        const metrics = createSampleMetrics();

        console.log('Sending test metrics to:', METRICS_URL);
        console.log('Payload:', JSON.stringify(metrics, null, 2));

        const response = await axios.post(METRICS_URL, metrics, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('Response status:', response.status);
        console.log('Response data:', response.data);
        console.log('\nMetrics sent successfully!');

        // Calculate what should be tracked
        console.log('\nExpected tracking:');
        console.log('- Input tokens: 1250');
        console.log('- Output tokens: 875');
        console.log('- Cache read tokens: 320');
        console.log('- Total tokens: 2445');
        console.log('- Request count: 3');
        console.log('- Average duration: 1500ms');

    } catch (error) {
        if (error.response) {
            console.error('Error response:', error.response.status, error.response.data);
        } else if (error.request) {
            console.error('No response received. Is the OTLP receiver running?');
            console.error('Start it with: npm run otlp:start');
        } else {
            console.error('Error:', error.message);
        }
        process.exit(1);
    }
}

// Simulate continuous metrics (optional)
async function continuousMetrics(interval = 10000) {
    console.log(`Sending metrics every ${interval/1000} seconds. Press Ctrl+C to stop.\n`);

    // Send initial metrics
    await sendMetrics();

    // Send periodic metrics
    setInterval(async () => {
        console.log('\n--- Sending periodic metrics ---');
        await sendMetrics();
    }, interval);
}

// Parse command line arguments
const args = process.argv.slice(2);
const continuous = args.includes('--continuous') || args.includes('-c');
const interval = parseInt(args.find(arg => arg.startsWith('--interval='))?.split('=')[1] || '10000');

// Main
async function main() {
    console.log('=====================================');
    console.log('  OTLP Metrics Test Sender');
    console.log('=====================================\n');

    // Check if axios is installed
    try {
        require.resolve('axios');
    } catch (e) {
        console.log('Installing axios...');
        require('child_process').execSync('npm install axios', { stdio: 'inherit' });
    }

    if (continuous) {
        await continuousMetrics(interval);
    } else {
        await sendMetrics();
        console.log('\nUse --continuous flag to send metrics continuously');
    }
}

// Run if executed directly
if (require.main === module) {
    main().catch(console.error);
}

module.exports = { sendMetrics, createSampleMetrics };