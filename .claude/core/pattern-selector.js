/**
 * Pattern Selector - Intelligently selects orchestration pattern based on user prompt
 *
 * Responsibilities:
 * - Analyze user prompts to determine intent
 * - Select appropriate orchestration pattern (parallel, consensus, debate, review, ensemble)
 * - Provide confidence scoring and reasoning
 * - Suggest agent configurations for selected pattern
 *
 * @module pattern-selector
 */

const { createComponentLogger } = require('./logger');
const logger = createComponentLogger('PatternSelector');

/**
 * Pattern definitions with keywords, intent patterns, and selection criteria
 */
const PATTERN_DEFINITIONS = {
  parallel: {
    name: 'Parallel Execution',
    description: 'Run multiple agents simultaneously on same task',
    keywords: [
      'parallel', 'simultaneously', 'multiple', 'perspectives', 'gather', 'compare',
      'different', 'viewpoints', 'diverse', 'comprehensive', 'all agents', 'everyone',
      'concurrent', 'at once', 'together', 'independent', 'separate', 'expert',
      'experts', 'angles', 'coverage'
    ],
    intentPatterns: [
      /get\s+(multiple|different|various)\s+(perspectives|viewpoints|opinions)/i,
      /(analyze|evaluate|research)\s+from\s+(different|multiple|various)\s+angles/i,
      /have\s+(all|multiple|several)\s+agents\s+(analyze|review|investigate)/i,
      /need\s+(comprehensive|complete|thorough)\s+(analysis|review|coverage)/i,
      /compare\s+(different|multiple)\s+(approaches|solutions|options)/i,
      /gather\s+(all|multiple)\s+(insights|findings|results)/i,
      /run\s+(in\s+)?parallel/i,
      /simultaneously/i,
      /multiple\s+(expert|experts)\s+(perspectives|viewpoints)/i,
      /from\s+(multiple|different)\s+expert/i,
      /(all|multiple)\s+expert/i
    ],
    contextClues: [
      'get input from everyone',
      'all agents should',
      'comprehensive coverage',
      'multiple perspectives',
      'parallel analysis',
      'at the same time'
    ],
    useCases: [
      'Gathering multiple expert opinions',
      'Comprehensive research from different angles',
      'Speed optimization for independent tasks',
      'Redundancy for critical analysis'
    ],
    minAgents: 2,
    maxAgents: 10,
    weight: 1.0,
    minConfidence: 0.6
  },

  consensus: {
    name: 'Consensus Voting',
    description: 'Reach agreement through voting mechanisms',
    keywords: [
      'consensus', 'vote', 'agree', 'decision', 'choose', 'select',
      'majority', 'agreement', 'decide', 'pick', 'preference',
      'best option', 'which one', 'approve', 'validate', 'confirm',
      'unanimous', 'weighted', 'democratic'
    ],
    intentPatterns: [
      /reach\s+(a\s+)?consensus/i,
      /(vote|decide)\s+on\s+(the\s+)?(best|right|correct)/i,
      /which\s+(option|approach|solution)\s+(is\s+)?(best|better)/i,
      /need\s+(agreement|approval|validation)/i,
      /agents\s+(should\s+)?(agree|vote|decide)/i,
      /majority\s+(vote|decision|agreement)/i,
      /choose\s+between\s+\w+/i,
      /which\s+(one|approach)\s+should\s+(we|I)/i
    ],
    contextClues: [
      'need agreement',
      'vote on',
      'reach consensus',
      'decide which',
      'choose the best',
      'majority decides'
    ],
    useCases: [
      'Selecting best option from alternatives',
      'Making technical decisions',
      'Approving/rejecting proposals',
      'Validating solutions'
    ],
    minAgents: 3,
    maxAgents: 10,
    weight: 1.0,
    minConfidence: 0.65
  },

  debate: {
    name: 'Debate (Iterative Refinement)',
    description: 'Refine proposals through multiple critique rounds',
    keywords: [
      'debate', 'refine', 'improve', 'iterate', 'critique',
      'challenge', 'question', 'discuss', 'evolve', 'enhance',
      'rounds', 'iterative', 'progressive', 'refinement', 'polish',
      'back and forth', 'dialogue', 'argument'
    ],
    intentPatterns: [
      /debate\s+(the|this|about)/i,
      /refine\s+(through|via|by)\s+(debate|discussion|critique)/i,
      /(improve|enhance)\s+(through|via)\s+(iteration|discussion|critique)/i,
      /challenge\s+(the|each)\s+(proposal|idea|approach)/i,
      /multiple\s+rounds\s+of\s+(critique|review|refinement)/i,
      /iterative(ly)?\s+(refine|improve|enhance)/i,
      /have\s+agents\s+(critique|challenge|debate)/i,
      /back\s+and\s+forth/i
    ],
    contextClues: [
      'iterative refinement',
      'multiple rounds',
      'critique and improve',
      'challenge assumptions',
      'evolve the proposal',
      'debate the approach'
    ],
    useCases: [
      'Architecture decisions requiring refinement',
      'Design proposals needing improvement',
      'Complex problem-solving',
      'Strategic planning with multiple iterations'
    ],
    minAgents: 2,
    maxAgents: 5,
    weight: 1.0,
    minConfidence: 0.7
  },

  review: {
    name: 'Review (Create/Critique/Revise)',
    description: 'Collaborative creation with review cycles',
    keywords: [
      'review', 'critique', 'revise', 'create', 'feedback',
      'improve', 'quality', 'creator', 'reviewer', 'revision',
      'iterate', 'refactor', 'peer review', 'code review', 'edit',
      'draft', 'finalize', 'polish', 'implementation'
    ],
    intentPatterns: [
      /create\s+and\s+(review|critique)/i,
      /have\s+(one\s+)?agent\s+create\s+and\s+(others?|another)\s+review/i,
      /(code|document|design)\s+review\s+(process|workflow|cycle)/i,
      /create\s+then\s+(revise|improve)\s+based\s+on\s+feedback/i,
      /peer\s+review/i,
      /review\s+(and\s+)?revise/i,
      /iterative\s+(creation|development)\s+with\s+review/i,
      /create.*review.*revise/i,
      /one\s+agent.*create.*others.*review/i,
      /\d+\s+revision\s+(rounds?|cycles?)/i
    ],
    contextClues: [
      'create and review',
      'one creates, others review',
      'review cycle',
      'revision rounds',
      'feedback and revision',
      'peer review process'
    ],
    useCases: [
      'Code development with review',
      'Document creation with editing cycles',
      'Design iteration with feedback',
      'Quality assurance workflows'
    ],
    minAgents: 2,
    maxAgents: 6,
    weight: 1.0,
    minConfidence: 0.65
  },

  ensemble: {
    name: 'Ensemble (Combine Outputs)',
    description: 'Combine multiple agent outputs strategically',
    keywords: [
      'ensemble', 'combine', 'merge', 'best of', 'select best',
      'aggregate', 'synthesize', 'blend', 'integrate', 'unify',
      'pick best', 'choose best', 'strongest', 'highest quality',
      'consolidate', 'amalgamate', 'pick', 'best'
    ],
    intentPatterns: [
      /best\s+of\s+(multiple|all)\s+agents/i,
      /combine\s+(the\s+)?(outputs?|results?)/i,
      /merge\s+(all|multiple)\s+(outputs?|results?|findings)/i,
      /select\s+(the\s+)?best\s+(output|result|solution)/i,
      /synthesize\s+(all|multiple)\s+\w+/i,
      /aggregate\s+(the\s+)?(results?|findings|insights)/i,
      /pick\s+(the\s+)?(best|strongest|highest\s+quality)/i,
      /ensemble\s+(approach|method|strategy)/i,
      /run.*and\s+pick.*best/i,
      /pick.*best.*result/i
    ],
    contextClues: [
      'combine outputs',
      'best of all',
      'merge results',
      'pick the best',
      'aggregate findings',
      'select strongest'
    ],
    useCases: [
      'Selecting highest quality result',
      'Merging complementary outputs',
      'Quality-based selection',
      'Risk assessment aggregation'
    ],
    minAgents: 2,
    maxAgents: 10,
    weight: 1.0,
    minConfidence: 0.65
  }
};

