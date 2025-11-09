/**
 * Error Parser
 *
 * Parses errors from various sources (TypeScript, Jest, runtime) and
 * extracts structured error information for similarity search and
 * context injection.
 *
 * Supports:
 * - TypeScript compiler errors
 * - Jest test failures
 * - Node.js runtime errors
 * - ESLint errors
 * - Webpack build errors
 *
 * @module core/error-parser
 */

/**
 * Parses TypeScript compiler errors
 *
 * Format: "src/file.ts(10,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'."
 *
 * @param {string} output - TypeScript compiler output
 * @returns {Array<Object>} - Parsed errors
 */
function parseTypeScriptErrors(output) {
  const errors = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Match: file.ts(line,col): error TS####: message
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/);
    if (match) {
      errors.push({
        type: 'typescript',
        source: 'TypeScript Compiler',
        file: match[1].trim(),
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        code: match[4],
        message: match[5].trim(),
        severity: 'error',
        category: categorizeError(match[5])
      });
    }
  }

  return errors;
}

/**
 * Parses Jest test failures
 *
 * Format: "FAIL  __tests__/component.test.js"
 *         "  ● Test Suite › Test Name"
 *         "    Error message..."
 *
 * @param {string} output - Jest test output
 * @returns {Array<Object>} - Parsed errors
 */
function parseJestErrors(output) {
  const errors = [];
  const lines = output.split('\n');

  let currentFile = null;
  let currentTest = null;
  let errorLines = [];
  let inErrorBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: FAIL  __tests__/file.test.js
    const failMatch = line.match(/^\s*FAIL\s+(.+\.test\.(js|ts|jsx|tsx))$/);
    if (failMatch) {
      currentFile = failMatch[1];
      continue;
    }

    // Match: ● Test Suite › Test Name
    const testMatch = line.match(/^\s*●\s+(.+)$/);
    if (testMatch) {
      currentTest = testMatch[1];
      inErrorBlock = true;
      errorLines = [];
      continue;
    }

    // Collect error lines
    if (inErrorBlock) {
      if (line.trim() === '' || line.match(/^\s*\d+\s*\|/)) {
        // End of error block
        if (errorLines.length > 0) {
          errors.push({
            type: 'jest',
            source: 'Jest Test',
            file: currentFile,
            test: currentTest,
            message: errorLines.join('\n').trim(),
            severity: 'error',
            category: 'test-failure'
          });
        }
        inErrorBlock = false;
        errorLines = [];
      } else {
        errorLines.push(line);
      }
    }
  }

  return errors;
}

/**
 * Parses Node.js runtime errors
 *
 * Format: "TypeError: Cannot read property 'foo' of undefined"
 *         "    at Object.<anonymous> (/path/file.js:10:5)"
 *
 * @param {string} output - Runtime error output
 * @returns {Array<Object>} - Parsed errors
 */
function parseRuntimeErrors(output) {
  const errors = [];
  const lines = output.split('\n');

  let currentError = null;
  let stackTrace = [];

  for (const line of lines) {
    // Match error type and message
    const errorMatch = line.match(/^(TypeError|ReferenceError|SyntaxError|Error|RangeError|URIError):\s*(.+)$/);
    if (errorMatch) {
      // Save previous error
      if (currentError) {
        currentError.stackTrace = stackTrace;
        errors.push(currentError);
      }

      // Start new error
      currentError = {
        type: 'runtime',
        source: 'Node.js Runtime',
        errorType: errorMatch[1],
        message: errorMatch[2].trim(),
        severity: 'error',
        category: categorizeError(errorMatch[2])
      };
      stackTrace = [];
      continue;
    }

    // Match stack trace line
    const stackMatch = line.match(/^\s+at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)$/);
    if (stackMatch && currentError) {
      stackTrace.push({
        function: stackMatch[1],
        file: stackMatch[2],
        line: parseInt(stackMatch[3]),
        column: parseInt(stackMatch[4])
      });

      // Use first stack frame as primary location
      if (!currentError.file) {
        currentError.file = stackMatch[2];
        currentError.line = parseInt(stackMatch[3]);
        currentError.column = parseInt(stackMatch[4]);
      }
    }
  }

  // Add last error
  if (currentError) {
    currentError.stackTrace = stackTrace;
    errors.push(currentError);
  }

  return errors;
}

/**
 * Parses ESLint errors
 *
 * Format: "/path/file.js"
 *         "  1:1  error  'foo' is not defined  no-undef"
 *
 * @param {string} output - ESLint output
 * @returns {Array<Object>} - Parsed errors
 */
