/**
 * Phase Inference Engine - Intelligently detects development phase from user input
 *
 * Responsibilities:
 * - Keyword extraction and pattern matching
 * - Confidence scoring algorithm
 * - Transition validation
 * - Phase-specific pattern recognition
 *
 * @module phase-inference
 */

const fs = require('fs');
const path = require('path');

/**
 * Phase patterns with keywords, patterns, and weights
 */
const PHASE_PATTERNS = {
  research: {
    keywords: [
      'research', 'investigate', 'analyze', 'study', 'explore',
      'evaluate', 'compare', 'assessment', 'analysis', 'survey',
      'examine', 'technology', 'options', 'alternatives', 'feasibility',
      'requirements', 'landscape', 'competitors', 'market', 'trends'
    ],
    patterns: [
      /what\s+(are\s+)?the\s+(best|available|current)\s+options/i,
      /how\s+(does|do|can|should)\s+\w+\s+compare/i,
      /research\s+\w+/i,
      /investigate\s+\w+/i,
      /analyze\s+(the\s+)?\w+/i,
      /evaluate\s+(different|various|all)\s+\w+/i,
      /what\s+(technologies|tools|frameworks|libraries)/i
    ],
    contextClues: [
      'need to understand',
      'before we start',
      'not sure which',
      'what should we use',
      'compare different'
    ],
    weight: 1.0,
    minConfidence: 0.6
  },

  planning: {
    keywords: [
      'plan', 'roadmap', 'timeline', 'schedule', 'milestone',
      'estimate', 'budget', 'resource', 'allocation', 'strategy',
      'approach', 'methodology', 'steps', 'phases', 'organize',
      'coordinate', 'prioritize', 'dependencies', 'sequence', 'workflow'
    ],
    patterns: [
      /create\s+a\s+(plan|roadmap|timeline)/i,
      /how\s+(long|much time)\s+will\s+it\s+take/i,
      /what\s+(are\s+)?the\s+steps/i,
      /plan\s+(out|for)\s+\w+/i,
      /estimate\s+(the\s+)?(time|effort|cost)/i,
      /break\s+down\s+(the\s+)?project/i,
      /organize\s+the\s+work/i
    ],
    contextClues: [
      'how should we approach',
      'what order',
      'organize this',
      'break this down',
      'create a timeline'
    ],
    weight: 1.0,
    minConfidence: 0.65
  },

  design: {
    keywords: [
      'design', 'architecture', 'structure', 'system', 'component',
      'interface', 'API', 'schema', 'model', 'database',
      'pattern', 'blueprint', 'specification', 'diagram', 'layout',
      'scalability', 'modularity', 'contract', 'integration', 'workflow'
    ],
    patterns: [
      /design\s+(the\s+)?(system|architecture|database|API)/i,
      /how\s+should\s+(we|I)\s+(structure|organize|architect)/i,
      /create\s+(the\s+)?(architecture|design|specification)/i,
      /define\s+(the\s+)?(API|interface|schema|model)/i,
      /system\s+design/i,
      /technical\s+(specification|design)/i,
      /data\s+(model|schema|structure)/i
    ],
    contextClues: [
      'how to structure',
      'system architecture',
      'design the',
      'define the API',
      'data model'
    ],
    weight: 1.0,
    minConfidence: 0.65
  },

  'test-first': {
    keywords: [
      'test', 'testing', 'TDD', 'test-driven', 'spec', 'specification',
      'coverage', 'unittest', 'integration', 'e2e', 'end-to-end',
      'assertion', 'mock', 'stub', 'fixture', 'testcase',
      'pytest', 'jest', 'mocha', 'junit', 'testability'
    ],
    patterns: [
      /write\s+(the\s+)?tests?\s+(first|for)/i,
      /test[-\s]driven/i,
      /TDD/i,
      /test\s+(strategy|plan|suite)/i,
      /create\s+(unit|integration|e2e)\s+tests/i,
      /test\s+coverage/i,
      /testing\s+approach/i,
      /write\s+specs?/i
    ],
    contextClues: [
      'test first',
      'before implementing',
      'write tests',
      'test coverage',
      'TDD approach'
    ],
    weight: 1.0,
    minConfidence: 0.7
  },

  implementation: {
    keywords: [
      'implement', 'code', 'develop', 'build', 'create',
      'write', 'program', 'function', 'class', 'method',
      'feature', 'logic', 'algorithm', 'integration', 'module',
      'component', 'service', 'endpoint', 'handler', 'controller'
    ],
    patterns: [
      /implement\s+(the\s+)?\w+/i,
      /write\s+(the\s+)?code\s+for/i,
      /build\s+(the|a)\s+\w+/i,
      /create\s+(a|the)\s+(function|class|method|component)/i,
      /develop\s+(the\s+)?\w+\s+(feature|functionality)/i,
      /add\s+(the\s+)?\w+\s+(feature|functionality)/i,
      /code\s+(the|a)\s+\w+/i
    ],
    contextClues: [
      "let's implement",
      "let's code",
      "write the code",
      "build the feature",
      "create the functionality"
    ],
    weight: 1.0,
    minConfidence: 0.65
  },

  validation: {
    keywords: [
      'validate', 'verify', 'review', 'check', 'quality',
      'QA', 'assurance', 'audit', 'inspect', 'evaluate',
      'assess', 'approval', 'sign-off', 'confirm', 'ensure',
      'correctness', 'standards', 'compliance', 'acceptance', 'criteria'
    ],
    patterns: [
      /validate\s+(the\s+)?\w+/i,
      /review\s+(the\s+)?(code|implementation|work)/i,
      /quality\s+(check|assurance|review)/i,
      /verify\s+(that\s+)?\w+/i,
      /check\s+(if|whether|that)/i,
      /does\s+(this|it)\s+(work|meet)/i,
      /is\s+(this|it)\s+(correct|ready|complete)/i
    ],
    contextClues: [
      'quality check',
      'review the',
      'is this correct',
      'does this work',
      'validate that'
    ],
    weight: 1.0,
    minConfidence: 0.65
  },

  iteration: {
    keywords: [
      'improve', 'optimize', 'refactor', 'enhance', 'iterate',
      'upgrade', 'modernize', 'streamline', 'simplify', 'cleanup',
      'performance', 'efficiency', 'better', 'faster', 'cleaner',
      'reorganize', 'restructure', 'revise', 'update', 'polish'
    ],
    patterns: [
      /improve\s+(the\s+)?\w+/i,
      /optimize\s+(the\s+|for\s+)?\w+/i,
      /refactor\s+(the\s+)?\w+/i,
      /make\s+(it\s+)?(better|faster|cleaner)/i,
      /enhance\s+(the\s+)?\w+/i,
      /how\s+can\s+(we|I)\s+improve/i,
      /performance\s+(improvement|optimization)/i
    ],
    contextClues: [
      'make it better',
      'improve performance',
      'refactor this',
      'optimize the',
      'enhance the'
    ],
    weight: 1.0,
    minConfidence: 0.65
  }
};

