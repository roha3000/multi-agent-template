/**
 * Complete Intelligence Layer Demo
 *
 * Demonstrates the fully integrated memory-enabled multi-agent system with:
 * - VectorStore for semantic search
 * - ContextRetriever for progressive disclosure
 * - AICategorizationService for observation extraction
 * - MemorySearchAPI for rich querying
 * - PatternRecommender for intelligent orchestration
 *
 * This is the culmination of Sessions 1-3 implementation.
 */

const path = require('path');
const {
  MessageBus,
  AgentOrchestrator,
  Agent,
  LifecycleHooks,
  MemoryStore,
  MemoryIntegration,
  VectorStore,
  ContextRetriever,
  MemorySearchAPI,
  PatternRecommender
} = require('../.claude/core');

// Demo configuration
const DEMO_CONFIG = {
  dbPath: path.join(__dirname, '../.claude/memory/demo.db'),
  enableAI: false, // Set to true if you have ANTHROPIC_API_KEY
  verbose: true
};

console.log('═══════════════════════════════════════════════════');
console.log('  Complete Intelligence Layer Demo');
console.log('═══════════════════════════════════════════════════\n');

/**
 * Example agents for demonstration
 */
class ResearchAgent extends Agent {
  constructor(id) {
    super({ agentId: id, role: 'research' });
  }

  async process(task) {
    console.log(`\n🔍 [ResearchAgent] Researching: ${task.substring(0, 60)}...`);
    await this._simulateWork(1000);
    return {
      findings: `Research completed on: ${task}`,
      insights: ['Pattern A looks promising', 'Similar to previous work', 'Scalable approach'],
      confidence: 0.85
    };
  }

