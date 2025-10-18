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

module.exports = {
  StateManager,
  PhaseInference,
  ContextLoader,
  ArtifactSummarizer,
  SummaryGenerator,
  SessionInitializer
};
