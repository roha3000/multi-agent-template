/**
 * Intelligent Orchestration Demo
 *
 * Demonstrates automatic pattern selection based on user prompts
 */

const MessageBus = require('../.claude/core/message-bus');
const IntelligentOrchestrator = require('../.claude/core/intelligent-orchestrator');
const Agent = require('../.claude/core/agent');

// Create a simple research agent for demo
class ResearchAgent extends Agent {
  constructor(id, messageBus, config = {}) {
    super(id, 'Researcher', messageBus, config);
    this.expertise = config.expertise || 'general';
  }

  async execute(task, context = {}) {
    this.setState('working');

    try {
      // Simulate different behaviors based on task phase
      let result;

      if (task.phase === 'review') {
        // Acting as reviewer
        result = {
          approvalStatus: 'approved-with-comments',
          comments: [`${this.expertise} perspective: Good work, minor improvements needed`],
          rating: 85
        };
      } else if (task.phase === 'revise') {
        // Acting as creator revising
        result = {
          revisedWork: `Improved implementation incorporating ${task.reviews.length} reviews`,
          changesApplied: task.reviews.length
        };
      } else if (task.type === 'critique') {
        // Critique mode for debate
        result = {
          critique: `From ${this.expertise} perspective: ${task.proposal.slice(0, 50)}... needs refinement`,
          suggestions: ['Improve clarity', 'Add more details', 'Consider edge cases']
        };
      } else if (task.type === 'synthesize') {
        // Synthesize critiques
        result = {
          improvedProposal: `Enhanced proposal based on ${task.critiques.length} critiques: ${task.proposal}`
        };
      } else {
        // Default research task
        result = {
          findings: [
            `${this.expertise} finding 1`,
            `${this.expertise} finding 2`,
            `${this.expertise} finding 3`
          ],
          confidence: 0.85,
          value: this.expertise, // For consensus voting
          decision: this.expertise // For consensus voting
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

// Demo scenarios
async function runDemo() {
  console.log('='.repeat(80));
  console.log('INTELLIGENT ORCHESTRATION DEMO');
  console.log('Automatic pattern selection based on user prompts');
  console.log('='.repeat(80));
  console.log();

  const messageBus = new MessageBus();
  const orchestrator = new IntelligentOrchestrator(messageBus);

  // Create research agents
  const agents = [
    new ResearchAgent('tech-researcher', messageBus, { expertise: 'technology' }),
    new ResearchAgent('business-researcher', messageBus, { expertise: 'business' }),
    new ResearchAgent('legal-researcher', messageBus, { expertise: 'legal' }),
    new ResearchAgent('security-researcher', messageBus, { expertise: 'security' })
  ];

  agents.forEach(agent => orchestrator.registerAgent(agent));

  const agentIds = agents.map(a => a.id);

  // Scenario 1: Parallel Pattern (comprehensive research)
  await runScenario(
    'Scenario 1: Parallel Pattern',
    'Research HIPAA compliance from multiple expert perspectives simultaneously',
    orchestrator,
    agentIds,
    {
      type: 'research',
      topic: 'HIPAA compliance requirements',
      depth: 'comprehensive'
    }
  );

  // Scenario 2: Consensus Pattern (decision making)
  await runScenario(
    'Scenario 2: Consensus Pattern',
    'Have all agents vote on which encryption standard is best',
    orchestrator,
    agentIds,
    {
      type: 'decide',
      question: 'Best encryption standard for PHI',
      options: ['AES-256', 'RSA-2048', 'ChaCha20']
    }
  );

  // Scenario 3: Debate Pattern (iterative refinement)
  await runScenario(
    'Scenario 3: Debate Pattern',
    'Debate and refine the proposed data architecture over 3 rounds',
    orchestrator,
    agentIds.slice(0, 3), // Use 3 agents for debate
    {
      type: 'debate',
      initialProposal: 'Use microservices architecture with event-driven communication'
    }
  );

  // Scenario 4: Review Pattern (create and critique)
  await runScenario(
    'Scenario 4: Review Pattern',
    'Have one agent create implementation and others review it with 2 revision rounds',
    orchestrator,
    agentIds.slice(0, 3), // Creator + 2 reviewers
    {
      type: 'implement',
      feature: 'User authentication module',
      requirements: ['JWT tokens', 'Rate limiting', 'Audit logging']
    }
  );

  // Scenario 5: Ensemble Pattern (best of multiple)
  await runScenario(
    'Scenario 5: Ensemble Pattern',
    'Run all agents and pick the best risk assessment result',
    orchestrator,
    agentIds,
    {
      type: 'risk-assessment',
      scenario: 'Data breach involving PHI',
      criteria: ['severity', 'likelihood', 'impact']
    }
  );

  // Scenario 6: Low confidence - needs user confirmation
  console.log('\n' + '='.repeat(80));
  console.log('Scenario 6: Low Confidence (Ambiguous Prompt)');
  console.log('='.repeat(80));

  const ambiguousPrompt = 'Do something with the data';
  console.log(`\nPrompt: "${ambiguousPrompt}"\n`);

  const suggestion = orchestrator.suggestPattern(ambiguousPrompt, {
    agentCount: agentIds.length
  });

  console.log('Pattern Selection:');
  console.log(`  Pattern: ${suggestion.pattern || 'NONE'}`);
  console.log(`  Confidence: ${(suggestion.confidence * 100).toFixed(1)}%`);
  console.log(`  Status: ${suggestion.confidence >= 0.6 ? 'AUTO-SELECT' : 'NEEDS CONFIRMATION'}`);

  if (suggestion.suggestions.length > 0) {
    console.log('\nAlternative Suggestions:');
    suggestion.suggestions.forEach((s, idx) => {
      console.log(`  ${idx + 1}. ${s.name} (${(s.confidence * 100).toFixed(1)}%)`);
    });
  }

  // Cleanup
  console.log('\n' + '='.repeat(80));
  console.log('Demo complete!');
  console.log('='.repeat(80));

  orchestrator.destroy();
  messageBus.clear();
}

async function runScenario(title, prompt, orchestrator, agentIds, task) {
  console.log('\n' + '='.repeat(80));
  console.log(title);
  console.log('='.repeat(80));
  console.log(`\nPrompt: "${prompt}"\n`);

  // First, show what pattern was selected
  const suggestion = orchestrator.suggestPattern(prompt, {
    agentCount: agentIds.length,
    taskType: task.type
  });

  console.log('Pattern Selection:');
  console.log(`  Pattern: ${suggestion.pattern}`);
  console.log(`  Name: ${suggestion.patternName}`);
  console.log(`  Confidence: ${(suggestion.confidence * 100).toFixed(1)}%`);
  console.log(`  Reasoning: ${suggestion.reasoning}`);

  if (suggestion.recommendedConfig && suggestion.recommendedConfig.description) {
    console.log(`  Config: ${suggestion.recommendedConfig.description}`);
  }

  // Execute with intelligent orchestration
  console.log('\nExecuting...');

  try {
    const result = await orchestrator.execute(prompt, agentIds, task);

    console.log('\nExecution Result:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Pattern Used: ${result.pattern}`);
    console.log(`  Duration: ${result.totalDuration}ms`);

    // Show pattern-specific results
    switch (result.pattern) {
      case 'parallel':
        console.log(`  Successful Agents: ${result.results.length}`);
        console.log(`  Failed Agents: ${result.failures.length}`);
        break;

      case 'consensus':
        console.log(`  Consensus Reached: ${result.success}`);
        console.log(`  Confidence: ${(result.vote.confidence * 100).toFixed(1)}%`);
        if (result.vote.winner) {
          console.log(`  Decision: ${result.vote.winner}`);
        }
        break;

      case 'debate':
        console.log(`  Debate Rounds: ${result.rounds}`);
        console.log(`  Final Proposal Length: ${result.finalProposal.length} chars`);
        break;

      case 'review':
        console.log(`  Revision Rounds: ${result.revisionRounds}`);
        console.log(`  Review Cycles: ${result.reviewHistory.length}`);
        break;

      case 'ensemble':
        console.log(`  Strategy: ${result.strategy}`);
        console.log(`  Total Results: ${result.allResults.length}`);
        break;
    }

  } catch (error) {
    console.log('\nExecution Failed:');
    console.log(`  Error: ${error.message}`);
  }
}

// Run the demo
if (require.main === module) {
  runDemo().catch(error => {
    console.error('Demo failed:', error);
    process.exit(1);
  });
}

module.exports = { runDemo };