  async _simulateWork(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class DesignAgent extends Agent {
  constructor(id) {
    super({ agentId: id, role: 'design' });
  }

  async process(task) {
    console.log(`\n🎨 [DesignAgent] Designing: ${task.substring(0, 60)}...`);
    await this._simulateWork(800);
    return {
      design: `Architecture for: ${task}`,
      components: ['API Layer', 'Business Logic', 'Data Store'],
      scalability: 'high'
    };
  }

  async _simulateWork(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class ImplementAgent extends Agent {
  constructor(id) {
    super({ agentId: id, role: 'implementation' });
  }

  async process(task) {
    console.log(`\n⚡ [ImplementAgent] Implementing: ${task.substring(0, 60)}...`);
    await this._simulateWork(1200);
    return {
      implementation: `Code for: ${task}`,
      files: ['module.js', 'test.js', 'README.md'],
      linesOfCode: 450
    };
  }

  async _simulateWork(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Demo orchestrations
 */
async function runOrchestrations(orchestrator, memoryIntegration) {
  console.log('\n📋 Phase 1: Running Initial Orchestrations\n');
  console.log('─'.repeat(50));

  const tasks = [
    'Build authentication system with JWT and OAuth',
    'Design REST API for user management',
    'Implement real-time notifications',
    'Create admin dashboard with analytics',
    'Build payment integration system'
  ];

  for (const task of tasks) {
    console.log(`\n✨ Orchestrating: "${task}"`);

    // Get pattern recommendation
    const recommendation = await memoryIntegration.recommendPattern(task, {
      availableAgents: ['researcher', 'designer', 'implementer'],
      priority: 'quality'
    });

    console.log(`   📊 Recommended pattern: ${recommendation.recommendation.pattern}`);
    console.log(`   ✓  Confidence: ${recommendation.recommendation.confidence}`);
    console.log(`   ⚡ Reasoning: ${recommendation.recommendation.reasoning[0]}`);

    // Execute with recommended pattern
    const pattern = recommendation.recommendation.pattern;
    try {
      const result = await orchestrator.execute(pattern, ['researcher', 'designer', 'implementer'], task);
      console.log(`   ✅ Orchestration completed successfully`);
    } catch (error) {
      console.log(`   ❌ Orchestration failed: ${error.message}`);
    }

    // Small delay between orchestrations
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

/**
 * Demo memory search and analysis
 */
async function demonstrateMemorySearch(memoryIntegration) {
  console.log('\n\n📊 Phase 2: Memory Search & Analysis\n');
  console.log('─'.repeat(50));

  // 1. Search by keyword
  console.log('\n🔍 Searching for "authentication" orchestrations...');
  const authResults = await memoryIntegration.searchOrchestrations('authentication', {
    limit: 3
  });
  console.log(`   Found ${authResults.length} results`);
  authResults.forEach((r, i) => {
    console.log(`   ${i + 1}. [${r.pattern}] ${r.task.substring(0, 50)}...`);
  });

  // 2. Get recent context
  console.log('\n📅 Getting recent context (last 24 hours)...');
  const recent = await memoryIntegration.getRecentContext({ hours: 24 });
  console.log(`   Total orchestrations: ${recent.totalFound}`);
  console.log(`   Success rate: ${recent.successRate}%`);
  console.log(`   Trending patterns: ${recent.trendingPatterns.map(p => p.pattern).join(', ')}`);

  // 3. Get memory stats
  console.log('\n📈 Overall memory statistics:');
  const stats = memoryIntegration.getStats();
  console.log(`   Memory store active: ${!!stats.memoryStore}`);
  console.log(`   Vector store enabled: ${stats.vectorStoreEnabled}`);
  console.log(`   Context retriever enabled: ${stats.contextRetrieverEnabled}`);
  console.log(`   Search API enabled: ${stats.searchAPIEnabled}`);
  console.log(`   Pattern recommender enabled: ${stats.patternRecommenderEnabled}`);
}

/**
 * Demo pattern recommendations
 */
async function demonstratePatternRecommendation(memoryIntegration) {
  console.log('\n\n🎯 Phase 3: Pattern Recommendation System\n');
  console.log('─'.repeat(50));

  const newTask = 'Implement secure file upload system with virus scanning';

  console.log(`\n📝 Task: "${newTask}"`);
  console.log('\nAnalyzing best pattern based on historical data...');

  const recommendation = await memoryIntegration.recommendPattern(newTask, {
    availableAgents: ['researcher', 'designer', 'implementer', 'tester'],
    priority: 'quality',
    minSuccessRate: 0.7
  });

  console.log(`\n✨ Recommendation Results:`);
  console.log(`   🏆 Best Pattern: ${recommendation.recommendation.pattern}`);
  console.log(`   📊 Score: ${recommendation.recommendation.score.toFixed(2)}/10`);
  console.log(`   🎯 Confidence: ${recommendation.recommendation.confidence}`);
  console.log(`\n   💡 Reasoning:`);
  recommendation.recommendation.reasoning.forEach((reason, i) => {
    console.log(`      ${i + 1}. ${reason}`);
  });

  console.log(`\n   🔄 Alternatives:`);
  recommendation.alternatives.forEach((alt, i) => {
    console.log(`      ${i + 1}. ${alt.pattern} (score: ${alt.score.toFixed(2)})`);
  });

  // Get team recommendation
  console.log(`\n👥 Team Recommendation:`);
  const teamRec = await memoryIntegration.recommendTeam(newTask, {
    availableAgents: ['researcher', 'designer', 'implementer', 'tester'],
    minAgents: 2,
    maxAgents: 4,
    pattern: recommendation.recommendation.pattern
  });

  console.log(`   Recommended team: ${teamRec.recommendation.join(', ')}`);
  console.log(`   Confidence: ${teamRec.confidence}`);
  console.log(`   Reasoning: ${teamRec.reasoning[0]}`);
}

/**
 * Demo success prediction
 */
async function demonstrateSuccessPrediction(memoryIntegration) {
  console.log('\n\n🔮 Phase 4: Success Rate Prediction\n');
  console.log('─'.repeat(50));

  const testCases = [
    { pattern: 'parallel', agents: ['researcher', 'designer'], task: 'Build API endpoint' },
    { pattern: 'consensus', agents: ['researcher', 'designer', 'implementer'], task: 'Design system architecture' },
    { pattern: 'debate', agents: ['researcher', 'designer'], task: 'Choose technology stack' }
  ];

  for (const testCase of testCases) {
    console.log(`\n📊 Predicting: ${testCase.pattern} with [${testCase.agents.join(', ')}]`);
    console.log(`   Task: "${testCase.task}"`);

    const prediction = await memoryIntegration.predictSuccess(
      testCase.pattern,
      testCase.agents,
      testCase.task
    );

    console.log(`   🎯 Predicted success rate: ${(prediction.predictedSuccessRate * 100).toFixed(1)}%`);
    console.log(`   📈 Confidence: ${prediction.confidence}`);

    if (prediction.factors && prediction.factors.length > 0) {
      console.log(`   📊 Contributing factors:`);
      prediction.factors.forEach(f => {
        console.log(`      • ${f.factor}: ${(f.value * 100).toFixed(0)}% (weight: ${f.weight})`);
      });
    }

    if (prediction.recommendations && prediction.recommendations.length > 0) {
      console.log(`   💡 Recommendations:`);
      prediction.recommendations.slice(0, 2).forEach(r => {
        console.log(`      • ${r}`);
      });
    }
  }
}

/**
 * Demo context retrieval
 */
async function demonstrateContextRetrieval(memoryIntegration) {
  console.log('\n\n🧠 Phase 5: Progressive Context Retrieval\n');
  console.log('─'.repeat(50));

  const query = 'authentication system';
  console.log(`\n🔍 Retrieving context for: "${query}"`);

  // This would normally be done internally by MemoryIntegration
  // Here we demonstrate it explicitly for the demo
  if (memoryIntegration.contextRetriever) {
    const context = await memoryIntegration.contextRetriever.retrieveContext(query, {
      maxTokens: 1000,
      includeDetails: true
    });

    console.log(`\n✨ Context Retrieved:`);
    console.log(`   📄 Relevant orchestrations: ${context.relevantOrchestrations?.length || 0}`);
    console.log(`   🎫 Token cost: ${context.tokenCost}`);
    console.log(`   ⚡ Cache hit: ${context.fromCache ? 'Yes' : 'No'}`);

    if (context.relevantOrchestrations && context.relevantOrchestrations.length > 0) {
      console.log(`\n   📋 Top results:`);
      context.relevantOrchestrations.slice(0, 3).forEach((orch, i) => {
        console.log(`      ${i + 1}. [${orch.pattern}] ${orch.task?.substring(0, 45)}...`);
        console.log(`         Success: ${orch.success ? '✓' : '✗'}, Duration: ${orch.duration}ms`);
      });
    }
  } else {
    console.log('   ⚠️  ContextRetriever not available (graceful degradation)');
  }
}

/**
 * Main demo runner
 */
async function runDemo() {
  let messageBus, lifecycleHooks, memoryStore, memoryIntegration, orchestrator;

  try {
    // Initialize components
    console.log('🔧 Initializing intelligence layer components...\n');

    messageBus = new MessageBus();
    lifecycleHooks = new LifecycleHooks();
    memoryStore = new MemoryStore(DEMO_CONFIG.dbPath);

    memoryIntegration = new MemoryIntegration(messageBus, memoryStore, {
      enableAI: DEMO_CONFIG.enableAI,
      aiApiKey: process.env.ANTHROPIC_API_KEY,
      enableVectorStore: true,
      enableContextRetrieval: true
    });

    // Set up lifecycle hooks
    memoryIntegration.setupLifecycleHooks(lifecycleHooks);

    // Create orchestrator
    orchestrator = new AgentOrchestrator(messageBus, lifecycleHooks);

    // Register agents
    const researcher = new ResearchAgent('researcher');
    const designer = new DesignAgent('designer');
    const implementer = new ImplementAgent('implementer');

    orchestrator.registerAgent(researcher);
    orchestrator.registerAgent(designer);
    orchestrator.registerAgent(implementer);

    console.log('✅ All components initialized successfully!\n');

    // Run demo phases
    await runOrchestrations(orchestrator, memoryIntegration);
    await demonstrateMemorySearch(memoryIntegration);
    await demonstratePatternRecommendation(memoryIntegration);
    await demonstrateSuccessPrediction(memoryIntegration);
    await demonstrateContextRetrieval(memoryIntegration);

    console.log('\n\n═══════════════════════════════════════════════════');
    console.log('  ✨ Demo Complete! ✨');
    console.log('═══════════════════════════════════════════════════');
    console.log('\n📚 What you just saw:');
    console.log('   • Memory-enabled orchestrations');
    console.log('   • Intelligent pattern recommendations');
    console.log('   • Historical context retrieval');
    console.log('   • Success rate predictions');
    console.log('   • Semantic search capabilities');
    console.log('   • Progressive disclosure');
    console.log('\n🎯 Key Features Demonstrated:');
    console.log('   ✓ VectorStore for semantic search');
    console.log('   ✓ ContextRetriever for token-efficient context');
    console.log('   ✓ MemorySearchAPI for rich querying');
    console.log('   ✓ PatternRecommender for intelligent selection');
    console.log('   ✓ Graceful degradation at every layer');
    console.log('\n💡 This is a production-ready memory-enabled multi-agent system!');
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Demo error:', error);
    console.error(error.stack);
  } finally {
    // Cleanup
    if (memoryIntegration) {
      memoryIntegration.close();
    }
    if (orchestrator) {
      // Give time for async operations to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    process.exit(0);
  }
}

// Run the demo
if (require.main === module) {
  runDemo().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runDemo };
