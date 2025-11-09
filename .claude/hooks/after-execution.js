/**
 * Error Context Injection Hook
 *
 * Enhances existing afterExecution hook with error learning capabilities.
 * Integrates with VectorStore and MemoryStore to:
 * - Parse errors from execution output
 * - Search for similar past errors
 * - Inject solutions from successful resolutions
 * - Store new error-solution pairs for future learning
 *
 * @module hooks/after-execution
 */

const path = require('path');
const { parseErrors, extractErrorContext } = require('../core/error-parser');

/**
 * Searches for similar past errors
 *
 * Uses VectorStore for semantic similarity search to find errors
 * with similar messages, types, and contexts.
 *
 * @param {Object} vectorStore - VectorStore instance
 * @param {Object} error - Parsed error object
 * @param {Object} options - Search options
 * @returns {Promise<Array>} - Similar errors with solutions
 */
async function searchSimilarErrors(vectorStore, error, options = {}) {
  const {
    limit = 5,
    threshold = 0.7,
    includeResolved = true
  } = options;

  try {
    // Search by error message and context
    const results = await vectorStore.searchSimilar(error.searchText, {
      limit,
      threshold,
      filter: {
        category: error.category,
        type: error.type
      }
    });

    // Filter for resolved errors with solutions
    if (includeResolved) {
      return results.filter(result =>
        result.metadata &&
        result.metadata.resolved === true &&
        result.metadata.solution
      );
    }

    return results;
  } catch (error) {
    console.error(`[Error Context] Failed to search similar errors: ${error.message}`);
    return [];
  }
}

/**
 * Formats error solutions for context injection
 *
 * @param {Array} similarErrors - Similar errors with solutions
 * @param {Object} currentError - Current error being resolved
 * @returns {string} - Formatted solution context
 */
