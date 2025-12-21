/**
 * Human-In-Loop Detector - Intelligent guardrails for tasks requiring human review
 *
 * Detects situations where AI should pause and wait for human input:
 * - Design reviews and architecture decisions
 * - Manual testing and quality assurance
 * - Security-sensitive operations
 * - Strategic decisions and planning
 * - Deployment and production changes
 * - Legal/compliance reviews
 *
 * Learning Features:
 * - Pattern recognition from historical stops
 * - Confidence scoring based on past accuracy
 * - User feedback integration
 * - Adaptive thresholds
 * - False positive/negative tracking
 *
 * @module human-in-loop-detector
 */

const { createComponentLogger } = require('./logger');

class HumanInLoopDetector {
  /**
   * Create a human-in-loop detector
   *
   * @param {Object} components - System components
   * @param {MemoryStore} components.memoryStore - Memory store for persistence
   * @param {Object} options - Configuration
   */
  constructor(components, options = {}) {
    this.logger = createComponentLogger('HumanInLoopDetector');

    this.memoryStore = components.memoryStore;

    // Configuration
    this.options = {
      enabled: options.enabled !== false,

      // Detection thresholds
      confidenceThreshold: options.confidenceThreshold || 0.7,  // 70% confidence to trigger
      minPatternMatches: options.minPatternMatches || 3,        // Need 3+ similar cases

      // Learning parameters
      learningRate: options.learningRate || 0.1,
      adaptiveThresholds: options.adaptiveThresholds !== false,

      // Behavior
      requireApproval: options.requireApproval !== false,       // Require explicit approval
      autoResumeOnLowConfidence: options.autoResumeOnLowConfidence || false,

      ...options
    };

    // Known patterns (seed data - will learn more over time)
    this.patterns = {
      // High-risk operations
      highRisk: {
        keywords: [
          'deploy', 'production', 'release', 'publish',
          'delete', 'drop', 'remove database', 'migrate production',
          'security', 'credentials', 'api key', 'secret',
          'payment', 'billing', 'financial'
        ],
        confidence: 0.95,
        reason: 'High-risk operation detected'
      },

      // Design and architecture
      design: {
        keywords: [
          'architecture decision', 'design choice', 'technical approach',
          'trade-off', 'technology selection', 'framework choice',
          'should we use', 'which approach', 'better to',
          'decide whether', 'choose between', 'which database',
          'which framework', 'decide', 'architecture'
        ],
        confidence: 0.85,
        reason: 'Design/architecture decision requires review'
      },

      // Manual verification needed
      manualTest: {
        keywords: [
          'manual test', 'manually verify', 'user acceptance',
          'visual inspection', 'human review', 'check manually',
          'test in browser', 'click through', 'verify visually'
        ],
        confidence: 0.90,
        reason: 'Manual testing/verification required'
      },

      // Strategic decisions
      strategic: {
        keywords: [
          'business decision', 'strategic direction', 'roadmap',
          'priority', 'investment', 'resource allocation',
          'hire', 'budget', 'contract'
        ],
        confidence: 0.90,
        reason: 'Strategic decision requires human judgment'
      },

      // Legal/compliance
      legal: {
        keywords: [
          'legal', 'compliance', 'gdpr', 'privacy policy',
          'terms of service', 'license', 'copyright',
          'regulatory', 'audit'
        ],
        confidence: 0.95,
        reason: 'Legal/compliance review required'
      },

      // Quality gates
      qualityGate: {
        keywords: [
          'code review', 'pull request review', 'approve merge',
          'quality check', 'acceptance criteria',
          'ready for production', 'sign off'
        ],
        confidence: 0.85,
        reason: 'Quality gate requires human approval'
      },

      // User experience
      userExperience: {
        keywords: [
          'user experience', 'ui design', 'user interface',
          'usability', 'accessibility', 'user flow',
          'customer feedback', 'user testing'
        ],
        confidence: 0.80,
        reason: 'User experience requires human evaluation'
      }
    };

    // Detection tracking (Map for quick lookups)
    this.detections = new Map();

    // Learning state
    this.learningData = {
      detections: [],           // Historical detection events
      userFeedback: [],         // User feedback on detections
      patternAccuracy: {},      // Accuracy per pattern
      customPatterns: [],       // Learned patterns from feedback
      stats: {
        totalDetections: 0,
        truePositives: 0,       // Correctly stopped
        falsePositives: 0,      // Stopped but shouldn't have
        trueNegatives: 0,       // Correctly continued
        falseNegatives: 0,      // Continued but should have stopped
        precision: 0,           // TP / (TP + FP)
        recall: 0               // TP / (TP + FN)
      }
    };

    this._loadLearningData();
    this._initializeDatabase();

    this.logger.info('HumanInLoopDetector initialized', {
      enabled: this.options.enabled,
      confidenceThreshold: this.options.confidenceThreshold,
      patterns: Object.keys(this.patterns).length
    });
  }

