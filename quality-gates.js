#!/usr/bin/env node

/**
 * Quality Gates System
 *
 * Defines quality scoring criteria and thresholds for each development phase.
 * Used by the autonomous orchestrator to determine when to proceed to next phase.
 *
 * @module quality-gates
 */

// ============================================================================
// PHASE DEFINITIONS
// ============================================================================

const PHASES = {
  research: {
    name: 'Research',
    description: 'Deep technology research, requirements gathering, competitive analysis',
    minScore: 80,
    nextPhase: 'design',
    criteria: {
      requirementsComplete: {
        weight: 25,
        description: 'All functional and non-functional requirements documented',
        checkPrompt: 'Are all requirements clearly documented with acceptance criteria?',
      },
      technicalAnalysis: {
        weight: 20,
        description: 'Technology choices researched and justified',
        checkPrompt: 'Are technology choices documented with pros/cons analysis?',
      },
      riskAssessment: {
        weight: 15,
        description: 'Risks identified with mitigation strategies',
        checkPrompt: 'Are risks documented with severity ratings and mitigation plans?',
      },
      competitiveAnalysis: {
        weight: 15,
        description: 'Competitive landscape analyzed',
        checkPrompt: 'Is competitive analysis complete with differentiation strategy?',
      },
      feasibilityValidation: {
        weight: 15,
        description: 'Technical feasibility confirmed',
        checkPrompt: 'Has technical feasibility been validated with proof of concepts?',
      },
      stakeholderAlignment: {
        weight: 10,
        description: 'Stakeholder needs understood and documented',
        checkPrompt: 'Are stakeholder needs documented and prioritized?',
      },
    },
  },

  design: {
    name: 'Design',
    description: 'System architecture, API contracts, data models, detailed specifications',
    minScore: 85,
    nextPhase: 'implement',
    criteria: {
      architectureComplete: {
        weight: 25,
        description: 'High-level architecture documented with diagrams',
        checkPrompt: 'Is the system architecture documented with component diagrams?',
      },
      apiContracts: {
        weight: 20,
        description: 'API contracts defined with request/response schemas',
        checkPrompt: 'Are all API endpoints documented with schemas and examples?',
      },
      dataModels: {
        weight: 20,
        description: 'Data models and database schema designed',
        checkPrompt: 'Are data models complete with relationships and constraints?',
      },
      securityDesign: {
        weight: 15,
        description: 'Security considerations addressed',
        checkPrompt: 'Is security design documented (auth, encryption, validation)?',
      },
      testabilityDesign: {
        weight: 10,
        description: 'Testing strategy defined',
        checkPrompt: 'Is the testing strategy documented with coverage goals?',
      },
      scalabilityPlan: {
        weight: 10,
        description: 'Scalability and performance considerations',
        checkPrompt: 'Are scalability requirements and strategies documented?',
      },
    },
  },

  implement: {
    name: 'Implementation',
    description: 'Code implementation following design specifications',
    minScore: 90,
    nextPhase: 'test',
    criteria: {
      codeComplete: {
        weight: 30,
        description: 'All features implemented per design',
        checkPrompt: 'Are all designed features implemented and functional?',
      },
      codeQuality: {
        weight: 20,
        description: 'Code follows best practices and style guidelines',
        checkPrompt: 'Does the code follow established patterns and style guides?',
      },
      errorHandling: {
        weight: 15,
        description: 'Comprehensive error handling implemented',
        checkPrompt: 'Is error handling comprehensive with meaningful messages?',
      },
      documentation: {
        weight: 15,
        description: 'Code documented with comments and JSDoc/docstrings',
        checkPrompt: 'Is the code well-documented with inline comments and docs?',
      },
      securityImplementation: {
        weight: 10,
        description: 'Security measures implemented per design',
        checkPrompt: 'Are security measures properly implemented?',
      },
      performanceOptimization: {
        weight: 10,
        description: 'Performance optimizations applied',
        checkPrompt: 'Are obvious performance optimizations implemented?',
      },
    },
  },

  test: {
    name: 'Testing',
    description: 'Comprehensive testing and quality validation',
    minScore: 90,
    nextPhase: 'complete',
    criteria: {
      unitTests: {
        weight: 25,
        description: 'Unit tests with >80% coverage',
        checkPrompt: 'Do unit tests exist with adequate coverage (>80%)?',
      },
      integrationTests: {
        weight: 20,
        description: 'Integration tests for critical paths',
        checkPrompt: 'Are integration tests implemented for critical flows?',
      },
      edgeCases: {
        weight: 15,
        description: 'Edge cases and error scenarios tested',
        checkPrompt: 'Are edge cases and error scenarios covered by tests?',
      },
      securityTesting: {
        weight: 15,
        description: 'Security vulnerabilities checked',
        checkPrompt: 'Has security testing been performed (OWASP, etc)?',
      },
      performanceTesting: {
        weight: 15,
        description: 'Performance benchmarks validated',
        checkPrompt: 'Has performance testing validated requirements?',
      },
      documentationReview: {
        weight: 10,
        description: 'Documentation reviewed and updated',
        checkPrompt: 'Is documentation complete and up to date?',
      },
    },
  },

  complete: {
    name: 'Complete',
    description: 'Task completed successfully',
    minScore: 100,
    nextPhase: null,
    criteria: {},
  },
};

