/**
 * Build Checking Hook
 *
 * Automatically runs build/test commands after code changes and halts
 * execution if errors are detected.
 *
 * Solves the "errors accumulate" problem by:
 * - Detecting file changes (via Git status or file watcher)
 * - Running configured build commands
 * - Parsing output for errors
 * - Halting with clear error context if build fails
 *
 * @module hooks/after-code-change
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Detects changed files using Git status
 *
 * @param {string} cwd - Current working directory
 * @returns {string[]} - Array of changed file paths
 */
function detectChangedFiles(cwd) {
  try {
    // Get both staged and unstaged changes
    const output = execSync('git status --porcelain', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const changes = [];
    const lines = output.split('\n').filter(line => line.trim());

    for (const line of lines) {
      // Parse git status format: "XY filename"
      const match = line.match(/^(.{2})\s+(.+)$/);
      if (match) {
        const [, status, filepath] = match;
        // Ignore deleted files
        if (!status.includes('D')) {
          changes.push(filepath);
        }
      }
    }

    return changes;
  } catch (error) {
    // Not a git repo or git not available
    return [];
  }
}

/**
 * Determines if changed files require build check
 *
 * @param {string[]} changedFiles - Array of changed file paths
 * @param {Object} config - Build check configuration
 * @returns {boolean} - True if build check needed
 */
function shouldRunBuildCheck(changedFiles, config) {
  const {
    includePatterns = ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'],
    excludePatterns = ['**/*.test.js', '**/*.spec.js', '**/node_modules/**', '**/*.md']
  } = config;

  // Check if any changed files match include patterns and don't match exclude patterns
  for (const file of changedFiles) {
    // Check exclude patterns first
    const excluded = excludePatterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      return regex.test(file);
    });

    if (excluded) continue;

    // Check include patterns
    const included = includePatterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*'));
      return regex.test(file);
    });

    if (included) return true;
  }

  return false;
}

/**
 * Loads build configuration from package.json or config file
 *
 * @param {string} cwd - Current working directory
 * @returns {Object} - Build configuration
 */
function loadBuildConfig(cwd) {
  const defaultConfig = {
    enabled: true,
    buildCommand: 'npm run build',
    testCommand: 'npm test',
    timeout: 60000, // 60 seconds
    runBuild: true,
    runTests: false, // Don't run tests by default (can be slow)
    includePatterns: ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx'],
    excludePatterns: ['**/*.test.js', '**/*.spec.js', '**/node_modules/**', '**/*.md']
  };

  // Try to load from .claude/hooks/build-check-config.json
  const configPath = path.join(cwd, '.claude', 'hooks', 'build-check-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return { ...defaultConfig, ...userConfig };
    } catch (error) {
      console.error(`[Build Check] Error loading config: ${error.message}`);
    }
  }

  // Try to load from package.json
  const packagePath = path.join(cwd, 'package.json');
  if (fs.existsSync(packagePath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      if (pkg.claudeCode && pkg.claudeCode.buildCheck) {
        return { ...defaultConfig, ...pkg.claudeCode.buildCheck };
      }
    } catch (error) {
      console.error(`[Build Check] Error loading package.json: ${error.message}`);
    }
  }

  return defaultConfig;
}

/**
 * Parses build output for errors
 *
 * Supports:
 * - TypeScript errors: "error TS2345: ..."
 * - ESLint errors: "error  ..."
 * - Webpack errors: "ERROR in ..."
 * - Generic errors: "Error: ...", "ERROR: ..."
 *
 * @param {string} output - Build command output
 * @returns {Array<{type: string, message: string, file?: string, line?: number}>}
 */
function parseErrors(output) {
  const errors = [];

  const lines = output.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // TypeScript error: "src/file.ts(10,5): error TS2345: ..."
    const tsMatch = line.match(/^(.+?)\((\d+),(\d+)\):\s*error\s+(TS\d+):\s*(.+)$/);
    if (tsMatch) {
      errors.push({
        type: 'typescript',
        file: tsMatch[1],
        line: parseInt(tsMatch[2]),
        column: parseInt(tsMatch[3]),
        code: tsMatch[4],
        message: tsMatch[5]
      });
      continue;
    }

    // ESLint error: "  1:1  error  ..."
    const eslintMatch = line.match(/^\s*(\d+):(\d+)\s+error\s+(.+)/);
    if (eslintMatch) {
      errors.push({
        type: 'eslint',
        line: parseInt(eslintMatch[1]),
        column: parseInt(eslintMatch[2]),
        message: eslintMatch[3]
      });
      continue;
    }

    // Webpack error: "ERROR in ./src/file.js"
    if (line.includes('ERROR in')) {
      const errorLines = [line];
      // Capture following lines as part of error message
      while (i + 1 < lines.length && !lines[i + 1].startsWith('ERROR') && lines[i + 1].trim()) {
        errorLines.push(lines[++i]);
      }
      errors.push({
        type: 'webpack',
        message: errorLines.join('\n')
      });
      continue;
    }

    // Generic error
    if (line.match(/^(Error|ERROR):/)) {
      errors.push({
        type: 'generic',
        message: line
      });
    }
  }

  return errors;
}

