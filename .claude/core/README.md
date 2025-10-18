# Intelligent Phase Management System - Core Components

## Overview

This directory contains the core components of the intelligent phase management system for multi-agent development workflows. These components work together to provide automated phase detection, state management, context loading, and session orchestration.

## Components

### 1. **Bootstrap Loader** (`../bootstrap.md`)
- Condensed agent definitions and phase rules
- Quality gate thresholds
- Exactly ~800 tokens for optimal caching
- Always loaded first in every session

### 2. **State Manager** (`state-manager.js`)
- Full CRUD operations for project state
- JSON schema validation with Ajv
- Automatic backup and restore functionality
- Corruption recovery with fallback to backups
- Thread-safe atomic writes

**Key Features:**
- Validates all state changes against schema
- Automatic backup creation before saves
- Keeps last 10 backups with auto-cleanup
- Recovery from corrupted state files
- Full export/import capability

### 3. **Phase Inference Engine** (`phase-inference.js`)
- Intelligent phase detection from user input
- Multi-factor confidence scoring (keywords, patterns, context)
- Transition validation with valid path checking
- Comprehensive pattern matching for all 7 phases

**Detection Strategy:**
- Keyword matching (0-0.5 score range)
- Regex pattern matching (0-0.4 score range)
- Context clue analysis (0-0.3 score range)
- Logarithmic scoring to prevent over-weighting
- Minimum confidence thresholds per phase

### 4. **Context Loader** (`context-loader.js`)
- Token-budget aware context assembly
- Sliding window for recent artifacts
- Phase-specific context loading
- Priority-based content selection
- Automatic trimming when over budget

**Token Budget:**
- Bootstrap: 800 tokens (cached)
- Current Phase: 1500 tokens
- Adjacent Phases: 500 tokens each
- Recent Artifacts: 2000 tokens
- Project Summary: 1000 tokens
- Session State: 700 tokens
- Total: ~7500 tokens

### 5. **Artifact Summarizer** (`artifact-summarizer.js`)
- Multiple summarization strategies (extractive, structural, simple)
- MD5-based caching with modification time tracking
- Automatic cache expiration (24 hours)
- Strategy selection based on file type

**Strategies:**
- **Extractive**: For code files (extracts imports, classes, functions, exports)
- **Structural**: For markdown (extracts headers and structure)
- **Simple**: For text files (first N + last N lines)

### 6. **Summary Generator** (`summary-generator.js`)
- Generates comprehensive PROJECT_SUMMARY.md
- Template-based output with sections:
  - Project overview and objectives
  - Phase progress table
  - Quality metrics
  - Recent activity
  - Key decisions
  - Generated artifacts
  - Active blockers
  - Next steps
- Preserves custom content on regeneration

### 7. **Session Initializer** (`session-init.js`)
- Orchestrates all core components
- Handles initialization modes (new, existing, resume, explicit)
- Builds complete session prompts
- Executes phase transitions
- Records artifacts and decisions
- Status reporting and exports

## Installation

```bash
cd .claude/core
npm install
```

## Usage

### Basic Initialization

```javascript
const SessionInitializer = require('./.claude/core/session-init');

// Initialize session
const sessionInit = new SessionInitializer('/path/to/project');

// Initialize with user input
const result = sessionInit.initialize('Let\'s plan the project timeline');

if (result.success) {
  console.log('Session prompt:', result.sessionPrompt);
  console.log('Target phase:', result.targetPhase);
  console.log('Token count:', result.metadata.tokenCount);
}
```

### Phase Transition

```javascript
// Execute phase transition
const transitionResult = sessionInit.executeTransition(
  'planning',           // New phase
  'Strategic Planner',  // Agent name
  'User requested',     // Trigger
  85                    // Quality score (optional)
);

if (transitionResult.success) {
  console.log('Transitioned to:', transitionResult.phase);
}
```

### Recording Artifacts

