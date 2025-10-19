/**
 * Multi-Agent Orchestration Demo
 *
 * Demonstrates all orchestration patterns:
 * 1. Parallel Execution
 * 2. Consensus Voting
 * 3. Debate
 * 4. Review
 * 5. Ensemble
 */

const MessageBus = require('../.claude/core/message-bus');
const AgentOrchestrator = require('../.claude/core/agent-orchestrator');
const ResearchAgent = require('./agents/research-agent');
const CodeReviewAgent = require('./agents/code-review-agent');

// Color output helpers
const chalk = require('chalk');

function printSection(title) {
  console.log('\n' + chalk.blue.bold('═'.repeat(70)));
  console.log(chalk.blue.bold(`  ${title}`));
  console.log(chalk.blue.bold('═'.repeat(70)) + '\n');
}

function printResult(label, data) {
  console.log(chalk.cyan(`${label}:`), JSON.stringify(data, null, 2));
}

async function demonstratePatterns() {
  printSection('Multi-Agent Orchestration Demo');

  // Initialize the system
  const messageBus = new MessageBus();
  const orchestrator = new AgentOrchestrator(messageBus);

  // Create research agents with different expertise
  const researcher1 = new ResearchAgent('researcher-1', messageBus, {
    expertise: 'technology'
  });

  const researcher2 = new ResearchAgent('researcher-2', messageBus, {
    expertise: 'business'
  });

  const researcher3 = new ResearchAgent('researcher-3', messageBus, {
    expertise: 'user-experience'
  });

  // Create code review agents with different severity levels
  const reviewer1 = new CodeReviewAgent('reviewer-1', messageBus, {
    severity: 'balanced'
  });

  const reviewer2 = new CodeReviewAgent('reviewer-2', messageBus, {
    severity: 'strict'
  });

  const reviewer3 = new CodeReviewAgent('reviewer-3', messageBus, {
    severity: 'lenient'
  });

  // Register all agents
  [researcher1, researcher2, researcher3, reviewer1, reviewer2, reviewer3].forEach(agent => {
    orchestrator.registerAgent(agent);
  });

  console.log(chalk.green('✓ Initialized 6 agents (3 researchers, 3 reviewers)\n'));

  // ============================================================================
  // Pattern 1: Parallel Execution
  // ============================================================================

  printSection('Pattern 1: Parallel Execution');
  console.log('Running 3 research agents in parallel on the same topic...\n');

  const parallelResult = await orchestrator.executeParallel(
    ['researcher-1', 'researcher-2', 'researcher-3'],
    {
      type: 'analyze',
      data: 'market trends for AI products',
      focus: 'competitive landscape'
    }
  );

  console.log(chalk.yellow(`⏱  Duration: ${parallelResult.duration}ms`));
  console.log(chalk.green(`✓ Successful: ${parallelResult.results.length}`));
  console.log(chalk.red(`✗ Failed: ${parallelResult.failures.length}`));

  parallelResult.results.forEach((r, idx) => {
    console.log(chalk.gray(`\n  Agent ${idx + 1} (${r.agentId}):`));
    console.log(chalk.gray(`    Expertise: ${r.result.expertise}`));
    console.log(chalk.gray(`    Insights: ${r.result.insights?.length || 0} found`));
  });

  // ============================================================================
  // Pattern 2: Consensus Voting
  // ============================================================================

  printSection('Pattern 2: Consensus Voting');
  console.log('Asking agents to vote on best framework choice...\n');

  const consensusResult = await orchestrator.executeWithConsensus(
    ['researcher-1', 'researcher-2', 'researcher-3'],
    {
      type: 'compare',
      options: ['React', 'Vue', 'Angular'],
      criteria: 'ease of use and community support'
    },
    {
      strategy: 'majority',
      threshold: 0.6
    }
  );

  console.log(chalk.yellow(`Consensus Reached: ${consensusResult.vote.consensus ? 'Yes' : 'No'}`));
  console.log(chalk.yellow(`Confidence: ${(consensusResult.vote.confidence * 100).toFixed(1)}%`));
  console.log(chalk.green(`\n✓ Winner: ${consensusResult.result?.recommendation || 'No clear winner'}`));

  // ============================================================================
  // Pattern 3: Debate (Iterative Refinement)
  // ============================================================================

  printSection('Pattern 3: Debate (Iterative Refinement)');
  console.log('Running 3-round debate on architecture proposal...\n');

  const debateResult = await orchestrator.executeDebate(
    ['reviewer-1', 'reviewer-2', 'reviewer-3'],
    {
      initialProposal: 'Use microservices architecture for the new platform'
    },
    3 // 3 rounds
  );

  console.log(chalk.yellow(`Debate Rounds: ${debateResult.rounds}`));
  console.log(chalk.green(`\n✓ Final Proposal (after ${debateResult.rounds} rounds):`));
  console.log(chalk.gray(`  ${debateResult.finalProposal.substring(0, 200)}...`));

  debateResult.debateHistory.forEach((round, idx) => {
    console.log(chalk.cyan(`\n  Round ${round.round}:`));
    console.log(chalk.gray(`    Critiques received: ${round.critiques.results?.length || 0}`));
  });

  // ============================================================================
  // Pattern 4: Review (Create/Critique/Revise)
  // ============================================================================

  printSection('Pattern 4: Review (Create/Critique/Revise)');
  console.log('Code review workflow with 2 revision rounds...\n');

  const reviewResult = await orchestrator.executeReview(
    'reviewer-1', // Creator
    ['reviewer-2', 'reviewer-3'], // Reviewers
    {
      type: 'implement-feature',
      feature: 'user authentication module'
    },
    {
      revisionRounds: 2
    }
  );

  console.log(chalk.yellow(`Revision Rounds: ${reviewResult.revisionRounds}`));
  console.log(chalk.green(`\n✓ Final Work:`));
  console.log(chalk.gray(`  ${reviewResult.finalWork?.work || reviewResult.finalWork}`));

  reviewResult.reviewHistory.forEach((round, idx) => {
    console.log(chalk.cyan(`\n  Round ${round.round}:`));
    console.log(chalk.gray(`    Reviews received: ${round.reviews.length}`));
  });

  // ============================================================================
  // Pattern 5: Ensemble (Combine Multiple Outputs)
  // ============================================================================

  printSection('Pattern 5: Ensemble (Best-of Strategy)');
  console.log('Running ensemble with best-of selection...\n');

  const ensembleResult = await orchestrator.executeEnsemble(
    ['researcher-1', 'researcher-2', 'researcher-3'],
    {
      type: 'summarize',
      content: 'Long technical document about distributed systems architecture...',
      maxLength: 150
    },
    {
      strategy: 'best-of',
      selector: (results) => {
        // Select result with most key points
        return results.reduce((best, current) =>
          (current.keyPoints?.length || 0) > (best.keyPoints?.length || 0) ? current : best
        );
      }
    }
  );

  console.log(chalk.yellow(`Strategy: ${ensembleResult.strategy}`));
  console.log(chalk.green(`\n✓ Best Result Selected:`));
  console.log(chalk.gray(`  Summary: ${ensembleResult.result?.summary}`));
  console.log(chalk.gray(`  Key Points: ${ensembleResult.result?.keyPoints?.length || 0}`));

  // ============================================================================
  // Summary Statistics
  // ============================================================================

  printSection('Session Summary');

  const stats = orchestrator.getStats();

  console.log(chalk.cyan('Total Agents:'), stats.totalAgents);
  console.log(chalk.cyan('Active Topics:'), stats.topics);

  console.log(chalk.yellow('\nAgent Statistics:\n'));

  stats.agents.forEach(agentStats => {
    console.log(chalk.white(`  ${agentStats.agentId} (${agentStats.role}):`));
    console.log(chalk.gray(`    Total Executions: ${agentStats.totalExecutions}`));
    console.log(chalk.gray(`    Success Rate: ${agentStats.successRate}%`));
    console.log(chalk.gray(`    Avg Duration: ${agentStats.avgDuration}ms`));
  });

  // Cleanup
  printSection('Cleanup');
  orchestrator.destroy();
  messageBus.clear();
  console.log(chalk.green('✓ All agents destroyed and cleaned up\n'));

  return {
    parallel: parallelResult,
    consensus: consensusResult,
    debate: debateResult,
    review: reviewResult,
    ensemble: ensembleResult,
    stats
  };
}

// Run the demo
if (require.main === module) {
  console.log(chalk.blue.bold('\n🤖 Starting Multi-Agent Orchestration Demo...\n'));

  demonstratePatterns()
    .then((results) => {
      console.log(chalk.green.bold('\n✅ Demo completed successfully!\n'));
      console.log(chalk.gray('All 5 orchestration patterns demonstrated.'));
      console.log(chalk.gray('Check the output above for detailed results.\n'));
    })
    .catch((error) => {
      console.error(chalk.red.bold('\n❌ Demo failed:\n'));
      console.error(chalk.red(error.message));
      console.error(chalk.gray(error.stack));
      process.exit(1);
    });
}

module.exports = { demonstratePatterns };
