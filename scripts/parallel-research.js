/**
 * Parallel Research Implementation
 *
 * Executes multiple research approaches simultaneously for 5x speedup.
 *
 * @module scripts/parallel-research
 */

const path = require('path');
const fs = require('fs');

// Import core components
const AgentOrchestrator = require('../.claude/core/agent-orchestrator');
const AgentLoader = require('../.claude/core/agent-loader');
const MemoryStore = require('../.claude/core/memory-store');
const VectorStore = require('../.claude/core/vector-store');

/**
 * Detects research approaches from question
 *
 * @param {string} question - Research question
 * @param {number} maxApproaches - Maximum number of approaches
 * @returns {string[]} - Detected approaches
 */
function detectApproaches(question, maxApproaches = 3) {
  const lower = question.toLowerCase();

  // Common patterns
  const patterns = {
    stateManagement: ['redux', 'zustand', 'jotai', 'mobx', 'recoil'],
    authentication: ['passport.js', 'auth0', 'jwt', 'oauth2orize', 'keycloak'],
    databases: ['postgresql', 'mongodb', 'mysql', 'cassandra', 'redis'],
    cicd: ['github actions', 'gitlab ci', 'circleci', 'jenkins', 'travis ci'],
    frameworks: ['react', 'vue', 'angular', 'svelte', 'solid'],
    backend: ['express', 'fastify', 'nestjs', 'hapi', 'koa'],
    testing: ['jest', 'vitest', 'mocha', 'jasmine', 'ava'],
    bundlers: ['webpack', 'vite', 'rollup', 'parcel', 'esbuild']
  };

  // Detect domain
  for (const [domain, approaches] of Object.entries(patterns)) {
    if (lower.includes(domain) || approaches.some(a => lower.includes(a))) {
      return approaches.slice(0, maxApproaches);
    }
  }

  // Fallback: extract from question
  const words = question.split(/\s+/);
  return words.filter(w => w.length > 3).slice(0, maxApproaches);
}

/**
 * Creates research task for agent
 *
 * @param {string} approach - Approach to research
 * @param {string} question - Research question
 * @param {Object} options - Research options
 * @returns {Object} - Research task
 */
function createResearchTask(approach, question, options = {}) {
  const { depth = 'medium', criteria = [] } = options;

  const depthInstructions = {
    quick: 'Provide a brief overview (5-10 minutes of research)',
    medium: 'Provide comprehensive analysis (15-20 minutes of research)',
    deep: 'Provide deep dive with examples and comparisons (30+ minutes of research)'
  };

  const criteriaText = criteria.length > 0
    ? `\nFocus on these criteria: ${criteria.join(', ')}`
    : '';

  return {
    prompt: `Research: ${approach}

Context: ${question}

Depth: ${depthInstructions[depth]}${criteriaText}

Please provide:
1. **Overview**: Brief description of ${approach}
2. **Pros**: Key advantages and strengths
3. **Cons**: Limitations and drawbacks
4. **Use Cases**: Best fit scenarios
5. **Community**: Adoption, updates, support
6. **Resources**: Documentation, tutorials, examples
7. **Rating**: Score out of 10 for each criterion

Format as structured markdown.`,
    approach,
    depth
  };
}

/**
 * Executes parallel research
 *
 * @param {string} question - Research question
 * @param {Object} options - Research options
 * @returns {Promise<Object>} - Research results
 */