/**
 * Valid phase transitions
 * Maps current phase to allowed next phases
 */
const VALID_TRANSITIONS = {
  research: ['planning'],
  planning: ['design', 'research'],
  design: ['test-first', 'research', 'planning'],
  'test-first': ['implementation', 'design'],
  implementation: ['validation', 'test-first'],
  validation: ['iteration', 'research', 'planning', 'design', 'test-first', 'implementation'],
  iteration: ['validation']
};

/**
 * Emergency transitions allowed from any phase
 */
const EMERGENCY_PHASES = ['research', 'planning']; // Can always go back to start

class PhaseInference {
  /**
   * Creates a PhaseInference instance
   * @param {Object} stateManager - StateManager instance for context
   */
  constructor(stateManager = null) {
    this.stateManager = stateManager;
  }

  /**
   * Infers the intended phase from user input
   * @param {string} userInput - User's message or command
   * @param {string} currentPhase - Current project phase
   * @returns {Object} Inference result with phase, confidence, and reasoning
   */
  infer(userInput, currentPhase = null) {
    if (!userInput || typeof userInput !== 'string') {
      return {
        phase: null,
        confidence: 0,
        reasoning: 'Invalid input',
        suggestions: []
      };
    }

    // Normalize input
    const input = userInput.toLowerCase().trim();

    // Calculate scores for each phase
    const scores = {};
    const reasonings = {};

    for (const [phase, pattern] of Object.entries(PHASE_PATTERNS)) {
      const result = this._scorePhase(input, phase, pattern);
      scores[phase] = result.score;
      reasonings[phase] = result.reasoning;
    }

    // Find highest scoring phase
    const sortedPhases = Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .map(([phase, score]) => ({ phase, score }));

    const topPhase = sortedPhases[0];
    const secondPhase = sortedPhases[1];

    // Validate transition if we have current phase
    let isValidTransition = true;
    let transitionNote = '';

    if (currentPhase && topPhase.score >= PHASE_PATTERNS[topPhase.phase].minConfidence) {
      isValidTransition = this._isValidTransition(currentPhase, topPhase.phase);

      if (!isValidTransition && !EMERGENCY_PHASES.includes(topPhase.phase)) {
        transitionNote = `Invalid transition from ${currentPhase} to ${topPhase.phase}. `;
        transitionNote += `Valid transitions: ${VALID_TRANSITIONS[currentPhase].join(', ')}`;
      }
    }

    // Build result
    const result = {
      phase: topPhase.score >= PHASE_PATTERNS[topPhase.phase].minConfidence ? topPhase.phase : null,
      confidence: topPhase.score,
      reasoning: reasonings[topPhase.phase],
      isValidTransition: isValidTransition,
      transitionNote: transitionNote,
      suggestions: sortedPhases
        .filter(p => p.score >= 0.4)
        .slice(0, 3)
        .map(p => ({
          phase: p.phase,
          confidence: p.score,
          reasoning: reasonings[p.phase]
        })),
      allScores: scores
    };

    return result;
  }

