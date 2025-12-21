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

class TokenCounter {
  constructor(options = {}) {
    this.logger = createComponentLogger('TokenCounter');
    this.model = options.model || 'gpt-4';
    this.memoryStore = options.memoryStore;
    this.encoder = null;
  }

  /**
   * Initialize the encoder (lazy loading)
   * @returns {Object} Tiktoken encoder
   * @private
   */
  _getEncoder() {
    if (!this.encoder) {
      try {
        // Use gpt-4 tokenizer as it's similar to Claude's tokenization
        // This is close enough for budget estimation purposes
        this.encoder = encoding_for_model('gpt-4');
        this.logger.debug('Tokenizer initialized', { model: 'gpt-4' });
      } catch (error) {
        this.logger.error('Failed to initialize tokenizer', { error: error.message });
        throw error;
      }
    }
    return this.encoder;
  }

  /**
   * Counts tokens in a text string
   * @param {string} text - Text to count tokens for
   * @returns {number} Number of tokens
   */
  countTokens(text) {
    if (!text || typeof text !== 'string') {
      return 0;
    }

    try {
      const enc = this._getEncoder();
      const tokens = enc.encode(text);
      return tokens.length;
    } catch (error) {
      this.logger.error('Token counting failed', { error: error.message });
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
  estimateCharsForTokens(tokenCount) {
    // Average of ~4 characters per token for English text
    // This is used for reverse estimation when we need to truncate
    return tokenCount * 4;
  }

  /**
   * Counts tokens for multiple text strings
   * @param {Object} texts - Object with text values
   * @returns {Object} Object with same keys but token counts as values
   */
  countTokensMultiple(texts) {
    const counts = {};
    for (const [key, text] of Object.entries(texts)) {
      counts[key] = this.countTokens(text);
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
  truncateToTokenLimit(text, maxTokens, suffix = '\n\n[... truncated ...]') {
    if (!text) {
      return { text: '', wasTruncated: false, actualTokens: 0 };
    }

    const currentTokens = this.countTokens(text);

    if (currentTokens <= maxTokens) {
      return { text, wasTruncated: false, actualTokens: currentTokens };
    }

    // Binary search for the right truncation point
    const suffixTokens = this.countTokens(suffix);
    const targetTokens = maxTokens - suffixTokens;

    let left = 0;
    let right = text.length;
    let bestLength = 0;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const truncated = text.slice(0, mid);
      const tokens = this.countTokens(truncated);

      if (tokens <= targetTokens) {
        bestLength = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    const truncatedText = text.slice(0, bestLength) + suffix;
    const finalTokens = this.countTokens(truncatedText);

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
  cleanup() {
    if (this.encoder) {
      this.encoder.free();
      this.encoder = null;
      this.logger.debug('Tokenizer cleaned up');
    }
  }
}

module.exports = TokenCounter;