/**
 * Task type to pattern mappings
 * Certain task types strongly suggest specific patterns
 */
const TASK_TYPE_HINTS = {
  // Research and analysis → Parallel
  'research': { pattern: 'parallel', boost: 0.3 },
  'investigate': { pattern: 'parallel', boost: 0.3 },
  'analyze': { pattern: 'parallel', boost: 0.2 },
  'explore': { pattern: 'parallel', boost: 0.2 },

  // Decision making → Consensus
  'decide': { pattern: 'consensus', boost: 0.3 },
  'choose': { pattern: 'consensus', boost: 0.3 },
  'select': { pattern: 'consensus', boost: 0.25 },
  'vote': { pattern: 'consensus', boost: 0.4 },

  // Refinement → Debate
  'refine': { pattern: 'debate', boost: 0.3 },
  'debate': { pattern: 'debate', boost: 0.5 },
  'challenge': { pattern: 'debate', boost: 0.3 },
  'iterate': { pattern: 'debate', boost: 0.25 },

  // Creation with review → Review
  'create-and-review': { pattern: 'review', boost: 0.4 },
  'implement-and-review': { pattern: 'review', boost: 0.4 },
  'develop-with-feedback': { pattern: 'review', boost: 0.3 },
  'peer-review': { pattern: 'review', boost: 0.5 },

  // Combination → Ensemble
  'combine': { pattern: 'ensemble', boost: 0.3 },
  'merge': { pattern: 'ensemble', boost: 0.3 },
  'best-of': { pattern: 'ensemble', boost: 0.4 },
  'aggregate': { pattern: 'ensemble', boost: 0.3 }
};