  /**
   * Scores a specific phase against user input
   * @param {string} input - Normalized user input
   * @param {string} phase - Phase name
   * @param {Object} pattern - Phase pattern configuration
   * @returns {Object} Score and reasoning
   * @private
   */
  _scorePhase(input, phase, pattern) {
    let score = 0;
    const matches = [];

    // Score keywords (0-0.5 range)
    const keywordMatches = [];
    for (const keyword of pattern.keywords) {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      if (regex.test(input)) {
        keywordMatches.push(keyword);
      }
    }

    if (keywordMatches.length > 0) {
      // Logarithmic scoring for keywords to prevent over-weighting
      const keywordScore = Math.min(0.5, 0.2 + (Math.log(keywordMatches.length + 1) / 10));
      score += keywordScore;
      matches.push(`keywords: ${keywordMatches.slice(0, 3).join(', ')}`);
    }

    // Score regex patterns (0-0.4 range)
    const patternMatches = [];
    for (const regex of pattern.patterns) {
      if (regex.test(input)) {
        patternMatches.push(regex.source.slice(0, 30));
      }
    }

    if (patternMatches.length > 0) {
      const patternScore = Math.min(0.4, 0.3 + (patternMatches.length * 0.1));
      score += patternScore;
      matches.push(`patterns: ${patternMatches.length} matched`);
    }

    // Score context clues (0-0.3 range)
    const clueMatches = [];
    for (const clue of pattern.contextClues) {
      if (input.includes(clue.toLowerCase())) {
        clueMatches.push(clue);
      }
    }

    if (clueMatches.length > 0) {
      const clueScore = Math.min(0.3, 0.2 + (clueMatches.length * 0.05));
      score += clueScore;
      matches.push(`context: ${clueMatches.slice(0, 2).join(', ')}`);
    }

    // Apply phase weight
    score *= pattern.weight;

    // Cap at 1.0
    score = Math.min(1.0, score);

    const reasoning = matches.length > 0
      ? `Matched ${matches.join('; ')}`
      : 'No significant matches';

    return { score, reasoning };
  }