// ============================================================================
// AGENT ROLES
// ============================================================================

const AGENT_ROLES = {
  researcher: {
    name: 'Research Analyst',
    phases: ['research'],
    responsibilities: [
      'Deep technology research',
      'Competitive analysis',
      'Requirements gathering',
      'Risk assessment',
    ],
  },

  architect: {
    name: 'System Architect',
    phases: ['design'],
    responsibilities: [
      'High-level system design',
      'Technology selection',
      'Scalability planning',
      'Security architecture',
    ],
  },

  developer: {
    name: 'Senior Developer',
    phases: ['implement'],
    responsibilities: [
      'Code implementation',
      'Best practices enforcement',
      'Performance optimization',
      'Code documentation',
    ],
  },

  tester: {
    name: 'Test Engineer',
    phases: ['test'],
    responsibilities: [
      'Test strategy implementation',
      'Test automation',
      'Edge case identification',
      'Quality validation',
    ],
  },

  reviewer: {
    name: 'Quality Reviewer',
    phases: ['research', 'design', 'implement', 'test'],
    responsibilities: [
      'Cross-check work against criteria',
      'Identify gaps and issues',
      'Provide improvement suggestions',
      'Score quality against rubric',
    ],
  },

  critic: {
    name: 'Technical Critic',
    phases: ['research', 'design', 'implement', 'test'],
    responsibilities: [
      'Challenge assumptions',
      'Identify weaknesses',
      'Suggest alternatives',
      'Enforce standards',
    ],
  },
};

// ============================================================================
// SCORING FUNCTIONS
// ============================================================================

/**
 * Calculate score for a phase based on criteria evaluations
 * @param {string} phase - Phase name
 * @param {Object} evaluations - Object with criteria names as keys and scores (0-100) as values
 * @returns {number} Weighted score (0-100)
 */
function calculatePhaseScore(phase, evaluations) {
  const phaseConfig = PHASES[phase];
  if (!phaseConfig) throw new Error(`Unknown phase: ${phase}`);

  let totalWeight = 0;
  let weightedScore = 0;

  for (const [criterion, config] of Object.entries(phaseConfig.criteria)) {
    const score = evaluations[criterion] ?? 0;
    weightedScore += (score * config.weight) / 100;
    totalWeight += config.weight;
  }

  return totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
}

/**
 * Check if phase criteria are met
 * @param {string} phase - Phase name
 * @param {number} score - Current score
 * @returns {boolean} True if phase can proceed
 */
function isPhaseComplete(phase, score) {
  const phaseConfig = PHASES[phase];
  if (!phaseConfig) return false;
  return score >= phaseConfig.minScore;
}

/**
 * Get next phase
 * @param {string} currentPhase - Current phase name
 * @returns {string|null} Next phase name or null if complete
 */
function getNextPhase(currentPhase) {
  const phaseConfig = PHASES[currentPhase];
  return phaseConfig?.nextPhase ?? null;
}

/**
 * Generate scoring prompt for a phase
 * @param {string} phase - Phase name
 * @returns {string} Prompt for scoring evaluation
 */
