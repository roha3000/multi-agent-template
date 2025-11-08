/**
 * Smart Orchestration Demo
 *
 * Demonstrates context-aware orchestration that automatically chooses
 * between manual pattern selection and intelligent selection
 */

const MessageBus = require('../.claude/core/message-bus');
const SmartOrchestrator = require('../.claude/core/smart-orchestrate');
const Agent = require('../.claude/core/agent');

// Simple demo agent
class DemoAgent extends Agent {
  constructor(id, messageBus, config = {}) {
    super(id, 'Demo Agent', messageBus, config);
    this.expertise = config.expertise || 'general';
  }

  async execute(task, context = {}) {
    this.setState('working');

    try {
      let result;

      // Handle different task phases
      if (task.phase === 'review') {
        result = {
          approvalStatus: 'approved',
          rating: 90,
          comments: [`${this.expertise}: Looks good`]
        };
      } else if (task.phase === 'revise') {
        result = {
          revisedWork: `Revised based on ${task.reviews.length} reviews`,
          improvements: ['clarity', 'structure', 'details']
        };
      } else if (task.type === 'critique') {
        result = {
          critique: `${this.expertise} critique of proposal`,
          suggestions: ['Add detail', 'Clarify approach']
        };
      } else if (task.type === 'synthesize') {
        result = {
          improvedProposal: `Enhanced proposal incorporating critiques`
        };
      } else {
        // Default task execution
        result = {
          findings: [`${this.expertise} finding 1`, `${this.expertise} finding 2`],
          analysis: `${this.expertise} analysis`,
          confidence: 0.85,
          value: this.expertise,      // For consensus
          decision: this.expertise    // For consensus
        };
      }

      this.setState('completed');

      return {
        success: true,
        agentId: this.id,
        role: this.role,
        expertise: this.expertise,
        ...result
      };

    } catch (error) {
      this.setState('failed');
      throw error;
    }
  }
}