function formatSolutionContext(similarErrors, currentError) {
  if (similarErrors.length === 0) {
    return null;
  }

  const lines = [
    '## Similar Errors & Solutions',
    '',
    `Found ${similarErrors.length} similar error(s) from past sessions:`,
    ''
  ];

  for (const [index, error] of similarErrors.entries()) {
    const similarity = (error.distance * 100).toFixed(0);
    const metadata = error.metadata || {};

    lines.push(`### ${index + 1}. ${metadata.source || 'Unknown'} Error (${similarity}% similar)`);
    lines.push('');
    lines.push('**Error:**');
    lines.push(`\`\`\`\n${metadata.message || error.content}\n\`\`\``);
    lines.push('');

    if (metadata.solution) {
      lines.push('**Solution:**');
      lines.push(metadata.solution);
      lines.push('');
    }

    if (metadata.file) {
      lines.push(`**File:** \`${metadata.file}\``);
      if (metadata.line) {
        lines.push(`**Line:** ${metadata.line}`);
      }
      lines.push('');
    }

    if (metadata.resolvedAt) {
      lines.push(`**Resolved:** ${new Date(metadata.resolvedAt).toLocaleString()}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Stores error for future learning
 *
 * @param {Object} vectorStore - VectorStore instance
 * @param {Object} memoryStore - MemoryStore instance
 * @param {Object} error - Parsed error object
 * @param {Object} execution - Execution context
 * @returns {Promise<void>}
 */
async function storeError(vectorStore, memoryStore, error, execution) {
  try {
    const errorDoc = {
      content: error.searchText,
      metadata: {
        ...extractErrorContext(error),
        orchestrationId: execution.orchestrationId || null,
        agentId: execution.agentId || null,
        resolved: false,
        occurrences: 1
      }
    };

    // Store in vector store for similarity search
    await vectorStore.addOrchestration({
      id: error.id,
      observations: [errorDoc],
      metadata: errorDoc.metadata
    });

    // Store in memory store for persistence
    if (memoryStore && memoryStore.recordOrchestration) {
      await memoryStore.recordOrchestration({
        id: error.id,
        pattern: 'error-occurrence',
        agents: execution.agentId ? [execution.agentId] : [],
        result: {
          success: false,
          error: error.message
        },
        metadata: errorDoc.metadata
      });
    }
  } catch (error) {
    console.error(`[Error Context] Failed to store error: ${error.message}`);
  }
}

/**
 * Marks error as resolved with solution
 *
 * @param {Object} vectorStore - VectorStore instance
 * @param {Object} memoryStore - MemoryStore instance
 * @param {string} errorId - Error ID to mark as resolved
 * @param {string} solution - Solution description
 * @returns {Promise<void>}
 */
async function markErrorResolved(vectorStore, memoryStore, errorId, solution) {
  try {
    // Update in memory store
    if (memoryStore && memoryStore.updateOrchestration) {
      await memoryStore.updateOrchestration(errorId, {
        resolved: true,
        solution,
        resolvedAt: new Date().toISOString()
      });
    }

    console.log(`[Error Context] Marked error ${errorId} as resolved`);
  } catch (error) {
    console.error(`[Error Context] Failed to mark error resolved: ${error.message}`);
  }
}

/**
 * Injects error context into execution result
 *
 * Main hook function that enhances afterExecution with error learning.
 *
 * @param {Object} context - Hook context
 * @param {Object} context.result - Execution result
 * @param {Object} context.vectorStore - VectorStore instance
 * @param {Object} context.memoryStore - MemoryStore instance
 * @param {Object} context.config - Configuration
 * @returns {Promise<Object>} - Enhanced result with error context
 */
async function injectErrorContext(context) {
  const {
    result,
    vectorStore,
    memoryStore,
    config = {}
  } = context;

  const {
    enabled = true,
    searchLimit = 5,
    similarityThreshold = 0.7,
    autoStore = true
  } = config;

  // Check if error context injection is enabled
  if (!enabled) {
    return result;
  }

  // Check if we have the required stores
  if (!vectorStore) {
    console.warn('[Error Context] VectorStore not available, skipping error context injection');
    return result;
  }

  // Parse errors from result output
  const output = result.output || result.stdout || result.stderr || '';
  const errors = parseErrors(output);

  if (errors.length === 0) {
    // No errors found, return original result
    return result;
  }

  console.log(`[Error Context] Found ${errors.length} error(s) in execution output`);

  // Process each error
  const errorContexts = [];

  for (const error of errors) {
    console.log(`[Error Context] Processing ${error.source} error: ${error.message.substring(0, 60)}...`);

    // Search for similar past errors
    const similarErrors = await searchSimilarErrors(vectorStore, error, {
      limit: searchLimit,
      threshold: similarityThreshold
    });

    if (similarErrors.length > 0) {
      console.log(`[Error Context] Found ${similarErrors.length} similar error(s) with solutions`);

      // Format solution context
      const solutionContext = formatSolutionContext(similarErrors, error);

      errorContexts.push({
        error: extractErrorContext(error),
        similarErrors,
        solutionContext
      });
    }

    // Store error for future learning
    if (autoStore) {
      await storeError(vectorStore, memoryStore, error, context);
    }
  }

  // Enhance result with error context
  return {
    ...result,
    errorContext: {
      errors: errors.map(extractErrorContext),
      solutions: errorContexts,
      hasContext: errorContexts.length > 0
    }
  };
}

/**
 * Hook entry point
 *
 * Called by the framework after execution completes.
 *
 * @param {Object} context - Hook context
 * @returns {Promise<Object>} - Enhanced result
 */
async function hook(context) {
  try {
    return await injectErrorContext(context);
  } catch (error) {
    console.error(`[Error Context] Hook error: ${error.message}`);
    // Return original result on error
    return context.result;
  }
}

// Export for testing and integration
module.exports = {
  hook,
  injectErrorContext,
  searchSimilarErrors,
  formatSolutionContext,
  storeError,
  markErrorResolved
};