function generateScoringPrompt(phase) {
  const phaseConfig = PHASES[phase];
  if (!phaseConfig) throw new Error(`Unknown phase: ${phase}`);

  let prompt = `## Quality Gate Evaluation: ${phaseConfig.name} Phase\n\n`;
  prompt += `Minimum score to proceed: ${phaseConfig.minScore}/100\n\n`;
  prompt += `### Evaluation Criteria\n\n`;
  prompt += `Score each criterion from 0-100 based on the current state:\n\n`;

  for (const [criterion, config] of Object.entries(phaseConfig.criteria)) {
    prompt += `#### ${criterion} (Weight: ${config.weight}%)\n`;
    prompt += `${config.description}\n`;
    prompt += `Check: ${config.checkPrompt}\n\n`;
  }

  prompt += `### Response Format\n\n`;
  prompt += `Provide scores in this exact JSON format:\n`;
  prompt += `\`\`\`json\n{\n`;

  const criteria = Object.keys(phaseConfig.criteria);
  criteria.forEach((c, i) => {
    prompt += `  "${c}": <score 0-100>${i < criteria.length - 1 ? ',' : ''}\n`;
  });

  prompt += `}\n\`\`\`\n\n`;
  prompt += `Then provide:\n`;
  prompt += `1. Overall assessment\n`;
  prompt += `2. Gaps identified\n`;
  prompt += `3. Specific improvements needed\n`;

  return prompt;
}

/**
 * Generate improvement guidance based on low scores
 * @param {string} phase - Phase name
 * @param {Object} evaluations - Criteria evaluations
 * @returns {string} Guidance for improvements
 */
function generateImprovementGuidance(phase, evaluations) {
  const phaseConfig = PHASES[phase];
  if (!phaseConfig) throw new Error(`Unknown phase: ${phase}`);

  const lowScores = [];
  for (const [criterion, config] of Object.entries(phaseConfig.criteria)) {
    const score = evaluations[criterion] ?? 0;
    if (score < 80) {
      lowScores.push({
        criterion,
        score,
        weight: config.weight,
        description: config.description,
        checkPrompt: config.checkPrompt,
      });
    }
  }

  if (lowScores.length === 0) {
    return 'All criteria meet minimum standards.';
  }

  // Sort by impact (weight * deficit)
  lowScores.sort((a, b) => {
    const impactA = a.weight * (100 - a.score);
    const impactB = b.weight * (100 - b.score);
    return impactB - impactA;
  });

  let guidance = '## Priority Improvements Needed\n\n';
  guidance += 'Focus on these areas in order of impact:\n\n';

  lowScores.forEach((item, i) => {
    guidance += `### ${i + 1}. ${item.criterion} (Current: ${item.score}/100, Weight: ${item.weight}%)\n`;
    guidance += `**Gap**: ${item.description}\n`;
    guidance += `**Action**: ${item.checkPrompt.replace('?', '.')}\n\n`;
  });

  return guidance;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  PHASES,
  AGENT_ROLES,
  calculatePhaseScore,
  isPhaseComplete,
  getNextPhase,
  generateScoringPrompt,
  generateImprovementGuidance,
};

// ============================================================================
// CLI
// ============================================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === 'list-phases') {
    console.log('\nAvailable Phases:\n');
    for (const [key, phase] of Object.entries(PHASES)) {
      if (key !== 'complete') {
        console.log(`  ${key}: ${phase.name} (min score: ${phase.minScore})`);
        console.log(`    ${phase.description}\n`);
      }
    }
  } else if (args[0] === 'scoring-prompt' && args[1]) {
    console.log(generateScoringPrompt(args[1]));
  } else if (args[0] === 'list-agents') {
    console.log('\nAgent Roles:\n');
    for (const [key, agent] of Object.entries(AGENT_ROLES)) {
      console.log(`  ${key}: ${agent.name}`);
      console.log(`    Phases: ${agent.phases.join(', ')}`);
      console.log(`    Responsibilities:`);
      agent.responsibilities.forEach(r => console.log(`      - ${r}`));
      console.log('');
    }
  } else {
    console.log(`
Quality Gates CLI

Usage:
  node quality-gates.js list-phases              List all phases with criteria
  node quality-gates.js list-agents              List agent roles
  node quality-gates.js scoring-prompt <phase>   Generate scoring prompt for phase
`);
  }
}
