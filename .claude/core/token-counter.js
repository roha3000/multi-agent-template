/**
 * Token Counter - Accurate token counting using tiktoken
 *
 * Provides accurate token counting for Claude/GPT models using the tiktoken library.
 * Replaces the previous 4 chars/token estimation with actual tokenization.
 *
 * @module token-counter
 */

const { encoding_for_model } = require('tiktoken');
const { createComponentLogger } = require('./logger');

const logger = createComponentLogger('TokenCounter');

// Cache the encoder instance for performance
let encoder = null;

/**
 * Initialize the encoder (lazy loading)
 * @returns {Object} Tiktoken encoder
 * @private
 */
function getEncoder() {
  if (!encoder) {
    try {
      // Use gpt-4 tokenizer as it's similar to Claude's tokenization
      // This is close enough for budget estimation purposes
      encoder = encoding_for_model('gpt-4');
      logger.debug('Tokenizer initialized', { model: 'gpt-4' });
    } catch (error) {
      logger.error('Failed to initialize tokenizer', { error: error.message });
      throw error;
    }
  }
  return encoder;
}

/**
 * Counts tokens in a text string
 * @param {string} text - Text to count tokens for
 * @returns {number} Number of tokens
 */
function countTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  try {
    const enc = getEncoder();
    const tokens = enc.encode(text);
    return tokens.length;
  } catch (error) {
    logger.error('Token counting failed', { error: error.message });
    // Fallback to character-based estimation if tiktoken fails
    return Math.ceil(text.length / 4);
  }
}

/**
 * Estimates characters needed for a target token count
 * Useful for truncation operations
 * @param {number} tokenCount - Target number of tokens
 * @returns {number} Estimated character count
 */
function estimateCharsForTokens(tokenCount) {
  // Average of ~4 characters per token for English text
  // This is used for reverse estimation when we need to truncate
  return tokenCount * 4;
}

/**
 * Counts tokens for multiple text strings
 * @param {Object} texts - Object with text values
 * @returns {Object} Object with same keys but token counts as values
 */
function countTokensMultiple(texts) {
  const counts = {};
  for (const [key, text] of Object.entries(texts)) {
    counts[key] = countTokens(text);
  }
  return counts;
}

/**
 * Truncates text to fit within a token budget
 * @param {string} text - Text to truncate
 * @param {number} maxTokens - Maximum tokens allowed
 * @param {string} suffix - Suffix to add when truncated (default: '\n\n[... truncated ...]')
 * @returns {Object} { text: truncated text, wasTruncated: boolean, actualTokens: number }
 */
function truncateToTokenLimit(text, maxTokens, suffix = '\n\n[... truncated ...]') {
  if (!text) {
    return { text: '', wasTruncated: false, actualTokens: 0 };
  }

  const currentTokens = countTokens(text);

  if (currentTokens <= maxTokens) {
    return { text, wasTruncated: false, actualTokens: currentTokens };
  }

  // Binary search for the right truncation point
  const suffixTokens = countTokens(suffix);
  const targetTokens = maxTokens - suffixTokens;

  let left = 0;
  let right = text.length;
  let bestLength = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const truncated = text.slice(0, mid);
    const tokens = countTokens(truncated);

    if (tokens <= targetTokens) {
      bestLength = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  const truncatedText = text.slice(0, bestLength) + suffix;
  const finalTokens = countTokens(truncatedText);

  return {
    text: truncatedText,
    wasTruncated: true,
    actualTokens: finalTokens
  };
}

/**
 * Frees the encoder resources
 * Call this when shutting down the application
 */
function cleanup() {
  if (encoder) {
    encoder.free();
    encoder = null;
    logger.debug('Tokenizer cleaned up');
  }
}

module.exports = {
  countTokens,
  estimateCharsForTokens,
  countTokensMultiple,
  truncateToTokenLimit,
  cleanup
};