async function runDemo() {
  console.log('='.repeat(80));
  console.log('SMART ORCHESTRATION DEMO');
  console.log('Context-aware orchestration with automatic mode selection');
  console.log('='.repeat(80));
  console.log();

  const messageBus = new MessageBus();
  const orchestrator = new SmartOrchestrator(messageBus, {
    preferIntelligent: true,
    logDecisions: true
  });

  // Create demo agents
  const agents = [
    new DemoAgent('agent-1', messageBus, { expertise: 'security' }),
    new DemoAgent('agent-2', messageBus, { expertise: 'compliance' }),
    new DemoAgent('agent-3', messageBus, { expertise: 'architecture' }),
    new DemoAgent('agent-4', messageBus, { expertise: 'performance' })
  ];

  agents.forEach(agent => orchestrator.registerAgent(agent));
  const agentIds = agents.map(a => a.id);

  // ========================================================================
  // MODE 1: MANUAL - Explicit pattern specified
  // ========================================================================
  console.log('='.repeat(80));
  console.log('MODE 1: MANUAL ORCHESTRATION');
  console.log('User explicitly specifies the pattern');
  console.log('='.repeat(80));
  console.log();

  console.log('Scenario: Explicit pattern = "parallel"\n');

  const manualResult = await orchestrator.orchestrate(
    agentIds,
    {
      type: 'analyze',
      topic: 'System security review',
      depth: 'comprehensive'
    },
    {
      pattern: 'parallel'  // ← Explicit pattern
    }
  );

  console.log('Result:');
  console.log(`  Mode: ${manualResult.orchestrationMode}`);
  console.log(`  Pattern: ${manualResult.pattern}`);
  console.log(`  Success: ${manualResult.success}`);
  console.log(`  Agents: ${manualResult.results.length} successful`);
  console.log(`  Duration: ${manualResult.totalDuration}ms`);
  console.log();

  // ========================================================================
  // MODE 2: INTELLIGENT - Natural language prompt
  // ========================================================================
  console.log('='.repeat(80));
  console.log('MODE 2: INTELLIGENT ORCHESTRATION');
  console.log('System analyzes natural language prompt and selects pattern');
  console.log('='.repeat(80));
  console.log();

  console.log('Scenario 2a: "Have all agents vote on the best approach"\n');

  const intelligentResult1 = await orchestrator.orchestrate(
    agentIds,
    {
      type: 'decide',
      question: 'Best authentication method',
      options: ['OAuth2', 'JWT', 'SAML']
    },
    {
      prompt: 'Have all agents vote on the best approach'  // ← Natural language
    }
  );

  console.log('Result:');
  console.log(`  Mode: ${intelligentResult1.orchestrationMode}`);
  console.log(`  Pattern: ${intelligentResult1.pattern}`);
  console.log(`  Pattern Confidence: ${(intelligentResult1.patternConfidence * 100).toFixed(1)}%`);
  console.log(`  Success: ${intelligentResult1.success}`);
  console.log(`  Duration: ${intelligentResult1.totalDuration}ms`);
  console.log();

  console.log('Scenario 2b: "Research this from multiple expert perspectives"\n');

  const intelligentResult2 = await orchestrator.orchestrate(
    agentIds.slice(0, 3),
    {
      type: 'research',
      topic: 'Zero-knowledge proof systems',
      focus: 'practical implementation'
    },
    {
      prompt: 'Research this from multiple expert perspectives'
    }
  );

  console.log('Result:');
  console.log(`  Mode: ${intelligentResult2.orchestrationMode}`);
  console.log(`  Pattern: ${intelligentResult2.pattern}`);
  console.log(`  Pattern Confidence: ${(intelligentResult2.patternConfidence * 100).toFixed(1)}%`);
  console.log(`  Success: ${intelligentResult2.success}`);
  console.log(`  Agents: ${intelligentResult2.results.length} successful`);
  console.log(`  Duration: ${intelligentResult2.totalDuration}ms`);
  console.log();

  // ========================================================================
  // MODE 3: AUTO - Inferred from task structure
  // ========================================================================
  console.log('='.repeat(80));
  console.log('MODE 3: AUTO ORCHESTRATION');
  console.log('System infers pattern from task type and structure');
  console.log('='.repeat(80));
  console.log();

  console.log('Scenario 3a: Task type = "research" → Infers parallel pattern\n');

  const autoResult1 = await orchestrator.orchestrate(
    agentIds,
    {
      type: 'research',  // ← System infers parallel from this
      topic: 'HIPAA compliance requirements',
      depth: 'comprehensive'
    }
  );

  console.log('Result:');
  console.log(`  Mode: ${autoResult1.orchestrationMode}`);
  console.log(`  Pattern: ${autoResult1.pattern} (inferred from task.type)`);
  console.log(`  Success: ${autoResult1.success}`);
  console.log(`  Agents: ${autoResult1.results.length} successful`);
  console.log(`  Duration: ${autoResult1.totalDuration}ms`);
  console.log();

  console.log('Scenario 3b: Task type = "decide" → Infers consensus pattern\n');

  const autoResult2 = await orchestrator.orchestrate(
    agentIds,
    {
      type: 'decide',  // ← System infers consensus from this
      question: 'Which database to use?',
      options: ['PostgreSQL', 'MongoDB', 'DynamoDB']
    }
  );

  console.log('Result:');
  console.log(`  Mode: ${autoResult2.orchestrationMode}`);
  console.log(`  Pattern: ${autoResult2.pattern} (inferred from task.type)`);
  console.log(`  Success: ${autoResult2.success}`);
  console.log(`  Duration: ${autoResult2.totalDuration}ms`);
  console.log();

  console.log('Scenario 3c: Task with description → Uses intelligent mode\n');

  const autoResult3 = await orchestrator.orchestrate(
    agentIds.slice(0, 3),
    {
      type: 'create',
      description: 'Have one agent create the API design and others review it',
      feature: 'User authentication API'
    }
  );

  console.log('Result:');
  console.log(`  Mode: ${autoResult3.orchestrationMode}`);
  console.log(`  Pattern: ${autoResult3.pattern} (detected from description)`);
  console.log(`  Success: ${autoResult3.success}`);
  console.log(`  Duration: ${autoResult3.totalDuration}ms`);
  console.log();

  // ========================================================================
  // PATTERN SUGGESTION (without execution)
  // ========================================================================
  console.log('='.repeat(80));
  console.log('PATTERN SUGGESTION');
  console.log('Get suggestions without executing');
  console.log('='.repeat(80));
  console.log();

  const suggestion1 = orchestrator.suggest(
    agentIds,
    { type: 'research', topic: 'Market analysis' },
    { prompt: 'Gather insights from all experts simultaneously' }
  );

  console.log('Suggestion for: "Gather insights from all experts simultaneously"');
  console.log(`  Mode: ${suggestion1.mode}`);
  console.log(`  Pattern: ${suggestion1.suggestion.pattern}`);
  console.log(`  Confidence: ${(suggestion1.suggestion.confidence * 100).toFixed(1)}%`);
  console.log(`  Reasoning: ${suggestion1.suggestion.reasoning}`);
  console.log();

  const suggestion2 = orchestrator.suggest(
    agentIds,
    { type: 'refine', proposal: 'Initial architecture' }
  );

  console.log('Suggestion for: Task type = "refine"');
  console.log(`  Mode: ${suggestion2.mode}`);
  console.log(`  Pattern: ${suggestion2.pattern}`);
  console.log(`  Reasoning: ${suggestion2.reasoning}`);
  console.log();

  // ========================================================================
  // COMPARISON TABLE
  // ========================================================================
  console.log('='.repeat(80));
  console.log('MODE COMPARISON SUMMARY');
  console.log('='.repeat(80));
  console.log();

  console.log('┌─────────────┬─────────────────────────┬──────────────────────────────┐');
  console.log('│ Mode        │ Trigger                 │ Best For                     │');
  console.log('├─────────────┼─────────────────────────┼──────────────────────────────┤');
  console.log('│ MANUAL      │ pattern: "parallel"     │ Precise control needed       │');
  console.log('│ INTELLIGENT │ prompt: "vote on..."    │ Natural language input       │');
  console.log('│ AUTO        │ type: "research"        │ Structured tasks             │');
  console.log('└─────────────┴─────────────────────────┴──────────────────────────────┘');
  console.log();

  console.log('Usage recommendations:');
  console.log('  • Use MANUAL when you know exactly which pattern you need');
  console.log('  • Use INTELLIGENT when working with natural language prompts');
  console.log('  • Use AUTO for programmatic tasks with clear types');
  console.log();

  // Cleanup
  console.log('='.repeat(80));
  console.log('Demo complete!');
  console.log('='.repeat(80));

  orchestrator.destroy();
  messageBus.clear();
}

// Run the demo
if (require.main === module) {
  runDemo().catch(error => {
    console.error('Demo failed:', error);
    process.exit(1);
  });
}

module.exports = { runDemo };
