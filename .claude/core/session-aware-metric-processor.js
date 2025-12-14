/**
 * Session-Aware Metric Processor
 *
 * Enhanced metric processor that accurately tracks metrics across:
 * - Multiple Claude Code sessions running in parallel
 * - Different projects being worked on simultaneously
 * - Multiple users on the same system
 * - Concurrent agent operations
 *
 * Key Features:
 * - Session isolation and tracking
 * - Project-based metric segregation
 * - Resource attribution per session/project
 * - Accurate parallel operation tracking
 * - Session merging and splitting detection
 *
 * @module session-aware-metric-processor
 */

const { createComponentLogger } = require('./logger');
const EventEmitter = require('events');

class SessionAwareMetricProcessor extends EventEmitter {
  constructor(options = {}) {
    super();

    this.logger = createComponentLogger('SessionAwareMetricProcessor');

    this.options = {
      // Session management
      maxConcurrentSessions: 10,
      sessionTimeoutMs: 3600000, // 1 hour
      orphanSessionCleanupMs: 7200000, // 2 hours

      // Project tracking
      autoDetectProjects: true,
      projectPathPatterns: [
        /Claude Projects[\/\\]([^\/\\]+)/,
        /projects[\/\\]([^\/\\]+)/,
        /repos[\/\\]([^\/\\]+)/
      ],

      // Metric segregation
      segregateBySession: true,
      segregateByProject: true,
      segregateByModel: true,

      // Aggregation settings
      aggregateAcrossSessions: false,
      aggregationWindowMs: 60000, // 1 minute

      // Persistence
      persistSessionMetrics: true,
      sessionMetricsRetentionDays: 30,

      ...options
    };

    // Session tracking structures
    this.sessions = new Map();        // sessionId -> SessionContext
    this.projects = new Map();        // projectId -> ProjectContext
    this.sessionProjects = new Map(); // sessionId -> Set<projectId>
    this.projectSessions = new Map(); // projectId -> Set<sessionId>

    // Metric buffers per session/project
    this.sessionMetrics = new Map();  // sessionId -> MetricsBuffer
    this.projectMetrics = new Map();  // projectId -> MetricsBuffer

    // Resource attribution
    this.resourceAttribution = new Map(); // resourceId -> { sessionId, projectId }

    // Initialize cleanup intervals
    this._initializeCleanup();

    this.logger.info('Session-aware metric processor initialized', {
      maxConcurrentSessions: this.options.maxConcurrentSessions,
      segregation: {
        bySession: this.options.segregateBySession,
        byProject: this.options.segregateByProject,
        byModel: this.options.segregateByModel
      }
    });
  }