```javascript
// Record a new artifact
sessionInit.recordArtifact('docs/architecture.md', 'design');
```

### Recording Decisions

```javascript
// Record a decision
sessionInit.recordDecision(
  'Use PostgreSQL for data storage',
  'Better suited for relational data with ACID compliance',
  'System Architect'
);
```

### Getting Project Status

```javascript
const status = sessionInit.getStatus();

console.log('Current phase:', status.currentPhase);
console.log('Quality scores:', status.qualityScores);
console.log('Unresolved blockers:', status.unresolvedBlockers);
```

## Component APIs

### StateManager

```javascript
const StateManager = require('./.claude/core/state-manager');
const stateManager = new StateManager(projectRoot);

// Load state
const state = stateManager.load();

// Save state
stateManager.save(state);

// Transition phase
stateManager.transitionPhase('planning', 'Strategic Planner', 'User requested');

// Add artifact
stateManager.addArtifact('design', 'docs/api-spec.md');

// Add decision
stateManager.addDecision('Use REST API', 'Simpler to implement', 'design', 'System Architect');

// Add blocker
stateManager.addBlocker('Database schema not finalized', 'high', 'implementation');

// Resolve blocker
stateManager.resolveBlocker(0, 'Schema finalized and reviewed');
```

### PhaseInference

```javascript
const PhaseInference = require('./.claude/core/phase-inference');
const inference = new PhaseInference(stateManager);

// Infer phase from user input
const result = inference.infer('Let\'s write some tests', 'design');

console.log('Detected phase:', result.phase);
console.log('Confidence:', result.confidence);
console.log('Is valid transition:', result.isValidTransition);

// Get valid next phases
const validNext = inference.getValidNextPhases('design');
console.log('Valid next phases:', validNext); // ['test-first', 'research', 'planning']

// Suggest next phase based on state
const suggestion = inference.suggestNextPhase(state);
console.log('Suggested phase:', suggestion.phase);
console.log('Reasoning:', suggestion.reasoning);
```

### ContextLoader

```javascript
const ContextLoader = require('./.claude/core/context-loader');
const contextLoader = new ContextLoader(projectRoot, stateManager);

// Load context for a phase
const context = contextLoader.loadContext('implementation');

console.log('Total tokens:', context.totalTokens);
console.log('Artifacts loaded:', context.artifacts.length);

// Assemble into prompt
const prompt = contextLoader.assemblePrompt(context);
console.log('Complete prompt:', prompt);
```

### ArtifactSummarizer

```javascript
const ArtifactSummarizer = require('./.claude/core/artifact-summarizer');
const summarizer = new ArtifactSummarizer(projectRoot);

// Summarize an artifact
const summary = summarizer.summarize('src/api/server.js');

console.log('Summary:', summary.summary);
console.log('Strategy used:', summary.strategy);
console.log('Token count:', summary.tokens);

// Batch summarize
const summaries = summarizer.batchSummarize([
  'src/api/server.js',
  'docs/architecture.md',
  'tests/unit/api.test.js'
]);

// Clear cache
summarizer.clearCache();

// Get cache stats
const stats = summarizer.getCacheStats();
console.log('Cached summaries:', stats.count);
```

### SummaryGenerator

```javascript
const SummaryGenerator = require('./.claude/core/summary-generator');
const generator = new SummaryGenerator(projectRoot, stateManager);

// Generate PROJECT_SUMMARY.md
const summary = generator.generate({
  overview: 'Custom project overview text'
});

// Update existing summary
generator.update();
```

## State Schema

The project state follows this JSON schema:

```json
{
  "current_phase": "research|planning|design|test-first|implementation|validation|iteration",
  "phase_history": [
    {
      "phase": "research",
      "timestamp": "2025-01-15T10:30:00.000Z",
      "agent": "Research Analyst",
      "trigger": "User requested",
      "score": 85
    }
  ],
  "quality_scores": {
    "research": 85,
    "planning": 90
  },
  "artifacts": {
    "research": ["docs/research-report.md"],
    "planning": ["docs/project-plan.md"]
  },
  "decisions": [
    {
      "decision": "Use PostgreSQL",
      "rationale": "Better for relational data",
      "timestamp": "2025-01-15T11:00:00.000Z",
      "phase": "design",
      "agent": "System Architect"
    }
  ],
  "blockers": [
    {
      "blocker": "API rate limits not defined",
      "severity": "medium",
      "timestamp": "2025-01-15T12:00:00.000Z",
      "phase": "design",
      "resolved": false
    }
  ],
  "last_updated": "2025-01-15T12:30:00.000Z",
  "metadata": {
    "project_name": "My Project",
    "created_at": "2025-01-15T10:00:00.000Z",
    "version": "1.0.0"
  }
}
```

## File Structure

```
.claude/
├── bootstrap.md                    # Bootstrap file (~800 tokens)
├── core/
│   ├── state-manager.js           # State persistence & validation
│   ├── phase-inference.js         # Phase detection
│   ├── context-loader.js          # Context assembly
│   ├── artifact-summarizer.js     # Artifact summarization
│   ├── summary-generator.js       # PROJECT_SUMMARY.md generation
│   ├── session-init.js            # Session orchestration
│   ├── package.json               # Dependencies
│   └── README.md                  # This file
├── state/
│   ├── project-state.json         # Current state
│   ├── backups/                   # State backups (last 10)
│   └── summaries/                 # Artifact summary cache
├── commands/
│   ├── research-phase.md
│   ├── planning-phase.md
│   ├── design-phase.md
│   ├── test-first-phase.md
│   ├── implementation-phase.md
│   ├── validation-phase.md
│   └── iteration-phase.md
└── PROJECT_SUMMARY.md             # Generated project summary
```

## Error Handling

All components implement comprehensive error handling:

1. **State corruption**: Automatic recovery from backups
2. **Invalid transitions**: Clear error messages with valid options
3. **Missing files**: Graceful degradation with defaults
4. **Token overflow**: Automatic trimming with priority preservation
5. **Cache issues**: Cache regeneration on failure

## Performance Considerations

- **Caching**: Bootstrap and summaries are cached for performance
- **Token limits**: All components respect token budgets
- **Atomic writes**: State changes use atomic file operations
- **Lazy loading**: Context loaded only when needed
- **Cache expiration**: 24-hour TTL on artifact summaries

## Security

- **No external dependencies**: Only Ajv for validation (well-audited)
- **Path validation**: All file paths validated before access
- **Schema validation**: All state changes validated against schema
- **No code execution**: Pure data processing, no eval or exec

## Testing

To test the components:

```bash
# Test state manager
node -e "const SM = require('./.claude/core/state-manager'); const sm = new SM(process.cwd()); console.log(sm.load());"

# Test phase inference
node -e "const PI = require('./.claude/core/phase-inference'); const pi = new PI(); console.log(pi.infer('let\\'s plan the project'));"

# Test session init
node -e "const SI = require('./.claude/core/session-init'); const si = new SI(process.cwd()); console.log(si.getStatus());"
```

## Troubleshooting

### State file corrupted
```javascript
// Reset to default state
const stateManager = new StateManager(projectRoot);
stateManager.reset();
```

### Cache taking too much space
```javascript
// Clear all cached summaries
const summarizer = new ArtifactSummarizer(projectRoot);
summarizer.clearCache();
```

### Token budget exceeded
```javascript
// Context loader automatically trims, but you can check:
const context = contextLoader.loadContext(phase);
console.log('Tokens:', context.totalTokens);
```

## Future Enhancements

- Unit tests with Jest
- CLI interface for standalone usage
- Metrics collection and analytics
- Advanced caching strategies
- Parallel processing for batch operations
- WebSocket support for real-time updates

## License

MIT

## Support

For issues or questions, please refer to the main project documentation or create an issue in the project repository.