  /**
   * Validates if a phase transition is allowed
   * @param {string} fromPhase - Current phase
   * @param {string} toPhase - Target phase
   * @returns {boolean} Whether transition is valid
   * @private
   */
  _isValidTransition(fromPhase, toPhase) {
    // Emergency phases can be accessed from anywhere
    if (EMERGENCY_PHASES.includes(toPhase)) {
      return true;
    }

    // Check if transition is in valid transitions map
    const validNext = VALID_TRANSITIONS[fromPhase] || [];
    return validNext.includes(toPhase);
  }

  /**
   * Gets valid next phases for current phase
   * @param {string} currentPhase - Current phase
   * @returns {Array} Array of valid next phase names
   */
  getValidNextPhases(currentPhase) {
    return VALID_TRANSITIONS[currentPhase] || [];
  }

  /**
   * Suggests a phase based on project state
   * @param {Object} state - Project state from StateManager
   * @returns {Object} Suggested phase with reasoning
   */
  suggestNextPhase(state) {
    const currentPhase = state.current_phase;
    const validNext = this.getValidNextPhases(currentPhase);

    // Check for blockers
    const unresolvedBlockers = state.blockers.filter(b => !b.resolved);
    if (unresolvedBlockers.some(b => b.severity === 'critical')) {
      return {
        phase: 'research',
        reasoning: 'Critical blockers detected, recommend research phase to resolve',
        confidence: 0.9
      };
    }

    // Check quality score of current phase
    const currentScore = state.quality_scores[currentPhase];
    if (currentScore !== undefined) {
      const minScore = this._getMinimumQualityScore(currentPhase);

      if (currentScore < minScore) {
        return {
          phase: currentPhase,
          reasoning: `Quality score ${currentScore} below minimum ${minScore}, stay in ${currentPhase}`,
          confidence: 0.95
        };
      }
    }

    // Normal progression
    if (validNext.length === 1) {
      return {
        phase: validNext[0],
        reasoning: `Natural progression from ${currentPhase}`,
        confidence: 0.85
      };
    }

    // Multiple options, suggest most common path
    const commonPath = {
      research: 'planning',
      planning: 'design',
      design: 'test-first',
      'test-first': 'implementation',
      implementation: 'validation',
      validation: 'iteration',
      iteration: 'validation'
    };

    return {
      phase: commonPath[currentPhase] || validNext[0],
      reasoning: `Recommended next phase after ${currentPhase}`,
      confidence: 0.7
    };
  }

  /**
   * Gets minimum quality score for a phase
   * @param {string} phase - Phase name
   * @returns {number} Minimum score
   * @private
   */
  _getMinimumQualityScore(phase) {
    const minimums = {
      research: 80,
      planning: 85,
      design: 85,
      'test-first': 90,
      implementation: 90,
      validation: 85,
      iteration: 85
    };

    return minimums[phase] || 80;
  }

  /**
   * Extracts keywords from user input
   * @param {string} input - User input
   * @param {number} limit - Maximum keywords to return
   * @returns {Array} Array of keywords
   */
  extractKeywords(input, limit = 10) {
    // Normalize input
    const normalized = input.toLowerCase().trim();

    // Common stop words to filter out
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
      'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'should', 'could', 'can', 'may', 'might', 'must',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'this', 'that', 'these',
      'those', 'to', 'from', 'in', 'on', 'at', 'by', 'for', 'with', 'about'
    ]);

    // Extract words (alphanumeric sequences)
    const words = normalized.match(/\b[a-z0-9]+\b/g) || [];

    // Filter stop words and get unique words
    const keywords = [...new Set(words.filter(w => !stopWords.has(w) && w.length > 2))];

    // Return top N by frequency (simple approach)
    return keywords.slice(0, limit);
  }

  /**
   * Analyzes input and provides detailed phase breakdown
   * @param {string} userInput - User input
   * @param {string} currentPhase - Current phase
   * @returns {Object} Detailed analysis
   */
  analyze(userInput, currentPhase = null) {
    const inference = this.infer(userInput, currentPhase);
    const keywords = this.extractKeywords(userInput);

    return {
      inference: inference,
      keywords: keywords,
      input: userInput,
      currentPhase: currentPhase,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = PhaseInference;