  /**
   * Process incoming OTLP metrics with session awareness
   */
  processMetrics(otlpData, context = {}) {
    try {
      // Extract session and project identifiers
      const { sessionId, projectId, resourceId } = this._extractIdentifiers(otlpData, context);

      // Validate and create session if needed
      const session = this._ensureSession(sessionId, projectId);

      // Process metrics for this specific session
      const processed = this._processSessionMetrics(otlpData, session);

      // Update project metrics if applicable
      if (projectId) {
        this._updateProjectMetrics(projectId, processed);
      }

      // Track resource attribution
      if (resourceId) {
        this._trackResourceAttribution(resourceId, sessionId, projectId);
      }

      // Emit session-specific events
      this.emit('metrics:processed', {
        sessionId,
        projectId,
        metrics: processed,
        session: this._getSessionSummary(sessionId)
      });

      // Check for cross-session patterns
      this._detectCrossSessionPatterns();

      return {
        success: true,
        sessionId,
        projectId,
        processed
      };

    } catch (error) {
      this.logger.error('Failed to process metrics', { error: error.message });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Extract session and project identifiers from OTLP data
   * @private
   */
  _extractIdentifiers(otlpData, context) {
    let sessionId = null;
    let projectId = null;
    let resourceId = null;

    // Check resource attributes for identifiers
    if (otlpData.resourceMetrics?.[0]?.resource?.attributes) {
      const attributes = otlpData.resourceMetrics[0].resource.attributes;

      attributes.forEach(attr => {
        switch(attr.key) {
          case 'service.instance.id':
          case 'claude.session.id':
          case 'session.id':
            sessionId = attr.value?.stringValue || attr.value;
            break;

          case 'project.name':
          case 'claude.project.name':
          case 'project.id':
            projectId = attr.value?.stringValue || attr.value;
            break;

          case 'resource.id':
          case 'service.name':
            resourceId = attr.value?.stringValue || attr.value;
            break;

          case 'project.path':
          case 'working.directory':
            // Try to extract project from path
            if (!projectId && this.options.autoDetectProjects) {
              const path = attr.value?.stringValue || attr.value;
              projectId = this._extractProjectFromPath(path);
            }
            break;
        }
      });
    }

    // Check metric attributes as fallback
    if (!sessionId || !projectId) {
      otlpData.resourceMetrics?.forEach(rm => {
        rm.scopeMetrics?.forEach(sm => {
          sm.metrics?.forEach(metric => {
            metric.sum?.dataPoints?.forEach(dp => {
              dp.attributes?.forEach(attr => {
                if (!sessionId && attr.key === 'session_id') {
                  sessionId = attr.value?.stringValue;
                }
                if (!projectId && attr.key === 'project_id') {
                  projectId = attr.value?.stringValue;
                }
              });
            });
          });
        });
      });
    }

    // Use context as fallback
    sessionId = sessionId || context.sessionId || `unknown-${Date.now()}`;
    projectId = projectId || context.projectId || 'default';
    resourceId = resourceId || context.resourceId || 'claude-code';

    return { sessionId, projectId, resourceId };
  }

  /**
   * Extract project name from file path
   * @private
   */
  _extractProjectFromPath(path) {
    if (!path) return null;

    for (const pattern of this.options.projectPathPatterns) {
      const match = path.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    // Fallback: use last directory name
    const parts = path.split(/[\/\\]/);
    return parts[parts.length - 1] || null;
  }

  /**
   * Ensure session exists and is tracked
   * @private
   */
  _ensureSession(sessionId, projectId) {
    if (!this.sessions.has(sessionId)) {
      // Check session limit
      if (this.sessions.size >= this.options.maxConcurrentSessions) {
        this._cleanupOldestSession();
      }

      const session = {
        id: sessionId,
        projectId,
        startTime: Date.now(),
        lastActivity: Date.now(),
        metrics: {
          totalTokens: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          operations: 0,
          errors: 0,
          checkpoints: 0,
          compactionEvents: 0
        },
        contextWindow: {
          current: 0,
          max: 200000,
          utilizationHistory: []
        },
        models: new Set(),
        activeOperations: new Map()
      };

      this.sessions.set(sessionId, session);
      this.sessionMetrics.set(sessionId, []);

      // Track session-project relationship
      if (projectId) {
        if (!this.sessionProjects.has(sessionId)) {
          this.sessionProjects.set(sessionId, new Set());
        }
        this.sessionProjects.get(sessionId).add(projectId);

        if (!this.projectSessions.has(projectId)) {
          this.projectSessions.set(projectId, new Set());
        }
        this.projectSessions.get(projectId).add(sessionId);

        // Ensure project exists
        if (!this.projects.has(projectId)) {
          this.projects.set(projectId, {
            id: projectId,
            sessions: new Set([sessionId]),
            totalTokens: 0,
            totalCost: 0,
            startTime: Date.now(),
            lastActivity: Date.now()
          });
          this.projectMetrics.set(projectId, []);
        }
      }

      this.logger.info('New session created', {
        sessionId,
        projectId,
        totalSessions: this.sessions.size
      });

      this.emit('session:created', { sessionId, projectId });
    }

    const session = this.sessions.get(sessionId);
    session.lastActivity = Date.now();

    return session;
  }

  /**
   * Process metrics for a specific session
   * @private
   */
  _processSessionMetrics(otlpData, session) {
    const processed = {
      timestamp: Date.now(),
      metrics: []
    };

    // Extract metrics from OTLP data
    otlpData.resourceMetrics?.forEach(rm => {
      rm.scopeMetrics?.forEach(sm => {
        sm.metrics?.forEach(metric => {
          const metricData = this._extractMetricData(metric);

          // Update session metrics based on metric type
          if (metric.name.includes('token')) {
            this._updateTokenMetrics(session, metricData);
          } else if (metric.name.includes('context')) {
            this._updateContextMetrics(session, metricData);
          } else if (metric.name.includes('operation')) {
            this._updateOperationMetrics(session, metricData);
          } else if (metric.name.includes('error')) {
            session.metrics.errors += metricData.value || 0;
          } else if (metric.name.includes('checkpoint')) {
            session.metrics.checkpoints += metricData.value || 0;
          } else if (metric.name.includes('compaction')) {
            session.metrics.compactionEvents += metricData.value || 0;
          }

          // Track model usage
          if (metricData.attributes?.model) {
            session.models.add(metricData.attributes.model);
          }

          processed.metrics.push({
            name: metric.name,
            value: metricData.value,
            timestamp: metricData.timestamp,
            attributes: metricData.attributes
          });
        });
      });
    });

    // Store in session buffer
    const buffer = this.sessionMetrics.get(session.id) || [];
    buffer.push(processed);

    // Limit buffer size
    if (buffer.length > 1000) {
      buffer.shift();
    }

    this.sessionMetrics.set(session.id, buffer);

    return processed;
  }

  /**
   * Extract metric data from OTLP metric
   * @private
   */
  _extractMetricData(metric) {
    const data = {
      name: metric.name,
      timestamp: Date.now(),
      value: 0,
      attributes: {}
    };

    // Handle different metric types
    if (metric.sum) {
      const dp = metric.sum.dataPoints?.[0];
      if (dp) {
        data.value = parseInt(dp.asInt || dp.asDouble || dp.value || 0);
        data.timestamp = dp.timeUnixNano ? parseInt(dp.timeUnixNano) / 1000000 : Date.now();

        // Extract attributes
        dp.attributes?.forEach(attr => {
          data.attributes[attr.key] = attr.value?.stringValue || attr.value;
        });
      }
    } else if (metric.gauge) {
      const dp = metric.gauge.dataPoints?.[0];
      if (dp) {
        data.value = parseInt(dp.asInt || dp.asDouble || dp.value || 0);
      }
    } else if (metric.histogram) {
      // For histograms, use the sum
      const dp = metric.histogram.dataPoints?.[0];
      if (dp) {
        data.value = dp.sum || 0;
      }
    }

    return data;
  }

  /**
   * Update token metrics for session
   * @private
   */
  _updateTokenMetrics(session, metricData) {
    const value = metricData.value || 0;

    if (metricData.name.includes('total')) {
      // For cumulative metrics, track the delta
      const delta = value - session.metrics.totalTokens;
      if (delta > 0) {
        session.metrics.totalTokens = value;
      }
    } else if (metricData.name.includes('input')) {
      session.metrics.inputTokens += value;
    } else if (metricData.name.includes('output')) {
      session.metrics.outputTokens += value;
    } else if (metricData.name.includes('cache_read')) {
      session.metrics.cacheReadTokens += value;
    } else if (metricData.name.includes('cache_write')) {
      session.metrics.cacheWriteTokens += value;
    }

    // Update context window tracking
    if (metricData.name.includes('context') || metricData.name.includes('total')) {
      session.contextWindow.current = value;

      // Track utilization history
      const utilization = value / session.contextWindow.max;
      session.contextWindow.utilizationHistory.push({
        timestamp: metricData.timestamp,
        utilization,
        tokens: value
      });

      // Keep only last 100 entries
      if (session.contextWindow.utilizationHistory.length > 100) {
        session.contextWindow.utilizationHistory.shift();
      }
    }
  }

  /**
   * Update context metrics for session
   * @private
   */
  _updateContextMetrics(session, metricData) {
    if (metricData.name.includes('window_size')) {
      session.contextWindow.max = metricData.value;
    } else if (metricData.name.includes('current')) {
      session.contextWindow.current = metricData.value;
    }
  }

  /**
   * Update operation metrics for session
   * @private
   */
  _updateOperationMetrics(session, metricData) {
    session.metrics.operations++;

    // Track active operations
    const operationId = metricData.attributes?.operation_id;
    if (operationId) {
      if (metricData.name.includes('start')) {
        session.activeOperations.set(operationId, {
          startTime: metricData.timestamp,
          type: metricData.attributes?.type || 'unknown'
        });
      } else if (metricData.name.includes('end')) {
        session.activeOperations.delete(operationId);
      }
    }
  }

  /**
   * Update project-level metrics
   * @private
   */
  _updateProjectMetrics(projectId, processed) {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.lastActivity = Date.now();

    // Aggregate metrics across all project sessions
    processed.metrics.forEach(metric => {
      if (metric.name.includes('token') && metric.value) {
        project.totalTokens += metric.value;

        // Calculate cost (simplified)
        const costPerToken = 0.00001; // Example rate
        project.totalCost += metric.value * costPerToken;
      }
    });

    // Store in project buffer
    const buffer = this.projectMetrics.get(projectId) || [];
    buffer.push({
      timestamp: Date.now(),
      metrics: processed.metrics
    });

    // Limit buffer size
    if (buffer.length > 1000) {
      buffer.shift();
    }

    this.projectMetrics.set(projectId, buffer);
  }

  /**
   * Track resource attribution
   * @private
   */
  _trackResourceAttribution(resourceId, sessionId, projectId) {
    this.resourceAttribution.set(resourceId, {
      sessionId,
      projectId,
      lastSeen: Date.now()
    });

    // Clean old attributions
    if (this.resourceAttribution.size > 1000) {
      const cutoff = Date.now() - 3600000; // 1 hour
      for (const [id, attr] of this.resourceAttribution.entries()) {
        if (attr.lastSeen < cutoff) {
          this.resourceAttribution.delete(id);
        }
      }
    }
  }

  /**
   * Detect patterns across multiple sessions
   * @private
   */
  _detectCrossSessionPatterns() {
    // Check for session merging (multiple sessions for same project)
    for (const [projectId, sessionIds] of this.projectSessions.entries()) {
      if (sessionIds.size > 1) {
        // Check if sessions are active simultaneously
        const activeSessions = Array.from(sessionIds)
          .map(id => this.sessions.get(id))
          .filter(s => s && Date.now() - s.lastActivity < 60000); // Active in last minute

        if (activeSessions.length > 1) {
          this.emit('pattern:parallel-sessions', {
            projectId,
            sessionCount: activeSessions.length,
            sessions: activeSessions.map(s => ({
              id: s.id,
              tokens: s.metrics.totalTokens
            }))
          });
        }
      }
    }

    // Check for rapid context growth across sessions
    let totalVelocity = 0;
    let sessionCount = 0;

    for (const session of this.sessions.values()) {
      if (session.contextWindow.utilizationHistory.length >= 2) {
        const recent = session.contextWindow.utilizationHistory.slice(-2);
        const timeDelta = (recent[1].timestamp - recent[0].timestamp) / 1000;
        const tokenDelta = recent[1].tokens - recent[0].tokens;

        if (timeDelta > 0) {
          const velocity = tokenDelta / timeDelta;
          totalVelocity += velocity;
          sessionCount++;
        }
      }
    }

    if (sessionCount > 0) {
      const avgVelocity = totalVelocity / sessionCount;
      if (avgVelocity > 500) { // >500 tokens/sec average
        this.emit('pattern:high-velocity', {
          averageVelocity: avgVelocity,
          sessionCount,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Get session summary
   * @private
   */
  _getSessionSummary(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const duration = Date.now() - session.startTime;
    const utilization = session.contextWindow.current / session.contextWindow.max;

    return {
      id: session.id,
      projectId: session.projectId,
      duration,
      metrics: { ...session.metrics },
      contextUtilization: utilization,
      contextRemaining: session.contextWindow.max - session.contextWindow.current,
      models: Array.from(session.models),
      activeOperations: session.activeOperations.size,
      lastActivity: session.lastActivity
    };
  }

  /**
   * Get metrics for specific session
   */
  getSessionMetrics(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    return {
      summary: this._getSessionSummary(sessionId),
      buffer: this.sessionMetrics.get(sessionId) || [],
      projects: this.sessionProjects.get(sessionId) ?
        Array.from(this.sessionProjects.get(sessionId)) : []
    };
  }

  /**
   * Get metrics for specific project
   */
  getProjectMetrics(projectId) {
    const project = this.projects.get(projectId);
    if (!project) return null;

    // Aggregate metrics from all project sessions
    const sessions = this.projectSessions.get(projectId) || new Set();
    let totalTokens = 0;
    let totalOperations = 0;

    for (const sessionId of sessions) {
      const session = this.sessions.get(sessionId);
      if (session) {
        totalTokens += session.metrics.totalTokens;
        totalOperations += session.metrics.operations;
      }
    }

    return {
      id: projectId,
      sessions: Array.from(sessions),
      totalTokens,
      totalOperations,
      totalCost: project.totalCost,
      duration: Date.now() - project.startTime,
      lastActivity: project.lastActivity,
      buffer: this.projectMetrics.get(projectId) || []
    };
  }

  /**
   * Get all active sessions
   */
  getActiveSessions() {
    const cutoff = Date.now() - 60000; // Active in last minute
    const active = [];

    for (const [id, session] of this.sessions.entries()) {
      if (session.lastActivity >= cutoff) {
        active.push(this._getSessionSummary(id));
      }
    }

    return active;
  }

  /**
   * Get global metrics across all sessions
   */
  getGlobalMetrics() {
    let totalTokens = 0;
    let totalOperations = 0;
    let totalErrors = 0;
    let totalCheckpoints = 0;
    let totalCompactionEvents = 0;

    for (const session of this.sessions.values()) {
      totalTokens += session.metrics.totalTokens;
      totalOperations += session.metrics.operations;
      totalErrors += session.metrics.errors;
      totalCheckpoints += session.metrics.checkpoints;
      totalCompactionEvents += session.metrics.compactionEvents;
    }

    return {
      activeSessions: this.sessions.size,
      activeProjects: this.projects.size,
      totalTokens,
      totalOperations,
      totalErrors,
      totalCheckpoints,
      totalCompactionEvents,
      resourceAttributions: this.resourceAttribution.size
    };
  }

  /**
   * Clean up old sessions
   * @private
   */
  _cleanupOldestSession() {
    let oldestSession = null;
    let oldestTime = Date.now();

    for (const [id, session] of this.sessions.entries()) {
      if (session.lastActivity < oldestTime) {
        oldestTime = session.lastActivity;
        oldestSession = id;
      }
    }

    if (oldestSession) {
      this._removeSession(oldestSession);
    }
  }

  /**
   * Remove a session
   * @private
   */
  _removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clean up relationships
    const projectIds = this.sessionProjects.get(sessionId);
    if (projectIds) {
      for (const projectId of projectIds) {
        const projectSessions = this.projectSessions.get(projectId);
        if (projectSessions) {
          projectSessions.delete(sessionId);

          // Remove project if no more sessions
          if (projectSessions.size === 0) {
            this.projects.delete(projectId);
            this.projectSessions.delete(projectId);
            this.projectMetrics.delete(projectId);
          }
        }
      }
    }

    // Remove session data
    this.sessions.delete(sessionId);
    this.sessionMetrics.delete(sessionId);
    this.sessionProjects.delete(sessionId);

    this.logger.info('Session removed', { sessionId });
    this.emit('session:removed', { sessionId });
  }

  /**
   * Initialize cleanup intervals
   * @private
   */
  _initializeCleanup() {
    // Clean up inactive sessions
    setInterval(() => {
      const cutoff = Date.now() - this.options.sessionTimeoutMs;

      for (const [id, session] of this.sessions.entries()) {
        if (session.lastActivity < cutoff) {
          this._removeSession(id);
        }
      }
    }, 60000); // Check every minute

    // Clean up orphaned resources
    setInterval(() => {
      const cutoff = Date.now() - this.options.orphanSessionCleanupMs;

      for (const [id, attr] of this.resourceAttribution.entries()) {
        if (attr.lastSeen < cutoff) {
          this.resourceAttribution.delete(id);
        }
      }
    }, 300000); // Check every 5 minutes
  }

  /**
   * Merge metrics from multiple sessions (for same user/project)
   */
  mergeSessionMetrics(sessionIds) {
    const merged = {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      operations: 0,
      errors: 0,
      checkpoints: 0,
      sessions: []
    };

    for (const sessionId of sessionIds) {
      const session = this.sessions.get(sessionId);
      if (session) {
        merged.totalTokens += session.metrics.totalTokens;
        merged.inputTokens += session.metrics.inputTokens;
        merged.outputTokens += session.metrics.outputTokens;
        merged.operations += session.metrics.operations;
        merged.errors += session.metrics.errors;
        merged.checkpoints += session.metrics.checkpoints;
        merged.sessions.push(this._getSessionSummary(sessionId));
      }
    }

    return merged;
  }
}

module.exports = SessionAwareMetricProcessor;