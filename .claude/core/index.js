/**
 * Core Components Index - Main entry point for intelligent phase management system
 *
 * @module @multi-agent/core
 */

const StateManager = require('./state-manager');
const PhaseInference = require('./phase-inference');
const ContextLoader = require('./context-loader');
const ArtifactSummarizer = require('./artifact-summarizer');
const SummaryGenerator = require('./summary-generator');
const SessionInitializer = require('./session-init');
const Agent = require('./agent');
const MessageBus = require('./message-bus');
const AgentOrchestrator = require('./agent-orchestrator');
const IntelligentOrchestrator = require('./intelligent-orchestrator');
const PatternSelector = require('./pattern-selector');
const SmartOrchestrator = require('./smart-orchestrate');

// Memory & Hybrid Architecture Components
const LifecycleHooks = require('./lifecycle-hooks');
const MemoryStore = require('./memory-store');
const MemoryIntegration = require('./memory-integration');

// Intelligence Layer Components
const VectorStore = require('./vector-store');
const ContextRetriever = require('./context-retriever');
const AICategorizationService = require('./ai-categorizer');
const MemorySearchAPI = require('./memory-search-api');
const PatternRecommender = require('./pattern-recommender');

module.exports = {
  // Phase Management
  StateManager,
  PhaseInference,
  ContextLoader,
  ArtifactSummarizer,
  SummaryGenerator,
  SessionInitializer,

  // Agent System
  Agent,
  MessageBus,
  AgentOrchestrator,
  IntelligentOrchestrator,
  PatternSelector,
  SmartOrchestrator,

  // Memory & Hybrid Architecture
  LifecycleHooks,
  MemoryStore,
  MemoryIntegration,

  // Intelligence Layer
  VectorStore,
  ContextRetriever,
  AICategorizationService,
  MemorySearchAPI,
  PatternRecommender
};
