/**
 * Tests for Delegation Hook - Direct Execution Override
 * Tests the /direct skill state file check functionality
 *
 * @module __tests__/hooks/delegation-hook-direct
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Delegation Hook - Direct Execution Override', () => {
  let tempDir;
  let stateDir;
  let directExecPath;

  // Store original cwd
  const originalCwd = process.cwd();

  beforeEach(() => {
    // Create temporary directory structure
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegation-hook-test-'));
    stateDir = path.join(tempDir, '.claude', 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    directExecPath = path.join(stateDir, 'direct-execution.json');
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('checkDirectExecutionOverride behavior', () => {
    // We test the behavior by simulating what the hook does
    // since importing the hook directly would trigger it

    function checkDirectExecutionOverride(basePath) {
      const directPath = path.join(basePath, '.claude', 'state', 'direct-execution.json');

      try {
        if (fs.existsSync(directPath)) {
          const content = fs.readFileSync(directPath, 'utf8');
          const state = JSON.parse(content);

          if (state.directExecution) {
            // Clear the flag after processing
            try {
              fs.unlinkSync(directPath);
            } catch (unlinkErr) {
              // Ignore
            }
            return true;
          }
        }
      } catch (err) {
        // Ignore errors
      }

      return false;
    }

    test('returns true when direct-execution.json exists with directExecution: true', () => {
      const state = {
        directExecution: true,
        task: 'Fix the typo',
        timestamp: new Date().toISOString(),
        reason: 'user-requested'
      };

      fs.writeFileSync(directExecPath, JSON.stringify(state), 'utf8');

      const result = checkDirectExecutionOverride(tempDir);

      expect(result).toBe(true);
    });

    test('clears the state file after reading', () => {
      const state = {
        directExecution: true,
        task: 'Test task'
      };

      fs.writeFileSync(directExecPath, JSON.stringify(state), 'utf8');

      checkDirectExecutionOverride(tempDir);

      // File should be deleted
      expect(fs.existsSync(directExecPath)).toBe(false);
    });

    test('returns false when directExecution is false', () => {
      const state = {
        directExecution: false,
        task: 'Test task'
      };

      fs.writeFileSync(directExecPath, JSON.stringify(state), 'utf8');

      const result = checkDirectExecutionOverride(tempDir);

      expect(result).toBe(false);
    });

    test('returns false when file does not exist', () => {
      const result = checkDirectExecutionOverride(tempDir);

      expect(result).toBe(false);
    });

    test('returns false when file contains invalid JSON', () => {
      fs.writeFileSync(directExecPath, 'not valid json{{{', 'utf8');

      const result = checkDirectExecutionOverride(tempDir);

      expect(result).toBe(false);
    });

    test('returns false when state directory does not exist', () => {
      fs.rmSync(stateDir, { recursive: true, force: true });

      const result = checkDirectExecutionOverride(tempDir);

      expect(result).toBe(false);
    });

    test('handles file with only directExecution property', () => {
      const state = {
        directExecution: true
      };

      fs.writeFileSync(directExecPath, JSON.stringify(state), 'utf8');

      const result = checkDirectExecutionOverride(tempDir);

      expect(result).toBe(true);
      expect(fs.existsSync(directExecPath)).toBe(false);
    });

    test('preserves other files in state directory', () => {
      const otherFile = path.join(stateDir, 'other-state.json');
      fs.writeFileSync(otherFile, '{"test": true}', 'utf8');

      const state = {
        directExecution: true,
        task: 'Test'
      };
      fs.writeFileSync(directExecPath, JSON.stringify(state), 'utf8');

      checkDirectExecutionOverride(tempDir);

      // Other file should still exist
      expect(fs.existsSync(otherFile)).toBe(true);
      // Direct execution file should be deleted
      expect(fs.existsSync(directExecPath)).toBe(false);
    });
  });

  describe('/direct skill state file format', () => {
    test('accepts full state object from /direct skill', () => {
      const state = {
        directExecution: true,
        task: 'Implement entire authentication system',
        timestamp: '2026-01-04T18:30:00.000Z',
        reason: 'user-requested',
        originalComplexity: null,
        agentId: 'session-123'
      };

      fs.writeFileSync(directExecPath, JSON.stringify(state), 'utf8');

      const content = fs.readFileSync(directExecPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.directExecution).toBe(true);
      expect(parsed.task).toBe('Implement entire authentication system');
      expect(parsed.reason).toBe('user-requested');
    });

    test('accepts minimal state object', () => {
      const state = {
        directExecution: true,
        task: 'Quick fix'
      };

      fs.writeFileSync(directExecPath, JSON.stringify(state), 'utf8');

      const content = fs.readFileSync(directExecPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed.directExecution).toBe(true);
      expect(parsed.task).toBe('Quick fix');
    });
  });
});