class PatternSelector {
  /**
   * Creates a PatternSelector instance
   */
  constructor() {
    logger.info('PatternSelector initialized');
  }

  /**
   * Selects the best orchestration pattern based on user input
   * @param {string} userInput - User's prompt or task description
   * @param {Object} options - Selection options
   * @returns {Object} Selection result with pattern, confidence, and configuration
   */
  select(userInput, options = {}) {
    const {
      agentCount = null,
      taskType = null,
      context = {}
    } = options;

    if (!userInput || typeof userInput !== 'string') {
      return {
        pattern: null,
        confidence: 0,
        reasoning: 'Invalid input',
        suggestions: []
      };
    }

    // Normalize input
    const input = userInput.toLowerCase().trim();

    // Calculate scores for each pattern
    const scores = {};
    const reasonings = {};

    for (const [patternName, definition] of Object.entries(PATTERN_DEFINITIONS)) {
      const result = this._scorePattern(input, patternName, definition, taskType);
      scores[patternName] = result.score;
      reasonings[patternName] = result.reasoning;
    }

    // Sort patterns by score
    const sortedPatterns = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .map(([pattern, score]) => ({ pattern, score }));

    const topPattern = sortedPatterns[0];
    const definition = PATTERN_DEFINITIONS[topPattern.pattern];

    // Validate agent count if provided
    let agentCountWarning = '';
    if (agentCount !== null) {
      if (agentCount < definition.minAgents) {
        agentCountWarning = `Warning: ${topPattern.pattern} requires at least ${definition.minAgents} agents (you have ${agentCount})`;
      } else if (agentCount > definition.maxAgents) {
        agentCountWarning = `Warning: ${topPattern.pattern} works best with ${definition.maxAgents} or fewer agents (you have ${agentCount})`;
      }
    }

    // Determine if pattern meets confidence threshold
    const meetsThreshold = topPattern.score >= definition.minConfidence;

    // Build result
    const result = {
      pattern: meetsThreshold ? topPattern.pattern : null,
      patternName: definition.name,
      description: definition.description,
      confidence: topPattern.score,
      reasoning: reasonings[topPattern.pattern],
      agentCountWarning: agentCountWarning,
      recommendedConfig: this._getRecommendedConfig(topPattern.pattern, userInput, agentCount),
      suggestions: sortedPatterns
        .filter(p => p.score >= 0.4)
        .slice(0, 3)
        .map(p => ({
          pattern: p.pattern,
          name: PATTERN_DEFINITIONS[p.pattern].name,
          confidence: p.score,
          reasoning: reasonings[p.pattern],
          useCases: PATTERN_DEFINITIONS[p.pattern].useCases
        })),
      allScores: scores
    };

    logger.info('Pattern selected', {
      pattern: result.pattern,
      confidence: result.confidence.toFixed(2),
      alternatives: result.suggestions.length
    });

    return result;
  }

  /**
   * Scores a specific pattern against user input
   * @private
   */
  _scorePattern(input, patternName, definition, taskType) {
    let score = 0;
    const matches = [];

    // 1. Score keywords (0-0.4 range)
    const keywordMatches = [];
    for (const keyword of definition.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(input)) {
        keywordMatches.push(keyword);
      }
    }

    if (keywordMatches.length > 0) {
      const keywordScore = Math.min(0.4, 0.15 + (Math.log(keywordMatches.length + 1) / 8));
      score += keywordScore;
      matches.push(`keywords: ${keywordMatches.slice(0, 3).join(', ')}`);
    }

    // 2. Score intent patterns (0-0.5 range)
    const patternMatches = [];
    for (const regex of definition.intentPatterns) {
      if (regex.test(input)) {
        patternMatches.push(regex.source.slice(0, 30));
      }
    }

    if (patternMatches.length > 0) {
      const patternScore = Math.min(0.5, 0.35 + (patternMatches.length * 0.1));
      score += patternScore;
      matches.push(`intent patterns: ${patternMatches.length} matched`);
    }

    // 3. Score context clues (0-0.2 range)
    const clueMatches = [];
    for (const clue of definition.contextClues) {
      if (input.includes(clue.toLowerCase())) {
        clueMatches.push(clue);
      }
    }

