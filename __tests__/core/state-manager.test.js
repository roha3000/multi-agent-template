/**
 * StateManager Unit Tests
 *
 * Tests for core state management functionality including:
 * - State persistence and validation
 * - Backup and recovery mechanisms
 * - Prompt traceability features
 * - Artifact lineage tracking
 * - Query and statistics methods
 */

const fs = require('fs');
const path = require('path');
const StateManager = require('../../.claude/core/state-manager');

// Test directory setup
const TEST_PROJECT_ROOT = path.join(__dirname, '..', '..', 'test-temp');
const TEST_STATE_DIR = path.join(TEST_PROJECT_ROOT, '.claude', 'state');
const TEST_BACKUP_DIR = path.join(TEST_STATE_DIR, 'backups');

describe('StateManager', () => {
  let stateManager;

  beforeEach(() => {
    // Create clean test environment
    if (fs.existsSync(TEST_PROJECT_ROOT)) {
      fs.rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_STATE_DIR, { recursive: true });
    fs.mkdirSync(TEST_BACKUP_DIR, { recursive: true });

    stateManager = new StateManager(TEST_PROJECT_ROOT);
  });

  afterEach(() => {
    // Cleanup test environment
    if (fs.existsSync(TEST_PROJECT_ROOT)) {
      fs.rmSync(TEST_PROJECT_ROOT, { recursive: true, force: true });
    }
  });

  describe('State Persistence', () => {
    test('should load default state when no state file exists', () => {
      const state = stateManager.load();

      expect(state).toBeDefined();
      expect(state.current_phase).toBe('research');
      expect(state.phase_history).toEqual([]);
      expect(state.quality_scores).toEqual({});
      expect(state.artifacts).toEqual({});
      expect(state.decisions).toEqual([]);
      expect(state.blockers).toEqual([]);
    });

    test('should save and load state correctly', () => {
      const state = stateManager.load();
      state.current_phase = 'implementation';
      state.quality_scores.research = 85;

      const saveResult = stateManager.save(state);
      expect(saveResult).toBe(true);

      const loadedState = stateManager.load();
      expect(loadedState.current_phase).toBe('implementation');
      expect(loadedState.quality_scores.research).toBe(85);
    });

    test('should validate state against schema', () => {
      const validState = stateManager.load();
      expect(stateManager.validate(validState)).toBe(true);

      const invalidState = { current_phase: 'invalid-phase' };
      expect(stateManager.validate(invalidState)).toBe(false);
    });

    test('should reject invalid phase values', () => {
      const state = stateManager.load();
      state.current_phase = 'invalid-phase';

      const saveResult = stateManager.save(state);
      expect(saveResult).toBe(false);
    });

    test('should update last_updated timestamp on save', () => {
      const state = stateManager.load();
      const beforeTime = new Date().toISOString();

      stateManager.save(state);

      const loadedState = stateManager.load();
      expect(loadedState.last_updated).toBeDefined();
      expect(new Date(loadedState.last_updated) >= new Date(beforeTime)).toBe(true);
    });
  });

  describe('Backup and Recovery', () => {
    test('should create backup when saving over existing state', () => {
      const state = stateManager.load();
      stateManager.save(state);

      // Modify and save again (should trigger backup)
      state.current_phase = 'implementation';
      stateManager.save(state);

      const backups = fs.readdirSync(TEST_BACKUP_DIR);
      expect(backups.length).toBeGreaterThan(0);
      expect(backups[0]).toMatch(/state-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/);
    });

    test('should keep only last 10 backups', () => {
      const state = stateManager.load();

      // Create 15 saves to trigger backup cleanup
      for (let i = 0; i < 15; i++) {
        state.quality_scores[`test${i}`] = i;
        stateManager.save(state);
        // Small delay to ensure different timestamps
        const start = Date.now();
        while (Date.now() - start < 10) {} // 10ms delay
      }

      const backups = fs.readdirSync(TEST_BACKUP_DIR);
      expect(backups.length).toBeLessThanOrEqual(10);
    });

    test('should recover from corrupted state file', () => {
      // Create initial valid state
      const state = stateManager.load();
      state.current_phase = 'implementation';
      state.quality_scores.research = 85;
      stateManager.save(state);

      // Make a change and save to create a backup
      state.quality_scores.design = 90;
      stateManager.save(state);

      // Corrupt the state file
      const statePath = path.join(TEST_STATE_DIR, 'project-state.json');
      fs.writeFileSync(statePath, 'invalid json {{{', 'utf8');

      // Should recover from most recent valid backup
      const recoveredState = stateManager.load();
      expect(recoveredState.current_phase).toBe('implementation');
      expect(recoveredState.quality_scores.research).toBe(85);
      // Should have the backup's state (which might be from the first save)
      expect(recoveredState).toHaveProperty('current_phase');
      expect(recoveredState).toHaveProperty('quality_scores');
    });
  });

  describe('Prompt Recording', () => {
    test('should record a basic prompt', () => {
      const promptEntry = stateManager.recordPrompt('Test prompt', {
        phase: 'implementation',
        agent: 'Test Agent'
      });

      expect(promptEntry).toBeDefined();
      expect(promptEntry.id).toBeDefined();
      expect(promptEntry.timestamp).toBeDefined();
      expect(promptEntry.prompt).toBe('Test prompt');
      expect(promptEntry.phase).toBe('implementation');
      expect(promptEntry.agent).toBe('Test Agent');
    });

    test('should use current phase if not specified', () => {
      const state = stateManager.load();
      state.current_phase = 'design';
      stateManager.save(state);

      const promptEntry = stateManager.recordPrompt('Test prompt', {
        agent: 'Designer'
      });

      expect(promptEntry.phase).toBe('design');
    });

    test('should record artifact creation', () => {
      const promptEntry = stateManager.recordPrompt('Create component', {
        phase: 'implementation',
        agent: 'Developer',
        artifactPath: 'src/component.tsx',
        artifactsCreated: ['src/component.tsx'],
        changeType: 'created',
        changeSummary: 'React component'
      });

      expect(promptEntry.artifactPath).toBe('src/component.tsx');
      expect(promptEntry.artifactsCreated).toContain('src/component.tsx');

      const state = stateManager.load();
      expect(state.promptHistory).toHaveLength(1);
      expect(state.artifactLineage['src/component.tsx']).toBeDefined();
    });

    test('should record artifact modification', () => {
      // First create the artifact
      stateManager.recordPrompt('Create component', {
        artifactPath: 'src/component.tsx',
        artifactsCreated: ['src/component.tsx']
      });

      // Then modify it
      stateManager.recordPrompt('Add props', {
        artifactPath: 'src/component.tsx',
        artifactsModified: ['src/component.tsx'],
        changeType: 'enhanced',
        changeSummary: 'Added TypeScript props'
      });

      const history = stateManager.getArtifactHistory('src/component.tsx');
      expect(history.lineage.currentVersion).toBe(2);
      expect(history.lineage.versions).toHaveLength(2);
      expect(history.lineage.totalModifications).toBe(1);
    });

    test('should generate unique prompt IDs', () => {
      const prompt1 = stateManager.recordPrompt('Prompt 1');
      const prompt2 = stateManager.recordPrompt('Prompt 2');

      expect(prompt1.id).not.toBe(prompt2.id);
    });

    test('should include session ID in prompts', () => {
      const promptEntry = stateManager.recordPrompt('Test prompt');

      expect(promptEntry.sessionId).toBeDefined();
      expect(typeof promptEntry.sessionId).toBe('string');
    });
  });

  describe('Artifact Lineage Tracking', () => {
    test('should initialize lineage for new artifact', () => {
      stateManager.recordPrompt('Create file', {
        artifactPath: 'test.js',
        artifactsCreated: ['test.js'],
        agent: 'Developer'
      });

      const state = stateManager.load();
      const lineage = state.artifactLineage['test.js'];

      expect(lineage).toBeDefined();
      expect(lineage.artifactId).toBeDefined();
      expect(lineage.created).toBeDefined();
      expect(lineage.currentVersion).toBe(1);
      expect(lineage.totalModifications).toBe(0);
      expect(lineage.createdBy.agent).toBe('Developer');
    });

    test('should track version history', () => {
      const artifact = 'src/utils.js';

      // Create
      stateManager.recordPrompt('Create utils', {
        artifactPath: artifact,
        changeType: 'created'
      });

      // Modify multiple times
      stateManager.recordPrompt('Add function A', {
        artifactPath: artifact,
        changeType: 'enhanced'
      });

      stateManager.recordPrompt('Fix bug in A', {
        artifactPath: artifact,
        changeType: 'bug-fix'
      });

      const history = stateManager.getArtifactHistory(artifact);

      expect(history.lineage.currentVersion).toBe(3);
      expect(history.lineage.versions).toHaveLength(3);
      expect(history.lineage.versions[0].changeType).toBe('created');
      expect(history.lineage.versions[1].changeType).toBe('enhanced');
      expect(history.lineage.versions[2].changeType).toBe('bug-fix');
    });

    test('should track related prompts', () => {
      const artifact = 'config.json';

      stateManager.recordPrompt('Create config', {
        artifactPath: artifact
      });

      stateManager.recordPrompt('Update config', {
        artifactPath: artifact
      });

      const history = stateManager.getArtifactHistory(artifact);

      expect(history.prompts).toHaveLength(2);
      expect(history.lineage.relatedPrompts).toHaveLength(2);
    });

    test('should return null for non-existent artifact', () => {
      const history = stateManager.getArtifactHistory('non-existent.js');
      expect(history).toBeNull();
    });
  });

  describe('Query Methods', () => {
    beforeEach(() => {
      // Seed test data
      stateManager.recordPrompt('Research prompt 1', {
        phase: 'research',
        agent: 'Researcher'
      });

      stateManager.recordPrompt('Research prompt 2', {
        phase: 'research',
        agent: 'Analyst'
      });

      stateManager.recordPrompt('Implementation prompt 1', {
        phase: 'implementation',
        agent: 'Developer'
      });

      stateManager.recordPrompt('Implementation prompt 2', {
        phase: 'implementation',
        agent: 'Developer'
      });
    });

    test('getPromptsByPhase should filter correctly', () => {
      const researchPrompts = stateManager.getPromptsByPhase('research');
      const implPrompts = stateManager.getPromptsByPhase('implementation');

      expect(researchPrompts).toHaveLength(2);
      expect(implPrompts).toHaveLength(2);
    });

    test('getPromptsByAgent should filter correctly', () => {
      const devPrompts = stateManager.getPromptsByAgent('Developer');
      const researcherPrompts = stateManager.getPromptsByAgent('Researcher');

      expect(devPrompts).toHaveLength(2);
      expect(researcherPrompts).toHaveLength(1);
    });

    test('getSessionPrompts should return current session prompts', () => {
      const sessionPrompts = stateManager.getSessionPrompts();

      expect(sessionPrompts).toHaveLength(4);
      expect(sessionPrompts.every(p => p.sessionId)).toBe(true);
    });

    test('searchPrompts should find by keyword', () => {
      stateManager.recordPrompt('This is about authentication logic');
      stateManager.recordPrompt('This is about database schema');

      const authResults = stateManager.searchPrompts('authentication');
      const dbResults = stateManager.searchPrompts('database');

      expect(authResults).toHaveLength(1);
      expect(dbResults).toHaveLength(1);
    });

    test('searchPrompts should be case insensitive', () => {
      stateManager.recordPrompt('Authentication Setup');

      const results = stateManager.searchPrompts('AUTHENTICATION');
      expect(results).toHaveLength(1);
    });

    test('searchPrompts should return empty array when no matches', () => {
      const results = stateManager.searchPrompts('nonexistent-keyword-xyz');
      expect(results).toEqual([]);
    });
  });

  describe('Statistics', () => {
    test('should return empty statistics for new project', () => {
      const stats = stateManager.getPromptStatistics();

      expect(stats.totalPrompts).toBe(0);
      expect(stats.totalArtifacts).toBe(0);
      expect(stats.byPhase).toEqual({});
      expect(stats.byAgent).toEqual({});
    });

    test('should calculate prompt statistics correctly', () => {
      // Record various prompts
      stateManager.recordPrompt('Research 1', {
        phase: 'research',
        agent: 'Researcher'
      });

      stateManager.recordPrompt('Research 2', {
        phase: 'research',
        agent: 'Researcher'
      });

      stateManager.recordPrompt('Design 1', {
        phase: 'design',
        agent: 'Architect'
      });

      stateManager.recordPrompt('Implementation 1', {
        phase: 'implementation',
        agent: 'Developer',
        artifactPath: 'file1.js'
      });

      stateManager.recordPrompt('Implementation 2', {
        phase: 'implementation',
        agent: 'Developer',
        artifactPath: 'file2.js'
      });

      const stats = stateManager.getPromptStatistics();

      expect(stats.totalPrompts).toBe(5);
      expect(stats.totalArtifacts).toBe(2);
      expect(stats.byPhase.research).toBe(2);
      expect(stats.byPhase.design).toBe(1);
      expect(stats.byPhase.implementation).toBe(2);
      expect(stats.byAgent.Researcher).toBe(2);
      expect(stats.byAgent.Architect).toBe(1);
      expect(stats.byAgent.Developer).toBe(2);
    });
  });

  describe('Phase Transitions', () => {
    test('should add artifact to correct phase', () => {
      stateManager.addArtifact('research', 'docs/research.md');
      stateManager.addArtifact('implementation', 'src/index.js');

      const state = stateManager.load();

      expect(state.artifacts.research).toContain('docs/research.md');
      expect(state.artifacts.implementation).toContain('src/index.js');
    });

    test('should record decisions', () => {
      stateManager.addDecision(
        'Use React for frontend',
        'Team expertise',
        'design',
        'Architect'
      );

      const state = stateManager.load();

      expect(state.decisions).toHaveLength(1);
      expect(state.decisions[0].decision).toBe('Use React for frontend');
      expect(state.decisions[0].rationale).toBe('Team expertise');
      expect(state.decisions[0].phase).toBe('design');
      expect(state.decisions[0].agent).toBe('Architect');
    });

    test('should record and resolve blockers', () => {
      stateManager.addBlocker(
        'API rate limit',
        'high',
        'implementation'
      );

      let state = stateManager.load();
      expect(state.blockers).toHaveLength(1);
      expect(state.blockers[0].blocker).toBe('API rate limit');
      expect(state.blockers[0].severity).toBe('high');
      expect(state.blockers[0].resolved).toBe(false);

      stateManager.resolveBlocker(0, 'Implemented exponential backoff');

      state = stateManager.load();
      expect(state.blockers[0].resolved).toBe(true);
      expect(state.blockers[0].resolution).toBe('Implemented exponential backoff');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty prompt gracefully', () => {
      const promptEntry = stateManager.recordPrompt('');

      expect(promptEntry).toBeDefined();
      expect(promptEntry.prompt).toBe('');
    });

    test('should handle very long prompts', () => {
      const longPrompt = 'x'.repeat(10000);
      const promptEntry = stateManager.recordPrompt(longPrompt);

      expect(promptEntry.prompt).toHaveLength(10000);
    });

    test('should handle special characters in artifact paths', () => {
      const specialPath = 'src/components/@special/test-file.tsx';
      stateManager.recordPrompt('Create component', {
        artifactPath: specialPath
      });

      const history = stateManager.getArtifactHistory(specialPath);
      expect(history).not.toBeNull();
    });

    test('should handle concurrent saves gracefully', () => {
      const state1 = stateManager.load();
      const state2 = stateManager.load();

      state1.quality_scores.research = 80;
      state2.quality_scores.design = 85;

      const result1 = stateManager.save(state1);
      const result2 = stateManager.save(state2);

      expect(result1).toBe(true);
      expect(result2).toBe(true);

      // Last save should win
      const finalState = stateManager.load();
      expect(finalState.quality_scores.design).toBe(85);
    });

    test('should return empty array for queries on missing promptHistory', () => {
      const state = stateManager.load();
      delete state.promptHistory;
      stateManager.save(state);

      expect(stateManager.getSessionPrompts()).toEqual([]);
      expect(stateManager.getPromptsByPhase('research')).toEqual([]);
      expect(stateManager.getPromptsByAgent('Test')).toEqual([]);
      expect(stateManager.searchPrompts('test')).toEqual([]);
    });
  });
});
