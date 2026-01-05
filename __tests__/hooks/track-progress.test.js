/**
 * Tests for Track Progress Hook
 *
 * Tests the getToolSummary and getToolDetail functions that extract
 * human-readable summaries and detailed information from tool calls.
 *
 * @module __tests__/hooks/track-progress
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// We need to extract the functions from the hook module
// Since they're not exported, we'll need to test via integration or extract them
// For now, let's create a testable version by loading the source and extracting functions

const hookPath = path.join(__dirname, '../../.claude/hooks/track-progress.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');

// Extract the getToolSummary function from the source
const getToolSummaryMatch = hookSource.match(/function getToolSummary\(toolName, toolInput, toolResponse\) \{[\s\S]*?\n\}/);
const getToolDetailMatch = hookSource.match(/function getToolDetail\(toolName, toolInput, toolResponse\) \{[\s\S]*?\n\}/);

// Create a test module with extracted functions
const testModule = `
${getToolSummaryMatch[0]}

${getToolDetailMatch[0]}

module.exports = { getToolSummary, getToolDetail };
`;

// Write to temp file and require it
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-progress-test-'));
const tempFile = path.join(tempDir, 'test-functions.js');
fs.writeFileSync(tempFile, testModule);

const { getToolSummary, getToolDetail } = require(tempFile);

// Clean up temp file after requiring
afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Track Progress Hook', () => {
  describe('getToolSummary', () => {
    it('should truncate long summaries to 80 characters', () => {
      const longPath = '/a/very/long/path/that/definitely/exceeds/eighty/characters/for/our/testing/purposes/here/file.js';
      expect(longPath.length).toBeGreaterThan(80); // Sanity check
      const summary = getToolSummary('Read', { file_path: longPath });
      expect(summary.length).toBeLessThanOrEqual(83); // 80 + '...'
      expect(summary).toContain('...');
    });

    it('should extract file_path for Read tool', () => {
      const summary = getToolSummary('Read', { file_path: '/src/index.js' });
      expect(summary).toBe('/src/index.js');
    });

    it('should extract file_path for Write tool', () => {
      const summary = getToolSummary('Write', { file_path: '/src/output.js' });
      expect(summary).toBe('/src/output.js');
    });

    it('should extract file_path for Edit tool', () => {
      const summary = getToolSummary('Edit', { file_path: '/src/config.js' });
      expect(summary).toBe('/src/config.js');
    });

    it('should extract command for Bash tool', () => {
      const summary = getToolSummary('Bash', { command: 'npm test' });
      expect(summary).toBe('npm test');
    });

    it('should extract pattern for Glob tool', () => {
      const summary = getToolSummary('Glob', { pattern: '**/*.js' });
      expect(summary).toBe('**/*.js');
    });

    it('should extract pattern and path for Grep tool', () => {
      const summary = getToolSummary('Grep', { pattern: 'TODO', path: '/src' });
      expect(summary).toBe('TODO in /src');
    });

    it('should extract description for Task tool', () => {
      const summary = getToolSummary('Task', { description: 'Run tests' });
      expect(summary).toBe('Run tests');
    });

    it('should extract prompt snippet for Task tool when no description', () => {
      const summary = getToolSummary('Task', { prompt: 'Analyze the codebase for issues' });
      expect(summary).toContain('Analyze the codebase');
    });

    it('should extract url for WebFetch tool', () => {
      const summary = getToolSummary('WebFetch', { url: 'https://example.com/api' });
      expect(summary).toBe('https://example.com/api');
    });

    it('should extract query for WebSearch tool', () => {
      const summary = getToolSummary('WebSearch', { query: 'javascript async patterns' });
      expect(summary).toBe('javascript async patterns');
    });

    it('should extract operation and filePath for LSP tool', () => {
      const summary = getToolSummary('LSP', { operation: 'hover', filePath: '/src/app.js' });
      expect(summary).toBe('hover /src/app.js');
    });

    it('should count todos for TodoWrite tool', () => {
      const summary = getToolSummary('TodoWrite', {
        todos: [
          { content: 'Task 1', status: 'pending' },
          { content: 'Task 2', status: 'pending' },
          { content: 'Task 3', status: 'pending' }
        ]
      });
      expect(summary).toBe('3 todo(s)');
    });

    it('should handle unknown tools with first string value', () => {
      const summary = getToolSummary('CustomTool', { name: 'test-operation' });
      expect(summary).toBe('test-operation');
    });

    it('should handle empty input gracefully', () => {
      const summary = getToolSummary('Read', {});
      expect(summary).toBe('');
    });

    it('should handle null input gracefully', () => {
      const summary = getToolSummary('Read', null);
      expect(summary).toBe('');
    });
  });

  describe('getToolDetail', () => {
    it('should extract full file path and options for Read tool', () => {
      const detail = getToolDetail('Read', {
        file_path: '/src/index.js',
        offset: 100,
        limit: 50
      });
      expect(detail.file).toBe('/src/index.js');
      expect(detail.offset).toBe(100);
      expect(detail.limit).toBe(50);
    });

    it('should extract file and content for Write tool', () => {
      const detail = getToolDetail('Write', {
        file_path: '/src/output.js',
        content: 'console.log("hello");'
      });
      expect(detail.file).toBe('/src/output.js');
      expect(detail.content).toBe('console.log("hello");');
    });

    it('should truncate very long content for Write tool', () => {
      const longContent = 'x'.repeat(6000);
      const detail = getToolDetail('Write', {
        file_path: '/src/large.js',
        content: longContent
      });
      expect(detail.content.length).toBeLessThan(6000);
      expect(detail.content).toContain('... (truncated)');
    });

    it('should extract old_string, new_string, and replace_all for Edit tool', () => {
      const detail = getToolDetail('Edit', {
        file_path: '/src/config.js',
        old_string: 'const x = 1;',
        new_string: 'const x = 2;',
        replace_all: true
      });
      expect(detail.file).toBe('/src/config.js');
      expect(detail.old_string).toBe('const x = 1;');
      expect(detail.new_string).toBe('const x = 2;');
      expect(detail.replace_all).toBe(true);
    });

    it('should extract command and metadata for Bash tool', () => {
      const detail = getToolDetail('Bash', {
        command: 'npm test -- --coverage',
        timeout: 60000,
        description: 'Run test suite with coverage'
      });
      expect(detail.command).toBe('npm test -- --coverage');
      expect(detail.timeout).toBe(60000);
      expect(detail.description).toBe('Run test suite with coverage');
    });

    it('should extract pattern and path for Glob tool', () => {
      const detail = getToolDetail('Glob', {
        pattern: '**/*.test.js',
        path: '/src'
      });
      expect(detail.pattern).toBe('**/*.test.js');
      expect(detail.path).toBe('/src');
    });

    it('should extract all options for Grep tool', () => {
      const detail = getToolDetail('Grep', {
        pattern: 'TODO|FIXME',
        path: '/src',
        glob: '*.js',
        output_mode: 'content'
      });
      expect(detail.pattern).toBe('TODO|FIXME');
      expect(detail.path).toBe('/src');
      expect(detail.glob).toBe('*.js');
      expect(detail.output_mode).toBe('content');
    });

    it('should extract full prompt and metadata for Task tool', () => {
      const detail = getToolDetail('Task', {
        description: 'Analyze code',
        prompt: 'Analyze the codebase for potential issues and improvements',
        subagent_type: 'Explore',
        model: 'sonnet'
      });
      expect(detail.description).toBe('Analyze code');
      expect(detail.prompt).toContain('Analyze the codebase');
      expect(detail.subagent_type).toBe('Explore');
      expect(detail.model).toBe('sonnet');
    });

    it('should extract url and prompt for WebFetch tool', () => {
      const detail = getToolDetail('WebFetch', {
        url: 'https://api.example.com/data',
        prompt: 'Extract the main content'
      });
      expect(detail.url).toBe('https://api.example.com/data');
      expect(detail.prompt).toBe('Extract the main content');
    });

    it('should extract query for WebSearch tool', () => {
      const detail = getToolDetail('WebSearch', {
        query: 'best practices node.js 2024'
      });
      expect(detail.query).toBe('best practices node.js 2024');
    });

    it('should extract full todos array for TodoWrite tool', () => {
      const todos = [
        { content: 'Task 1', status: 'pending', activeForm: 'Working on task 1' },
        { content: 'Task 2', status: 'in_progress', activeForm: 'Working on task 2' },
        { content: 'Task 3', status: 'completed', activeForm: 'Completing task 3' }
      ];
      const detail = getToolDetail('TodoWrite', { todos });
      expect(detail.todos).toEqual(todos);
      expect(detail.todos).toHaveLength(3);
    });

    it('should include all fields for unknown tools', () => {
      const detail = getToolDetail('CustomTool', {
        name: 'test',
        value: 123,
        nested: { foo: 'bar' }
      });
      expect(detail.name).toBe('test');
      expect(detail.value).toBe(123);
      expect(detail.nested).toEqual({ foo: 'bar' });
    });

    it('should remove undefined and null values', () => {
      const detail = getToolDetail('Read', {
        file_path: '/src/index.js',
        offset: undefined,
        limit: null
      });
      expect(detail.file).toBe('/src/index.js');
      expect('offset' in detail).toBe(false);
      expect('limit' in detail).toBe(false);
    });

    it('should handle empty input gracefully', () => {
      const detail = getToolDetail('Read', {});
      expect(detail.file).toBe('');
    });

    it('should handle null input gracefully', () => {
      const detail = getToolDetail('Read', null);
      expect(detail.file).toBe('');
    });
  });

  describe('Integration: Summary and Detail consistency', () => {
    const testCases = [
      {
        tool: 'Read',
        input: { file_path: '/src/app.js', offset: 10, limit: 100 },
        summaryContains: '/src/app.js',
        detailHas: ['file', 'offset', 'limit']
      },
      {
        tool: 'Edit',
        input: { file_path: '/config.json', old_string: 'old', new_string: 'new' },
        summaryContains: '/config.json',
        detailHas: ['file', 'old_string', 'new_string']
      },
      {
        tool: 'Bash',
        input: { command: 'git status', description: 'Check git status' },
        summaryContains: 'git status',
        detailHas: ['command', 'description']
      },
      {
        tool: 'TodoWrite',
        input: { todos: [{ content: 'A' }, { content: 'B' }] },
        summaryContains: '2 todo(s)',
        detailHas: ['todos']
      }
    ];

    testCases.forEach(({ tool, input, summaryContains, detailHas }) => {
      it(`should produce consistent summary and detail for ${tool}`, () => {
        const summary = getToolSummary(tool, input);
        const detail = getToolDetail(tool, input);

        expect(summary).toContain(summaryContains);
        detailHas.forEach(key => {
          expect(detail).toHaveProperty(key);
        });
      });
    });
  });
});