async function executeParallelResearch(question, options = {}) {
  const {
    approaches: userApproaches,
    maxAgents = 3,
    depth = 'medium',
    criteria = [],
    cwd = process.cwd()
  } = options;

  console.log('\n🔍 Starting Parallel Research...\n');
  console.log(`Question: ${question}\n`);

  // Detect or use provided approaches
  const approaches = userApproaches || detectApproaches(question, maxAgents);

  if (approaches.length === 0) {
    throw new Error('No research approaches detected. Please specify --approaches.');
  }

  console.log(`Researching ${approaches.length} approach(es):\n${approaches.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n`);

  // Initialize components
  const agentLoader = new AgentLoader(path.join(cwd, '.claude', 'agents'));
  const memoryStore = new MemoryStore(path.join(cwd, '.claude', 'memory', 'orchestrations.db'));
  const vectorStore = new VectorStore(memoryStore);

  const orchestrator = new AgentOrchestrator({
    agentLoader,
    memoryStore,
    vectorStore
  });

  // Load research agent
  const researchAgents = agentLoader.queryAgents({ specialty: 'research' });
  const researchAgent = researchAgents.length > 0
    ? researchAgents[0]
    : { id: 'research-analyst', name: 'Research Analyst' };

  // Create tasks for each approach
  const tasks = approaches.map(approach =>
    createResearchTask(approach, question, { depth, criteria })
  );

  // Execute in parallel
  console.log('⚡ Running research agents in parallel...\n');

  const startTime = Date.now();

  const results = await orchestrator.executeParallel({
    tasks: tasks.map(task => ({
      agentId: researchAgent.id,
      prompt: task.prompt,
      context: { approach: task.approach, question, depth: task.depth }
    })),
    options: {
      maxConcurrency: maxAgents,
      timeout: depth === 'deep' ? 120000 : depth === 'medium' ? 60000 : 30000
    }
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n✓ Research completed in ${duration}s\n`);

  // Process results
  const findings = results.map((result, index) => ({
    approach: approaches[index],
    content: result.response || result.output || '',
    success: result.success,
    duration: result.duration || 0
  }));

  return {
    question,
    approaches,
    findings,
    totalDuration: duration,
    timestamp: new Date().toISOString()
  };
}

/**
 * Synthesizes research findings into comparison
 *
 * @param {Object} researchResults - Results from parallel research
 * @returns {string} - Synthesized comparison
 */
function synthesizeFindings(researchResults) {
  const { question, approaches, findings } = researchResults;

  const lines = [
    '# Research Findings',
    '',
    `**Question:** ${question}`,
    `**Approaches:** ${approaches.join(', ')}`,
    `**Completed:** ${new Date().toLocaleString()}`,
    '',
    '---',
    ''
  ];

  // Add individual findings
  for (const finding of findings) {
    lines.push(`## ${finding.approach}`);
    lines.push('');

    if (finding.success) {
      lines.push(finding.content);
    } else {
      lines.push('*Research failed or incomplete*');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Add comparison table (simplified - would be enhanced by synthesis agent)
  lines.push('## Quick Comparison');
  lines.push('');
  lines.push('| Approach | Status | Key Strength |');
  lines.push('|----------|--------|--------------|');

  for (const finding of findings) {
    const status = finding.success ? '✓' : '✗';
    const strength = finding.success ? 'See details above' : 'N/A';
    lines.push(`| ${finding.approach} | ${status} | ${strength} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Note: For detailed synthesis and recommendation, use `/research-synthesize`*');
  lines.push('');

  return lines.join('\n');
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help') {
    console.log(`
Usage: node scripts/parallel-research.js "<question>" [options]

Options:
  --approaches <list>  Comma-separated list of approaches
  --depth <level>      Research depth: quick, medium (default), deep
  --agents <number>    Max parallel agents (default: 3)
  --criteria <list>    Comma-separated evaluation criteria
  --output <file>      Save results to file

Examples:
  node scripts/parallel-research.js "Best state management for React"
  node scripts/parallel-research.js "Which database?" --approaches "PostgreSQL,MongoDB,Redis"
  node scripts/parallel-research.js "CI/CD tool" --depth deep --agents 5
`);
    process.exit(0);
  }

  const question = args[0];

  // Parse options
  const options = {
    approaches: null,
    depth: 'medium',
    maxAgents: 3,
    criteria: [],
    output: null
  };

  for (let i = 1; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    const value = args[i + 1];

    if (key === 'approaches') {
      options.approaches = value.split(',').map(s => s.trim());
    } else if (key === 'depth') {
      options.depth = value;
    } else if (key === 'agents') {
      options.maxAgents = parseInt(value);
    } else if (key === 'criteria') {
      options.criteria = value.split(',').map(s => s.trim());
    } else if (key === 'output') {
      options.output = value;
    }
  }

  try {
    // Execute research
    const results = await executeParallelResearch(question, options);

    // Synthesize findings
    const report = synthesizeFindings(results);

    // Display results
    console.log('\n' + report);

    // Save to file if requested
    if (options.output) {
      fs.writeFileSync(options.output, report);
      console.log(`\n✓ Results saved to ${options.output}`);
    }
  } catch (error) {
    console.error(`\n✗ Error: ${error.message}`);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  executeParallelResearch,
  synthesizeFindings,
  detectApproaches,
  createResearchTask
};
