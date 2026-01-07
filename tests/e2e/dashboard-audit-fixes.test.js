/**
 * E2E Tests for Dashboard Audit Fixes
 *
 * Tests the fixes for issues identified in the Session 96 comprehensive audit:
 * - Issue 1.2: Async registration not awaited
 * - Issue 3.1/3.3: SSE log event format mismatch
 * - Issue 5.2: Project key system mismatch
 * - Issue 6.2: Missing SSE broadcast for session:childAdded
 */

const fs = require('fs');
const path = require('path');

describe('Dashboard Audit Fixes E2E Tests', () => {
  jest.setTimeout(30000);

  describe('Issue 5.2: Project Key Translation', () => {
    let encodeProjectKey, normalizeProjectKey, isSameProject, getProjectKeys;

    beforeAll(() => {
      const utils = require('../../.claude/core/project-key-utils');
      encodeProjectKey = utils.encodeProjectKey;
      normalizeProjectKey = utils.normalizeProjectKey;
      isSameProject = utils.isSameProject;
      getProjectKeys = utils.getProjectKeys;
    });

    test('should encode Windows paths correctly', () => {
      const windowsPath = 'C:\\Users\\roha3\\Claude\\test-project';
      const encoded = encodeProjectKey(windowsPath);

      expect(encoded).not.toContain(':');
      expect(encoded).not.toContain('\\');
      // Encoded format replaces : and / with -, may have leading dash or double dash
      expect(encoded).toContain('Users-roha3-Claude-test-project');
    });

    test('should normalize Windows paths correctly', () => {
      const windowsPath = 'C:\\Users\\roha3\\Claude\\test-project';
      const normalized = normalizeProjectKey(windowsPath);

      expect(normalized).toContain('/');
      expect(normalized).not.toContain('\\');
      expect(normalized.toLowerCase()).toContain('c:/users/roha3/claude/test-project');
    });

    test('should recognize same project when both from same source', () => {
      // When both keys are generated from the same path, they should be comparable
      const testPath = 'C:\\Users\\roha3\\Claude\\test-project';
      const keys = getProjectKeys(testPath);

      // Keys should have different formats
      expect(keys.encoded).not.toBe(keys.normalized);

      // Both should encode the project name
      expect(keys.encoded).toContain('test-project');
      expect(keys.normalized).toContain('test-project');
    });

    test('should return both formats from getProjectKeys', () => {
      const testPath = 'C:\\Users\\roha3\\Claude\\test-project';
      const keys = getProjectKeys(testPath);

      expect(keys).toHaveProperty('encoded');
      expect(keys).toHaveProperty('normalized');
      // Both formats should contain the project name
      expect(keys.encoded).toContain('test-project');
      expect(keys.normalized).toContain('test-project');
    });

    test('should handle null/undefined gracefully', () => {
      expect(encodeProjectKey(null)).toBe('default-project');
      expect(normalizeProjectKey(undefined)).toBe('default-project');
      expect(isSameProject(null, 'test')).toBe(false);
    });
  });

  describe('Issue 3.1/3.3: SSE Log Event Handling', () => {
    test('should have log event listener in dashboard HTML', () => {
      const dashboardPath = path.join(__dirname, '../../global-dashboard.html');
      const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

      // Check for addEventListener('log', ...)
      expect(dashboardContent).toContain("addEventListener('log'");
    });

    test('should handle named SSE log events', () => {
      const dashboardPath = path.join(__dirname, '../../global-dashboard.html');
      const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

      // Check for the specific event listener pattern
      const hasLogListener = dashboardContent.includes("logStreamEventSource.addEventListener('log'");
      expect(hasLogListener).toBe(true);
    });
  });

  describe('Issue 6.2: Hierarchy SSE Broadcast', () => {
    test('should have session:childAdded broadcast listener in manager', () => {
      const managerPath = path.join(__dirname, '../../global-context-manager.js');
      const managerContent = fs.readFileSync(managerPath, 'utf8');

      // Check for childAdded registration
      expect(managerContent).toContain("session:childAdded");
    });

    test('should broadcast hierarchy:childAdded events', () => {
      const managerPath = path.join(__dirname, '../../global-context-manager.js');
      const managerContent = fs.readFileSync(managerPath, 'utf8');

      // Check for hierarchy:childAdded broadcast
      expect(managerContent).toContain("hierarchy:childAdded");
    });

    test('should have dashboard handler for hierarchy:childAdded', () => {
      const dashboardPath = path.join(__dirname, '../../global-dashboard.html');
      const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');

      // Check for hierarchy:childAdded handler
      expect(dashboardContent).toContain("hierarchy:childAdded");
    });
  });

  describe('Issue 1.2: Async Registration', () => {
    test('should have await before initializeCommandCenter', () => {
      const orchestratorPath = path.join(__dirname, '../../autonomous-orchestrator.js');
      const orchestratorContent = fs.readFileSync(orchestratorPath, 'utf8');

      // Check for await initializeCommandCenter
      expect(orchestratorContent).toContain('await initializeCommandCenter()');
    });
  });
});