    if (clueMatches.length > 0) {
      const clueScore = Math.min(0.2, 0.1 + (clueMatches.length * 0.05));
      score += clueScore;
      matches.push(`context: ${clueMatches.slice(0, 2).join(', ')}`);
    }

    // 4. Apply task type boost if applicable
    if (taskType && TASK_TYPE_HINTS[taskType]) {
      const hint = TASK_TYPE_HINTS[taskType];
      if (hint.pattern === patternName) {
        score += hint.boost;
        matches.push(`task type boost: +${hint.boost}`);
      }
    }

    // Apply pattern weight
    score *= definition.weight;

    // Cap at 1.0
    score = Math.min(1.0, score);

    const reasoning = matches.length > 0
      ? `Matched ${matches.join('; ')}`
      : 'No significant matches';

    return { score, reasoning };
  }

  /**
   * Gets recommended configuration for selected pattern
   * @private
   */
  _getRecommendedConfig(pattern, input, agentCount) {
    const config = {
      pattern: pattern,
      timeout: 60000,
      retries: 3
    };

    switch (pattern) {
      case 'parallel':
        config.synthesizer = 'default';
        config.description = 'Agents will run simultaneously and results will be combined';
        break;

      case 'consensus':
        // Detect voting strategy from input
        if (/unanimous/i.test(input)) {
          config.strategy = 'unanimous';
          config.threshold = 1.0;
        } else if (/weighted/i.test(input)) {
          config.strategy = 'weighted';
          config.threshold = 0.6;
        } else {
          config.strategy = 'majority';
          config.threshold = 0.5;
        }
        config.description = `Using ${config.strategy} voting with ${(config.threshold * 100)}% threshold`;
        break;

      case 'debate':
        // Detect number of rounds
        const roundsMatch = input.match(/(\d+)\s+(rounds?|iterations?)/i);
        config.rounds = roundsMatch ? parseInt(roundsMatch[1]) : 3;
        config.description = `Will run ${config.rounds} rounds of critique and refinement`;
        break;

      case 'review':
        // Detect revision rounds
        const revisionsMatch = input.match(/(\d+)\s+(revisions?|reviews?)/i);
        config.revisionRounds = revisionsMatch ? parseInt(revisionsMatch[1]) : 2;
        config.description = `Creator produces work, reviewers critique, ${config.revisionRounds} revision cycles`;
        break;

      case 'ensemble':
        // Detect ensemble strategy
        if (/merge|combine|blend/i.test(input)) {
          config.strategy = 'merge';
        } else if (/vote/i.test(input)) {
          config.strategy = 'vote';
        } else {
          config.strategy = 'best-of';
        }
        config.description = `Will use ${config.strategy} strategy to combine agent outputs`;
        break;
    }

    return config;
  }

  /**
   * Gets detailed explanation of a pattern
   * @param {string} patternName - Pattern name
   * @returns {Object} Pattern details
   */
  getPatternInfo(patternName) {
    const definition = PATTERN_DEFINITIONS[patternName];
    if (!definition) {
      return null;
    }

    return {
      name: definition.name,
      description: definition.description,
      useCases: definition.useCases,
      minAgents: definition.minAgents,
      maxAgents: definition.maxAgents,
      examples: this._getPatternExamples(patternName)
    };
  }

  /**
   * Gets example prompts for a pattern
   * @private
   */
  _getPatternExamples(patternName) {
    const examples = {
      parallel: [
        'Have all agents analyze this market trend from different perspectives',
        'Research HIPAA compliance requirements using multiple expert viewpoints',
        'Get comprehensive analysis from all agents simultaneously'
      ],
      consensus: [
        'Have agents vote on the best architecture approach',
        'Reach consensus on which framework to use',
        'Agents should agree on the recommended solution'
      ],
      debate: [
        'Debate the proposed architecture over 3 rounds',
        'Refine this design through iterative critique',
        'Challenge and improve this proposal through agent discussion'
      ],
      review: [
        'Have one agent create the code and others review it',
        'Create document and run through 2 review cycles',
        'Implement feature with peer review process'
      ],
      ensemble: [
        'Run all agents and pick the best result',
        'Combine outputs from multiple agents',
        'Merge findings from all agents into comprehensive report'
      ]
    };

    return examples[patternName] || [];
  }

  /**
   * Lists all available patterns
   * @returns {Array} Array of pattern summaries
   */
  listPatterns() {
    return Object.entries(PATTERN_DEFINITIONS).map(([name, def]) => ({
      pattern: name,
      name: def.name,
      description: def.description,
      minAgents: def.minAgents,
      maxAgents: def.maxAgents,
      useCases: def.useCases.slice(0, 2)
    }));
  }
}

module.exports = PatternSelector;