/**
 * Runs build command and captures output
 *
 * @param {string} command - Build command to run
 * @param {Object} options - Execution options
 * @returns {Promise<{success: boolean, output: string, errors: Array}>}
 */
async function runBuildCommand(command, options = {}) {
  const { cwd, timeout = 60000 } = options;

  return new Promise((resolve) => {
    let output = '';
    let hasError = false;

    try {
      // Try synchronous execution first (simpler, better for fast builds)
      output = execSync(command, {
        cwd,
        encoding: 'utf-8',
        timeout,
        stdio: 'pipe'
      });

      const errors = parseErrors(output);

      resolve({
        success: errors.length === 0,
        output,
        errors
      });
    } catch (error) {
      // Command failed (non-zero exit code)
      output = error.stdout || '';
      const errorOutput = error.stderr || '';
      const fullOutput = output + '\n' + errorOutput;

      const errors = parseErrors(fullOutput);

      resolve({
        success: false,
        output: fullOutput,
        errors: errors.length > 0 ? errors : [{
          type: 'generic',
          message: error.message
        }]
      });
    }
  });
}

/**
 * Formats error messages for display
 *
 * @param {Array} errors - Parsed errors
 * @returns {string} - Formatted error message
 */
function formatErrors(errors) {
  if (errors.length === 0) {
    return 'Build failed with no specific errors.';
  }

  const lines = ['Build failed with the following errors:\n'];

  for (const error of errors) {
    if (error.type === 'typescript') {
      lines.push(`  TS${error.code} in ${error.file}:${error.line}:${error.column}`);
      lines.push(`    ${error.message}`);
    } else if (error.type === 'eslint') {
      lines.push(`  ESLint error at line ${error.line}:${error.column}`);
      lines.push(`    ${error.message}`);
    } else if (error.type === 'webpack') {
      lines.push(`  Webpack error:`);
      lines.push(`    ${error.message}`);
    } else {
      lines.push(`  ${error.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Main hook function
 *
 * @param {Object} context - Hook context
 * @param {string[]} context.changedFiles - Files that were changed
 * @param {string} context.cwd - Current working directory
 * @param {Object} context.config - Build check configuration
 * @returns {Promise<Object>} - Hook result
 */
async function runBuildCheck(context) {
  const { changedFiles, cwd = process.cwd(), config: userConfig = {} } = context;

  // Load configuration
  const config = { ...loadBuildConfig(cwd), ...userConfig };

  // Check if build check is enabled
  if (!config.enabled) {
    return {
      success: true,
      skipped: true,
      message: 'Build check disabled in configuration'
    };
  }

  // Detect changed files if not provided
  const files = changedFiles || detectChangedFiles(cwd);

  if (files.length === 0) {
    return {
      success: true,
      skipped: true,
      message: 'No changed files detected'
    };
  }

  // Check if build check is needed for these files
  if (!shouldRunBuildCheck(files, config)) {
    return {
      success: true,
      skipped: true,
      message: `Changed files don't require build check (${files.length} files)`
    };
  }

  console.log(`[Build Check] Running build check for ${files.length} changed file(s)...`);

  const results = [];

  // Run build command if enabled
  if (config.runBuild && config.buildCommand) {
    console.log(`[Build Check] Running: ${config.buildCommand}`);

    const buildResult = await runBuildCommand(config.buildCommand, {
      cwd,
      timeout: config.timeout
    });

    results.push({
      command: config.buildCommand,
      ...buildResult
    });

    if (!buildResult.success) {
      const errorMessage = formatErrors(buildResult.errors);

      return {
        success: false,
        error: errorMessage,
        results,
        changedFiles: files
      };
    }
  }

  // Run test command if enabled
  if (config.runTests && config.testCommand) {
    console.log(`[Build Check] Running: ${config.testCommand}`);

    const testResult = await runBuildCommand(config.testCommand, {
      cwd,
      timeout: config.timeout
    });

    results.push({
      command: config.testCommand,
      ...testResult
    });

    if (!testResult.success) {
      const errorMessage = formatErrors(testResult.errors);

      return {
        success: false,
        error: errorMessage,
        results,
        changedFiles: files
      };
    }
  }

  console.log(`[Build Check] ✓ All checks passed`);

  return {
    success: true,
    message: 'Build check passed',
    results,
    changedFiles: files
  };
}

/**
 * Hook entry point
 *
 * @param {Object} context - Hook context
 * @returns {Promise<Object>} - Hook result
 */
async function hook(context) {
  try {
    return await runBuildCheck(context);
  } catch (error) {
    console.error(`[Build Check] Unexpected error: ${error.message}`);
    return {
      success: false,
      error: `Build check failed: ${error.message}`,
      results: []
    };
  }
}

// Export for testing
module.exports = {
  hook,
  runBuildCheck,
  detectChangedFiles,
  shouldRunBuildCheck,
  loadBuildConfig,
  parseErrors,
  runBuildCommand,
  formatErrors
};