  /**
   * Analyze task and determine if human review is needed
   *
   * @param {Object} context - Task context
   * @param {string} context.task - Task description
   * @param {string} context.phase - Current phase (research, design, etc.)
   * @param {string} context.type - Task type
   * @param {Object} context.metadata - Additional metadata
   * @returns {Object} Detection result
   */
  async analyze(context) {
    if (!this.options.enabled) {
      return {
        requiresHuman: false,
        confidence: 0,
        reason: 'Detector disabled'
      };
    }

    // Handle null/undefined context
    if (!context) {
      context = {};
    }

    const {
      task = '',
      phase = 'unknown',
      type = 'unknown',
      metadata = {}
    } = context;

    // Combine all text for analysis
    const text = [
      task,
      phase,
      type,
      JSON.stringify(metadata)
    ].join(' ').toLowerCase();

    // Check against all patterns
    const matches = [];

    for (const [patternName, pattern] of Object.entries(this.patterns)) {
      const matchCount = this._countKeywordMatches(text, pattern.keywords);

      if (matchCount > 0) {
        matches.push({
          pattern: patternName,
          matchCount,
          baseConfidence: pattern.confidence,
          reason: pattern.reason,
          keywords: this._getMatchedKeywords(text, pattern.keywords)
        });
      }
    }

    // Check custom learned patterns
    for (const customPattern of this.learningData.customPatterns) {
      const matchCount = this._countKeywordMatches(text, customPattern.keywords);

      if (matchCount > 0) {
        matches.push({
          pattern: 'learned:' + customPattern.id,
          matchCount,
          baseConfidence: customPattern.confidence,
          reason: customPattern.reason,
          keywords: this._getMatchedKeywords(text, customPattern.keywords),
          learned: true
        });
      }
    }

    // No matches - continue normally
    if (matches.length === 0) {
      return {
        requiresHuman: false,
        confidence: 0,
        reason: 'No concerning patterns detected',
        matches: []
      };
    }

    // Calculate final confidence score
    const topMatch = matches.sort((a, b) =>
      (b.baseConfidence * b.matchCount) - (a.baseConfidence * a.matchCount)
    )[0];

    // Adjust confidence based on historical accuracy
    let adjustedConfidence = topMatch.baseConfidence;

    if (this.learningData.patternAccuracy[topMatch.pattern]) {
      const accuracy = this.learningData.patternAccuracy[topMatch.pattern];
      adjustedConfidence = (topMatch.baseConfidence * 0.7) + (accuracy.precision * 0.3);
    }

    // Reduce confidence for safe contexts (documentation, testing, writing)
    const safeContextKeywords = ['write', 'documentation', 'tests for', 'test', 'example', 'tutorial', 'guide'];
    const hasSafeContext = safeContextKeywords.some(keyword => text.includes(keyword));

    if (hasSafeContext && topMatch.pattern === 'highRisk') {
      // Reduce confidence by 20% for safe contexts
      adjustedConfidence = adjustedConfidence * 0.8;
    }

    // Boost confidence if multiple patterns match
    if (matches.length > 1) {
      adjustedConfidence = Math.min(0.99, adjustedConfidence * 1.1);
    }

    const requiresHuman = adjustedConfidence >= this.options.confidenceThreshold;

    // Generate unique detection ID
    const detectionId = `det-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const result = {
      requiresHuman,
      confidence: adjustedConfidence,
      reason: topMatch.reason,
      pattern: topMatch.pattern,
      matchedKeywords: topMatch.keywords,  // Add matched keywords to result
      detectionId,
      matches,
      recommendation: this._getRecommendation(topMatch, adjustedConfidence),
      context: {
        phase,
        type,
        taskPreview: task.substring(0, 100)
      }
    };

    // Record detection
    await this._recordDetection(result, context);

    if (requiresHuman) {
      this.logger.warn('Human review required', {
        confidence: adjustedConfidence.toFixed(2),
        pattern: topMatch.pattern,
        reason: topMatch.reason
      });
    }

    return result;
  }

  /**
   * Record user feedback on detection
   * This is how the system learns!
   *
   * @param {string} detectionId - Detection ID
   * @param {Object} feedback - User feedback
   * @param {boolean} feedback.wasCorrect - Was the detection correct?
   * @param {string} feedback.actualNeed - Did it actually need human? (yes/no/unsure)
   * @param {string} feedback.comment - Optional comment
   */
  async recordFeedback(detectionId, feedback) {
    // Try Map first for quick lookup
    let detection = this.detections.get(detectionId);

    // Fallback to array search
    if (!detection) {
      detection = this.learningData.detections.find(d => d.id === detectionId);
    }

    if (!detection) {
      this.logger.error('Detection not found', { detectionId });
      return {
        success: false,
        error: 'Detection not found',
        stats: this.learningData.stats
      };
    }

    const feedbackRecord = {
      detectionId,
      timestamp: Date.now(),
      wasCorrect: feedback.wasCorrect,
      actualNeed: feedback.actualNeed,
      comment: feedback.comment || '',
      pattern: detection.pattern,
      confidence: detection.confidence
    };

    this.learningData.userFeedback.push(feedbackRecord);

    // Update statistics
    const predicted = detection.requiresHuman;
    const actual = feedback.actualNeed === 'yes';

    if (predicted && actual) {
      this.learningData.stats.truePositives++;
    } else if (predicted && !actual) {
      this.learningData.stats.falsePositives++;
    } else if (!predicted && !actual) {
      this.learningData.stats.trueNegatives++;
    } else if (!predicted && actual) {
      this.learningData.stats.falseNegatives++;
    }

    // Recalculate metrics
    this._updateStatistics();

    // Update pattern accuracy
    this._updatePatternAccuracy(detection.pattern, predicted, actual);

    // Learn new patterns from false negatives
    if (!predicted && actual && feedback.comment) {
      await this._learnFromMiss(detection, feedback);
    }

    // Adjust thresholds if adaptive learning enabled
    if (this.options.adaptiveThresholds) {
      this._adaptThresholds();
    }

    // Persist learning data
    this._saveLearningData();

    // Save feedback to database
    if (this.memoryStore) {
      try {
        const stmt = this.memoryStore.db.prepare(`
          INSERT INTO human_in_loop_feedback (
            detection_id, timestamp, was_correct, actual_need, comment, pattern, confidence
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          detectionId,
          feedbackRecord.timestamp,
          feedback.wasCorrect ? 1 : 0,
          feedback.actualNeed,
          feedback.comment || '',
          feedbackRecord.pattern,
          feedbackRecord.confidence
        );
      } catch (error) {
        this.logger.warn('Failed to save feedback to database', {
          error: error.message
        });
      }
    }

    this.logger.info('Feedback recorded', {
      detectionId,
      wasCorrect: feedback.wasCorrect,
      newPrecision: this.learningData.stats.precision.toFixed(2),
      newRecall: this.learningData.stats.recall.toFixed(2)
    });

    return {
      success: true,
      stats: this.learningData.stats
    };
  }

  /**
   * Get current learning statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    return {
      enabled: this.options.enabled,
      thresholds: {
        confidence: this.options.confidenceThreshold,
        minPatternMatches: this.options.minPatternMatches
      },
      patterns: {
        builtin: Object.keys(this.patterns).length,
        learned: this.learningData.customPatterns.length,
        total: Object.keys(this.patterns).length + this.learningData.customPatterns.length
      },
      statistics: { ...this.learningData.stats },
      patternAccuracy: { ...this.learningData.patternAccuracy },
      recentFeedback: this.learningData.userFeedback.slice(-10)
    };
  }

  /**
   * Get recommendation text
   * @private
   */
  _getRecommendation(match, confidence) {
    if (confidence >= 0.95) {
      return 'STOP - Very high confidence this requires human review';
    } else if (confidence >= 0.85) {
      return 'PAUSE - High confidence, recommend human review';
    } else if (confidence >= 0.70) {
      return 'REVIEW - Moderate confidence, consider human input';
    } else {
      return 'CONTINUE - Low confidence, likely safe to proceed';
    }
  }

  /**
   * Count keyword matches in text
   * @private
   */
  _countKeywordMatches(text, keywords) {
    let count = 0;
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get matched keywords
   * @private
   */
  _getMatchedKeywords(text, keywords) {
    return keywords.filter(keyword =>
      text.includes(keyword.toLowerCase())
    );
  }

  /**
   * Record detection event
   * @private
   */
  async _recordDetection(result, context) {
    const detection = {
      id: result.detectionId,  // Use the ID from result
      timestamp: Date.now(),
      requiresHuman: result.requiresHuman,
      confidence: result.confidence,
      pattern: result.pattern,
      reason: result.reason,
      context: {
        task: context.task?.substring(0, 200),
        phase: context.phase,
        type: context.type
      },
      matches: result.matches.length,
      feedback: null  // Will be updated when user provides feedback
    };

    this.learningData.detections.push(detection);
    this.detections.set(result.detectionId, detection);  // Store in Map for quick lookup
    this.learningData.stats.totalDetections++;

    // Keep only last 1000 detections in memory
    if (this.learningData.detections.length > 1000) {
      this.learningData.detections.shift();
    }

    // Save to database
    if (this.memoryStore) {
      try {
        const stmt = this.memoryStore.db.prepare(`
          INSERT INTO human_loop_detections (
            id, timestamp, requires_human, confidence, pattern, reason, context_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          detection.id,
          detection.timestamp,
          detection.requiresHuman ? 1 : 0,
          detection.confidence,
          detection.pattern,
          detection.reason,
          JSON.stringify(detection.context)
        );
      } catch (error) {
        this.logger.warn('Failed to save detection to database', {
          error: error.message
        });
      }
    }
  }

  /**
   * Update pattern accuracy metrics
   * @private
   */
  _updatePatternAccuracy(pattern, predicted, actual) {
    if (!this.learningData.patternAccuracy[pattern]) {
      this.learningData.patternAccuracy[pattern] = {
        truePositives: 0,
        falsePositives: 0,
        trueNegatives: 0,
        falseNegatives: 0,
        precision: 0,
        recall: 0
      };
    }

    const accuracy = this.learningData.patternAccuracy[pattern];

    if (predicted && actual) {
      accuracy.truePositives++;
    } else if (predicted && !actual) {
      accuracy.falsePositives++;
    } else if (!predicted && !actual) {
      accuracy.trueNegatives++;
    } else {
      accuracy.falseNegatives++;
    }

    // Calculate precision and recall
    const tp = accuracy.truePositives;
    const fp = accuracy.falsePositives;
    const fn = accuracy.falseNegatives;

    accuracy.precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    accuracy.recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  }

  /**
   * Update overall statistics
   * @private
   */
  _updateStatistics() {
    const stats = this.learningData.stats;

    const tp = stats.truePositives;
    const fp = stats.falsePositives;
    const fn = stats.falseNegatives;

    stats.precision = (tp + fp) > 0 ? tp / (tp + fp) : 0;
    stats.recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
  }

  /**
   * Learn new pattern from missed detection (false negative)
   * @private
   */
  async _learnFromMiss(detection, feedback) {
    // Extract potential new keywords from the task
    const task = detection.context.task || '';
    const words = task.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4); // Only meaningful words

    // Find common words not in existing patterns
    const newKeywords = words.filter(word => {
      return !this._isInExistingPatterns(word);
    });

    if (newKeywords.length === 0) {
      return;
    }

    // Create new learned pattern
    const learnedPattern = {
      id: `learned-${Date.now()}`,
      keywords: newKeywords.slice(0, 5), // Top 5 new keywords
      confidence: 0.6, // Start conservative
      reason: `Learned pattern: ${feedback.comment || 'User indicated review needed'}`,
      learnedFrom: detection.id,
      timestamp: Date.now(),
      useCount: 0
    };

    this.learningData.customPatterns.push(learnedPattern);

    // Also add to main patterns with learned_ prefix
    const patternKey = `learned_${Date.now()}`;
    this.patterns[patternKey] = {
      keywords: newKeywords.slice(0, 5),
      confidence: 0.6,
      reason: `Learned pattern: ${feedback.comment || 'User indicated review needed'}`
    };

    this.logger.info('Learned new pattern from feedback', {
      patternId: learnedPattern.id,
      keywords: learnedPattern.keywords,
      reason: learnedPattern.reason
    });
  }

  /**
   * Check if word exists in any pattern
   * @private
   */
  _isInExistingPatterns(word) {
    for (const pattern of Object.values(this.patterns)) {
      if (pattern.keywords.some(k => k.includes(word))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Adapt thresholds based on performance
   * @private
   */
  _adaptThresholds() {
    const stats = this.learningData.stats;

    // If precision is low (too many false positives), increase threshold
    if (stats.precision < 0.7 && stats.falsePositives > 5) {
      this.options.confidenceThreshold = Math.min(
        0.95,
        this.options.confidenceThreshold + 0.05
      );

      this.logger.info('Threshold increased due to low precision', {
        newThreshold: this.options.confidenceThreshold,
        precision: stats.precision.toFixed(2)
      });
    }

    // If recall is low (too many false negatives), decrease threshold
    if (stats.recall < 0.7 && stats.falseNegatives > 5) {
      this.options.confidenceThreshold = Math.max(
        0.5,
        this.options.confidenceThreshold - 0.05
      );

      this.logger.info('Threshold decreased due to low recall', {
        newThreshold: this.options.confidenceThreshold,
        recall: stats.recall.toFixed(2)
      });
    }
  }

  /**
   * Initialize database tables
   * @private
   */
  _initializeDatabase() {
    if (!this.memoryStore) {
      return;
    }

    try {
      this.memoryStore.db.exec(`
        CREATE TABLE IF NOT EXISTS human_loop_detections (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          requires_human INTEGER NOT NULL,
          confidence REAL NOT NULL,
          pattern TEXT NOT NULL,
          reason TEXT NOT NULL,
          context_json TEXT,
          feedback_json TEXT,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_human_loop_timestamp
        ON human_loop_detections(timestamp);

        CREATE INDEX IF NOT EXISTS idx_human_loop_pattern
        ON human_loop_detections(pattern);

        CREATE TABLE IF NOT EXISTS human_in_loop_feedback (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          detection_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          was_correct INTEGER NOT NULL,
          actual_need TEXT NOT NULL,
          comment TEXT,
          pattern TEXT,
          confidence REAL,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_feedback_detection
        ON human_in_loop_feedback(detection_id);
      `);
    } catch (error) {
      this.logger.warn('Failed to create human loop tables', {
        error: error.message
      });
    }
  }

  /**
   * Load learning data from persistence
   * @private
   */
  _loadLearningData() {
    if (!this.memoryStore) {
      return;
    }

    try {
      const stmt = this.memoryStore.db.prepare(`
        SELECT data FROM human_in_loop_learning
        WHERE id = 'current'
      `);

      const row = stmt.get();

      if (row) {
        const loaded = JSON.parse(row.data);

        this.learningData = {
          ...this.learningData,
          ...loaded
        };

        this.logger.info('Learning data loaded', {
          customPatterns: this.learningData.customPatterns.length,
          totalDetections: this.learningData.stats.totalDetections,
          precision: this.learningData.stats.precision.toFixed(2)
        });
      }
    } catch (error) {
      // Table might not exist
      try {
        this.memoryStore.db.exec(`
          CREATE TABLE IF NOT EXISTS human_in_loop_learning (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
      } catch (createError) {
        this.logger.warn('Could not create learning table', {
          error: createError.message
        });
      }
    }
  }

  /**
   * Save learning data to persistence
   * @private
   */
  _saveLearningData() {
    if (!this.memoryStore) {
      return;
    }

    try {
      const data = JSON.stringify(this.learningData);

      const stmt = this.memoryStore.db.prepare(`
        INSERT OR REPLACE INTO human_in_loop_learning (id, data, updated_at)
        VALUES ('current', ?, ?)
      `);

      stmt.run(data, Date.now());

      this.logger.debug('Learning data saved');
    } catch (error) {
      this.logger.error('Failed to save learning data', {
        error: error.message
      });
    }
  }

  /**
   * Reset learning data (for testing or emergency)
   * @param {boolean} confirm - Must be true to execute
   */
  reset(confirm = false) {
    if (!confirm) {
      throw new Error('Reset requires explicit confirmation');
    }

    this.learningData = {
      detections: [],
      userFeedback: [],
      patternAccuracy: {},
      customPatterns: [],
      stats: {
        totalDetections: 0,
        truePositives: 0,
        falsePositives: 0,
        trueNegatives: 0,
        falseNegatives: 0,
        precision: 0,
        recall: 0
      }
    };

    this._saveLearningData();

    this.logger.warn('Learning data reset to defaults');
  }
}

module.exports = HumanInLoopDetector;