function parseESLintErrors(output) {
  const errors = [];
  const lines = output.split('\n');

  let currentFile = null;

  for (const line of lines) {
    // Match file path
    if (line.match(/^\//) || line.match(/^[A-Z]:\\/)) {
      currentFile = line.trim();
      continue;
    }

    // Match: "  1:1  error  message  rule-name"
    const errorMatch = line.match(/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s+([a-z-]+)$/);
    if (errorMatch && currentFile) {
      errors.push({
        type: 'eslint',
        source: 'ESLint',
        file: currentFile,
        line: parseInt(errorMatch[1]),
        column: parseInt(errorMatch[2]),
        severity: errorMatch[3],
        message: errorMatch[4].trim(),
        rule: errorMatch[5],
        category: categorizeError(errorMatch[4])
      });
    }
  }

  return errors;
}

/**
 * Parses Webpack build errors
 *
 * Format: "ERROR in ./src/file.js"
 *         "Module not found: Error: Can't resolve 'module' in '/path'"
 *
 * @param {string} output - Webpack output
 * @returns {Array<Object>} - Parsed errors
 */
function parseWebpackErrors(output) {
  const errors = [];
  const lines = output.split('\n');

  let currentFile = null;
  let errorLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match: ERROR in ./src/file.js
    const errorMatch = line.match(/^ERROR in\s+(.+)$/);
    if (errorMatch) {
      // Save previous error
      if (currentFile && errorLines.length > 0) {
        errors.push({
          type: 'webpack',
          source: 'Webpack',
          file: currentFile,
          message: errorLines.join('\n').trim(),
          severity: 'error',
          category: categorizeError(errorLines.join(' '))
        });
      }

      currentFile = errorMatch[1];
      errorLines = [];
      continue;
    }

    // Collect error lines
    if (currentFile && line.trim() && !line.startsWith('ERROR')) {
      errorLines.push(line);
    }
  }

  // Add last error
  if (currentFile && errorLines.length > 0) {
    errors.push({
      type: 'webpack',
      source: 'Webpack',
      file: currentFile,
      message: errorLines.join('\n').trim(),
      severity: 'error',
      category: categorizeError(errorLines.join(' '))
    });
  }

  return errors;
}

/**
 * Categorizes error by type for better similarity matching
 *
 * Categories:
 * - type-error: Type mismatches, undefined properties
 * - syntax-error: Syntax violations
 * - reference-error: Undefined variables, imports
 * - module-error: Module resolution, imports
 * - test-failure: Test assertions
 * - runtime-error: General runtime errors
 *
 * @param {string} message - Error message
 * @returns {string} - Error category
 */
function categorizeError(message) {
  const lower = message.toLowerCase();

  if (lower.includes('type') || lower.includes('assignable') || lower.includes('property')) {
    return 'type-error';
  }

  if (lower.includes('syntax') || lower.includes('unexpected token')) {
    return 'syntax-error';
  }

  if (lower.includes('not defined') || lower.includes('is not a function')) {
    return 'reference-error';
  }

  if (lower.includes('module') || lower.includes('import') || lower.includes('require')) {
    return 'module-error';
  }

  if (lower.includes('expected') || lower.includes('received') || lower.includes('assert')) {
    return 'test-failure';
  }

  return 'runtime-error';
}

/**
 * Parses errors from any output
 *
 * Automatically detects error source and applies appropriate parser.
 *
 * @param {string} output - Command output or error message
 * @returns {Array<Object>} - Parsed errors with metadata
 */
function parseErrors(output) {
  if (!output || typeof output !== 'string') {
    return [];
  }

  const allErrors = [];

  // Try all parsers and combine results
  allErrors.push(...parseTypeScriptErrors(output));
  allErrors.push(...parseJestErrors(output));
  allErrors.push(...parseRuntimeErrors(output));
  allErrors.push(...parseESLintErrors(output));
  allErrors.push(...parseWebpackErrors(output));

  // Add timestamp and unique ID
  return allErrors.map((error, index) => ({
    ...error,
    id: `error-${Date.now()}-${index}`,
    timestamp: new Date().toISOString(),
    searchText: generateSearchText(error)
  }));
}

/**
 * Generates search text for error similarity matching
 *
 * Combines error message, type, and category for semantic search.
 *
 * @param {Object} error - Parsed error object
 * @returns {string} - Search text
 */
function generateSearchText(error) {
  const parts = [
    error.source || error.type,
    error.category,
    error.message,
    error.code || error.rule || error.errorType
  ];

  return parts.filter(Boolean).join(' | ');
}

/**
 * Extracts error context for solution injection
 *
 * @param {Object} error - Parsed error object
 * @returns {Object} - Error context with additional metadata
 */
function extractErrorContext(error) {
  return {
    id: error.id,
    type: error.type,
    source: error.source,
    category: error.category,
    severity: error.severity,
    message: error.message,
    file: error.file,
    line: error.line,
    column: error.column,
    code: error.code || error.rule,
    searchText: error.searchText,
    timestamp: error.timestamp
  };
}

module.exports = {
  parseErrors,
  parseTypeScriptErrors,
  parseJestErrors,
  parseRuntimeErrors,
  parseESLintErrors,
  parseWebpackErrors,
  categorizeError,
  generateSearchText,
  extractErrorContext
};
