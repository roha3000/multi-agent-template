/**
 * Skills Auto-Activation Hook
 *
 * Automatically discovers and activates relevant skills from .claude/skills/
 * based on user prompt analysis.
 *
 * Solves the "Claude ignores docs" problem by:
 * - Analyzing user prompts for intent and domain
 * - Discovering available skills in .claude/skills/
 * - Scoring skills by relevance to prompt
 * - Auto-activating high-relevance skills
 *
 * @module hooks/user-prompt-submit
 */

const fs = require('fs');
const path = require('path');

/**
 * Discovers all skills in .claude/skills/ directory
 *
 * @param {string} skillsDir - Path to skills directory
 * @returns {Array<{name: string, path: string, content: string, keywords: string[]}>}
 */
async function discoverSkills(skillsDir) {
  const skills = [];

  try {
    if (!fs.existsSync(skillsDir)) {
      return skills;
    }

    const files = fs.readdirSync(skillsDir, { recursive: true });

    for (const file of files) {
      const filePath = path.join(skillsDir, file);

      // Only process markdown files
      if (!filePath.endsWith('.md') || fs.statSync(filePath).isDirectory()) {
        continue;
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      const name = path.basename(file, '.md');

      // Extract keywords from skill content
      const keywords = extractKeywords(content);

      skills.push({
        name,
        path: filePath,
        content,
        keywords
      });
    }
  } catch (error) {
    console.error(`[Skills Hook] Error discovering skills: ${error.message}`);
  }

  return skills;
}

/**
 * Extracts keywords from skill content
 *
 * Looks for:
 * - Title/heading keywords
 * - Code language indicators
 * - Domain terms (API, database, testing, etc.)
 * - Framework/library names
 *
 * @param {string} content - Skill file content
 * @returns {string[]} - Array of keywords
 */
function extractKeywords(content) {
  const keywords = [];

  // Extract from markdown headings (# Title, ## Section)
  const headingRegex = /^#+\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    keywords.push(...match[1].toLowerCase().split(/\s+/));
  }

  // Extract code language indicators
  const codeBlockRegex = /```(\w+)/g;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    keywords.push(match[1].toLowerCase());
  }

  // Extract common tech keywords
  const techKeywords = [
    'api', 'rest', 'graphql', 'database', 'sql', 'nosql',
    'testing', 'unit', 'integration', 'e2e',
    'react', 'vue', 'angular', 'node', 'express', 'fastify',
    'typescript', 'javascript', 'python', 'java', 'rust', 'go',
    'docker', 'kubernetes', 'aws', 'gcp', 'azure',
    'authentication', 'authorization', 'security',
    'performance', 'optimization', 'caching',
    'debugging', 'logging', 'monitoring'
  ];

  const lowerContent = content.toLowerCase();
  for (const keyword of techKeywords) {
    if (lowerContent.includes(keyword)) {
      keywords.push(keyword);
    }
  }

  // Remove duplicates
  return [...new Set(keywords)];
}

/**
 * Scores skill relevance to user prompt
 *
 * Scoring factors:
 * - Keyword matches (weighted by importance)
 * - Semantic similarity (basic word overlap)
 * - Domain alignment
 *
 * @param {string} prompt - User prompt text
 * @param {{name: string, keywords: string[]}} skill - Skill object
 * @returns {number} - Relevance score (0-1)
 */
function scoreRelevance(prompt, skill) {
  const promptLower = prompt.toLowerCase();
  const promptWords = promptLower.split(/\s+/).filter(w => w.length > 3);

  let score = 0;
  let matches = 0;

  // Check skill name match
  if (promptLower.includes(skill.name.toLowerCase())) {
    score += 0.5;
    matches++;
  }

  // Check keyword matches
  for (const keyword of skill.keywords) {
    if (promptLower.includes(keyword)) {
      score += 0.1;
      matches++;
    }
  }

  // Check word overlap
  for (const word of promptWords) {
    if (skill.keywords.includes(word)) {
      score += 0.05;
      matches++;
    }
  }

  // Bonus for multiple matches (indicates strong relevance)
  if (matches >= 3) {
    score += 0.2;
  }

  // Normalize score to 0-1 range
  return Math.min(score, 1.0);
}

/**
 * Analyzes user prompt and activates relevant skills
 *
 * Main hook function called on user prompt submission.
 *
 * @param {string} prompt - User prompt text
 * @param {Object} options - Hook options
 * @param {string} options.skillsDir - Skills directory path (default: .claude/skills)
 * @param {number} options.threshold - Minimum score to activate (default: 0.3)
 * @param {number} options.maxSkills - Maximum skills to activate (default: 3)
 * @returns {Object} - Hook result with skills and instruction
 */
async function analyzeAndActivateSkills(prompt, options = {}) {
  const {
    skillsDir = path.join(process.cwd(), '.claude', 'skills'),
    threshold = 0.3,
    maxSkills = 3
  } = options;

  // Discover all available skills
  const skills = await discoverSkills(skillsDir);

  if (skills.length === 0) {
    return {
      skills: [],
      instruction: null,
      message: 'No skills found in .claude/skills/'
    };
  }

  // Score each skill for relevance
  const scoredSkills = skills.map(skill => ({
    ...skill,
    score: scoreRelevance(prompt, skill)
  }));

  // Sort by score descending
  scoredSkills.sort((a, b) => b.score - a.score);

  // Filter by threshold and limit
  const relevantSkills = scoredSkills
    .filter(skill => skill.score >= threshold)
    .slice(0, maxSkills);

  if (relevantSkills.length === 0) {
    return {
      skills: [],
      instruction: null,
      message: `No skills relevant to prompt (highest score: ${scoredSkills[0]?.score.toFixed(2) || 0})`
    };
  }

  // Generate activation instruction
  const skillNames = relevantSkills.map(s => s.name).join(', ');
  const instruction = `The following skills are relevant to this task and should be considered:\n\n${relevantSkills.map(s =>
    `- **${s.name}** (relevance: ${(s.score * 100).toFixed(0)}%)\n  Path: ${s.path}`
  ).join('\n')}`;

  return {
    skills: relevantSkills,
    instruction,
    message: `Activated ${relevantSkills.length} skill(s): ${skillNames}`
  };
}

/**
 * Hook entry point
 *
 * Called by Claude Code's hook system.
 *
 * @param {Object} context - Hook context
 * @param {string} context.prompt - User prompt
 * @param {Object} context.config - Hook configuration
 * @returns {Object} - Hook result
 */
async function hook(context) {
  const { prompt, config = {} } = context;

  try {
    const result = await analyzeAndActivateSkills(prompt, config);

    // Log activation for debugging
    if (result.skills.length > 0) {
      console.log(`[Skills Hook] ${result.message}`);
      result.skills.forEach(skill => {
        console.log(`  - ${skill.name}: ${(skill.score * 100).toFixed(0)}% relevant`);
      });
    }

    return {
      success: true,
      ...result
    };
  } catch (error) {
    console.error(`[Skills Hook] Error: ${error.message}`);
    return {
      success: false,
      error: error.message,
      skills: [],
      instruction: null
    };
  }
}

// Export functions for testing
module.exports = {
  hook,
  analyzeAndActivateSkills,
  discoverSkills,
  extractKeywords,
  scoreRelevance
};
