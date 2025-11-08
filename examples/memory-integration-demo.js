/**
 * Memory Integration Demo
 *
 * Demonstrates the hybrid hooks + MessageBus architecture with memory persistence.
 *
 * This example shows:
 * 1. How hooks guarantee critical operations (memory save/load)
 * 2. How MessageBus events enable optional features
 * 3. How the system gracefully degrades if components fail
 * 4. How agents benefit from historical context
 */

// Direct imports (core/index.js has circular dependency issues to resolve)
const MessageBus = require('../.claude/core/message-bus');
const Agent = require('../.claude/core/agent');
const AgentOrchestrator = require('../.claude/core/agent-orchestrator');
const MemoryStore = require('../.claude/core/memory-store');

// ============================================================================
// Demo Setup
// ============================================================================

async function runMemoryIntegrationDemo() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Memory Integration Demo - Hybrid Architecture');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Step 1: Create MessageBus
  console.log('📡 Creating MessageBus...');
  const messageBus = new MessageBus();

  // Step 2: Create AgentOrchestrator with memory enabled
  console.log('🎯 Creating AgentOrchestrator with memory...');
  const orchestrator = new AgentOrchestrator(messageBus, {
    enableMemory: true,
    dbPath: '.claude/memory/demo.db',
    enableAI: false  // AI features optional (requires API key)
  });

  console.log('✅ Hybrid architecture initialized!\n');
  console.log('   → Lifecycle hooks: ✓');
  console.log('   → MessageBus events: ✓');
  console.log('   → Memory persistence: ✓\n');

  // Step 3: Create some demo agents
  console.log('🤖 Registering agents...');

  const architectAgent = new Agent({
    id: 'architect',
    role: 'System Architect',
    capabilities: ['system-design', 'architecture', 'scalability'],
    description: 'Designs system architecture and technical solutions'
  });

  const securityAgent = new Agent({
    id: 'security',
    role: 'Security Expert',
    capabilities: ['security', 'authentication', 'encryption'],
    description: 'Ensures security best practices'
  });

  const performanceAgent = new Agent({
    id: 'performance',
    role: 'Performance Engineer',
    capabilities: ['optimization', 'caching', 'performance'],
    description: 'Optimizes system performance'
  });

  // Override execute method for demo
  architectAgent.execute = async (task) => ({
    agentId: 'architect',
    analysis: 'Microservices architecture with API gateway',
    recommendation: 'Use event-driven communication between services',
    timestamp: Date.now()
  });

  securityAgent.execute = async (task) => ({
    agentId: 'security',
    analysis: 'Implement OAuth 2.0 with JWT tokens',
    recommendation: 'Add rate limiting and input validation',
    timestamp: Date.now()
  });

  performanceAgent.execute = async (task) => ({
    agentId: 'performance',
    analysis: 'Add Redis caching layer',
    recommendation: 'Implement database connection pooling',
    timestamp: Date.now()
  });

  orchestrator.registerAgent(architectAgent);
  orchestrator.registerAgent(securityAgent);
  orchestrator.registerAgent(performanceAgent);

  console.log('✅ Agents registered!\n');

  // ============================================================================
  // Demo 1: First Execution (No History)
  // ============================================================================

  console.log('─────────────────────────────────────────────────────────────');
  console.log('📝 DEMO 1: First Execution (No Historical Context)');
  console.log('─────────────────────────────────────────────────────────────\n');

  console.log('Task: Design authentication system\n');
  console.log('Execution flow:');
  console.log('  1. HOOK: beforeExecution → Check for historical context');
  console.log('  2. Execute agents in parallel');
  console.log('  3. HOOK: afterExecution → Ensure memory saved');
  console.log('  4. EVENT: execution:complete → Notify subscribers\n');

  const result1 = await orchestrator.executeParallel(
    ['architect', 'security'],
    {
      description: 'Design authentication system',
      requirements: ['secure', 'scalable', 'user-friendly']
    }
  );

  console.log('✅ Execution complete!\n');
  console.log('Results:');
  console.log(`  → Success: ${result1.success}`);
  console.log(`  → Agents executed: ${result1.results.length}`);
  console.log(`  → Duration: ${result1.duration}ms`);
  console.log(`  → Context loaded: ${result1.metadata.contextLoaded}`);
  console.log('  → Memory saved: ✓ (via hook + event)\n');

  // Wait a moment for async processing
  await delay(100);

  // ============================================================================
  // Demo 2: Second Execution (With History)
  // ============================================================================

  console.log('─────────────────────────────────────────────────────────────');
  console.log('📝 DEMO 2: Second Execution (Historical Context Available)');
  console.log('─────────────────────────────────────────────────────────────\n');

  console.log('Task: Design API authentication (similar to previous)\n');
  console.log('Note: System will find relevant historical context!\n');

  const result2 = await orchestrator.executeParallel(
    ['architect', 'security', 'performance'],
    {
      description: 'Design API authentication with rate limiting',
      requirements: ['secure', 'performant', 'RESTful']
    }
  );

  console.log('✅ Execution complete!\n');
  console.log('Results:');
  console.log(`  → Success: ${result2.success}`);
  console.log(`  → Agents executed: ${result2.results.length}`);
  console.log(`  → Duration: ${result2.duration}ms`);
  console.log(`  → Context loaded: ${result2.metadata.contextLoaded}`);
  console.log('  → Historical context: Available (from Demo 1)\n');

  await delay(100);

  // ============================================================================
  // Demo 3: Query Memory Store
  // ============================================================================

  console.log('─────────────────────────────────────────────────────────────');
  console.log('🔍 DEMO 3: Query Memory Store');
  console.log('─────────────────────────────────────────────────────────────\n');

  const memoryStore = orchestrator.memoryStore;

  // Get all orchestrations
  console.log('Querying all orchestrations...');
  const allOrchestrations = memoryStore.searchOrchestrations({
    limit: 10
  });

  console.log(`\n✅ Found ${allOrchestrations.length} orchestrations:\n`);

  allOrchestrations.forEach((orch, idx) => {
    console.log(`${idx + 1}. Pattern: ${orch.pattern}`);
    console.log(`   Task: ${orch.task.description || 'N/A'}`);
    console.log(`   Agents: ${JSON.parse(orch.agent_ids || '[]').join(', ')}`);
    console.log(`   Success: ${orch.success ? '✓' : '✗'}`);
    console.log(`   Duration: ${orch.duration}ms`);
    console.log(`   Date: ${new Date(orch.timestamp).toLocaleString()}\n`);
  });

  // Get agent statistics
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Agent Performance Statistics:');
  console.log('─────────────────────────────────────────────────────────────\n');

  const agentStats = memoryStore.getAgentStats();

  agentStats.forEach(stats => {
    console.log(`🤖 ${stats.agent_id}:`);
    console.log(`   Total executions: ${stats.total_executions}`);
    console.log(`   Success rate: ${(stats.success_rate * 100).toFixed(1)}%`);
    console.log(`   Avg duration: ${stats.avg_duration?.toFixed(0) || 0}ms`);
    console.log(`   Total tokens: ${stats.total_tokens || 0}\n`);
  });

  // Get pattern statistics
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Pattern Effectiveness:');
  console.log('─────────────────────────────────────────────────────────────\n');

  const patternStats = memoryStore.getPatternStats();

  patternStats.forEach(stats => {
    console.log(`📊 ${stats.pattern}:`);
    console.log(`   Total executions: ${stats.total_executions}`);
    console.log(`   Success rate: ${(stats.success_rate * 100).toFixed(1)}%`);
    console.log(`   Avg duration: ${stats.avg_duration?.toFixed(0) || 0}ms`);
    console.log(`   Avg tokens: ${stats.avg_tokens?.toFixed(0) || 0}\n`);
  });

  // Get database statistics
  console.log('─────────────────────────────────────────────────────────────');
  console.log('Database Statistics:');
  console.log('─────────────────────────────────────────────────────────────\n');

  const dbStats = memoryStore.getStats();
  console.log(`Total orchestrations: ${dbStats.total_orchestrations}`);
  console.log(`Successful: ${dbStats.successful_orchestrations}`);
  console.log(`Observations: ${dbStats.total_observations}`);
  console.log(`Tracked agents: ${dbStats.tracked_agents}`);
  console.log(`Total tokens: ${dbStats.total_tokens || 0}\n`);

  // ============================================================================
  // Demo 4: Lifecycle Hooks Inspection
  // ============================================================================

  console.log('─────────────────────────────────────────────────────────────');
  console.log('🔗 DEMO 4: Lifecycle Hooks Inspection');
  console.log('─────────────────────────────────────────────────────────────\n');

  const hooks = orchestrator.lifecycleHooks;
  const metrics = hooks.getMetrics();

  console.log('Registered hooks:\n');

  Object.keys(hooks.hooks).forEach(hookName => {
    const handlers = hooks.getHandlers(hookName);
    console.log(`${hookName}:`);
    if (handlers.length === 0) {
      console.log('  No handlers registered\n');
    } else {
      handlers.forEach(h => {
        console.log(`  → ${h.name} (priority: ${h.priority}, enabled: ${h.enabled})`);
      });
      console.log('');
    }
  });

  console.log('Hook execution metrics:\n');
  console.log(`Total executions: ${Object.keys(metrics.executions).length} unique hooks`);
  console.log(`Failures: ${Object.keys(metrics.failures).length}`);
  console.log('Success rates:', JSON.stringify(metrics.successRate, null, 2), '\n');

  // ============================================================================
  // Demo 5: Hybrid Architecture Benefits
  // ============================================================================

  console.log('─────────────────────────────────────────────────────────────');
  console.log('💡 DEMO 5: Hybrid Architecture Benefits');
  console.log('─────────────────────────────────────────────────────────────\n');

  console.log('✅ HOOKS Benefits (Critical Operations):');
  console.log('   1. Memory saves are GUARANTEED to complete');
  console.log('   2. Context loading happens BEFORE execution');
  console.log('   3. Errors are CAUGHT and HANDLED properly');
  console.log('   4. Sequential execution with PREDICTABLE ordering\n');

  console.log('✅ EVENTS Benefits (Optional Operations):');
  console.log('   1. AI categorization runs ASYNCHRONOUSLY');
  console.log('   2. Multiple subscribers without BLOCKING');
  console.log('   3. Failures are ISOLATED (no crash)');
  console.log('   4. Third-party integrations DON\'T affect core\n');

  console.log('✅ Combined Benefits:');
  console.log('   1. Critical operations: Reliable (hooks)');
  console.log('   2. Optional operations: Flexible (events)');
  console.log('   3. System continues even if components fail');
  console.log('   4. Best of both reliability models\n');

  // ============================================================================
  // Cleanup
  // ============================================================================

  console.log('─────────────────────────────────────────────────────────────');
  console.log('🧹 Cleanup');
  console.log('─────────────────────────────────────────────────────────────\n');

  orchestrator.destroy();
  memoryStore.close();

  console.log('✅ Demo complete!\n');
  console.log('Memory persisted to: .claude/memory/demo.db');
  console.log('Run this demo again to see historical context in action!\n');

  console.log('═══════════════════════════════════════════════════════════\n');
}

// Helper function
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run demo if executed directly
if (require.main === module) {
  runMemoryIntegrationDemo().catch(error => {
    console.error('Demo failed:', error);
    process.exit(1);
  });
}

module.exports = { runMemoryIntegrationDemo };
