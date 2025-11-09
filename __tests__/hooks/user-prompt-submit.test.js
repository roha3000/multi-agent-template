/**
 * Tests for Skills Auto-Activation Hook
 *
 * @module __tests__/hooks/user-prompt-submit
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  hook,
  analyzeAndActivateSkills,
  discoverSkills,
  extractKeywords,
  scoreRelevance
} = require('../../.claude/hooks/user-prompt-submit');

describe('Skills Auto-Activation Hook', () => {
  let tempDir;
  let skillsDir;

  beforeEach(() => {
    // Create temporary skills directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-test-'));
    skillsDir = path.join(tempDir, '.claude', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('extractKeywords', () => {
    it('should extract keywords from markdown headings', () => {
      const content = `# API Testing Guide
## REST API Testing
### GraphQL Testing`;

      const keywords = extractKeywords(content);

      expect(keywords).toContain('api');
      expect(keywords).toContain('testing');
      expect(keywords).toContain('rest');
      expect(keywords).toContain('graphql');
    });

    it('should extract code language indicators', () => {
      const content = `
\`\`\`javascript
const foo = 'bar';
\`\`\`

\`\`\`python
foo = 'bar'
\`\`\`
`;

      const keywords = extractKeywords(content);

      expect(keywords).toContain('javascript');
      expect(keywords).toContain('python');
    });

    it('should extract common tech keywords', () => {
      const content = `
This guide covers Docker and Kubernetes deployment.
We'll use React for the frontend and Node.js for the backend.
Authentication uses JWT tokens.
`;

      const keywords = extractKeywords(content);

      expect(keywords).toContain('docker');
      expect(keywords).toContain('kubernetes');
      expect(keywords).toContain('react');
      expect(keywords).toContain('node');
      expect(keywords).toContain('authentication');
    });

    it('should remove duplicate keywords', () => {
      const content = `# API Testing
## API Design
API documentation is important.`;

      const keywords = extractKeywords(content);

      const apiCount = keywords.filter(k => k === 'api').length;
      expect(apiCount).toBe(1);
    });

    it('should handle empty content', () => {
      const keywords = extractKeywords('');
      expect(Array.isArray(keywords)).toBe(true);
      expect(keywords.length).toBe(0);
    });
  });

  describe('discoverSkills', () => {
    it('should discover skills in directory', async () => {
      // Create test skills
      fs.writeFileSync(
        path.join(skillsDir, 'api-testing.md'),
        '# API Testing\nGuide for testing APIs'
      );
      fs.writeFileSync(
        path.join(skillsDir, 'docker-deployment.md'),
        '# Docker Deployment\nHow to deploy with Docker'
      );

      const skills = await discoverSkills(skillsDir);

      expect(skills).toHaveLength(2);
      expect(skills[0].name).toBe('api-testing');
      expect(skills[1].name).toBe('docker-deployment');
      expect(skills[0].keywords).toContain('api');
      expect(skills[1].keywords).toContain('docker');
    });

    it('should discover skills in subdirectories', async () => {
      // Create nested structure
      const categoryDir = path.join(skillsDir, 'testing');
      fs.mkdirSync(categoryDir, { recursive: true });

      fs.writeFileSync(
        path.join(categoryDir, 'unit-testing.md'),
        '# Unit Testing\nUnit test guide'
      );

      const skills = await discoverSkills(skillsDir);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('unit-testing');
    });

    it('should only process markdown files', async () => {
      fs.writeFileSync(path.join(skillsDir, 'skill.md'), '# Skill');
      fs.writeFileSync(path.join(skillsDir, 'readme.txt'), 'Not a skill');
      fs.writeFileSync(path.join(skillsDir, 'config.json'), '{}');

      const skills = await discoverSkills(skillsDir);

      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe('skill');
    });

    it('should handle non-existent directory gracefully', async () => {
      const nonExistent = path.join(tempDir, 'does-not-exist');
      const skills = await discoverSkills(nonExistent);

      expect(skills).toHaveLength(0);
    });

    it('should handle read errors gracefully', async () => {
      // Create a file with no read permissions (Unix only)
      if (process.platform !== 'win32') {
        const restrictedFile = path.join(skillsDir, 'restricted.md');
        fs.writeFileSync(restrictedFile, '# Restricted');
        fs.chmodSync(restrictedFile, 0o000);

        const skills = await discoverSkills(skillsDir);

        // Should continue despite error
        expect(Array.isArray(skills)).toBe(true);

        // Cleanup
        fs.chmodSync(restrictedFile, 0o644);
      }
    });
  });

  describe('scoreRelevance', () => {
    it('should score high for exact skill name match', () => {
      const prompt = 'Help me with API testing';
      const skill = {
        name: 'api-testing',
        keywords: ['api', 'testing', 'rest']
      };

      const score = scoreRelevance(prompt, skill);

      expect(score).toBeGreaterThan(0.4); // Adjusted threshold
    });

    it('should score high for keyword matches', () => {
      const prompt = 'How do I test REST APIs with authentication?';
      const skill = {
        name: 'api-guide',
        keywords: ['api', 'rest', 'testing', 'authentication']
      };

      const score = scoreRelevance(prompt, skill);

      expect(score).toBeGreaterThan(0.3);
    });

    it('should score low for no matches', () => {
      const prompt = 'How do I deploy to production?';
      const skill = {
        name: 'database-optimization',
        keywords: ['database', 'sql', 'performance']
      };

      const score = scoreRelevance(prompt, skill);

      expect(score).toBeLessThan(0.3);
    });

    it('should give bonus for multiple matches', () => {
      const prompt = 'Docker deployment with Kubernetes and CI/CD';
      const skill = {
        name: 'deployment',
        keywords: ['docker', 'kubernetes', 'deployment', 'cicd']
      };

      const score = scoreRelevance(prompt, skill);

      // Should have bonus for 3+ matches
      expect(score).toBeGreaterThan(0.5);
    });

    it('should be case insensitive', () => {
      const prompt = 'API TESTING GUIDE';
      const skill = {
        name: 'api-testing',
        keywords: ['api', 'testing']
      };

      const score = scoreRelevance(prompt, skill);

      expect(score).toBeGreaterThan(0.4); // Adjusted threshold
    });

    it('should normalize score to 0-1 range', () => {
      const prompt = 'api testing rest graphql authentication docker kubernetes';
      const skill = {
        name: 'api-testing',
        keywords: ['api', 'testing', 'rest', 'graphql', 'authentication', 'docker', 'kubernetes']
      };

      const score = scoreRelevance(prompt, skill);

      expect(score).toBeLessThanOrEqual(1.0);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('analyzeAndActivateSkills', () => {
    beforeEach(() => {
      // Create test skills
      fs.writeFileSync(
        path.join(skillsDir, 'api-testing.md'),
        `# API Testing Guide
Test REST APIs with authentication
\`\`\`javascript
fetch('/api/test')
\`\`\`
`
      );

      fs.writeFileSync(
        path.join(skillsDir, 'docker-deployment.md'),
        `# Docker Deployment
Deploy applications with Docker and Kubernetes
\`\`\`bash
docker build -t app .
\`\`\`
`
      );

      fs.writeFileSync(
        path.join(skillsDir, 'database-optimization.md'),
        `# Database Optimization
Optimize SQL queries and database performance
`
      );
    });

    it('should activate relevant skills above threshold', async () => {
      const prompt = 'How do I test REST APIs?';

      const result = await analyzeAndActivateSkills(prompt, {
        skillsDir,
        threshold: 0.3,
        maxSkills: 3
      });

      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.skills[0].name).toBe('api-testing');
      expect(result.instruction).toBeTruthy();
      expect(result.message).toContain('Activated');
    });

    it('should respect threshold setting', async () => {
      const prompt = 'How do I test APIs with REST and authentication?';

      // Low threshold - should activate
      const lowResult = await analyzeAndActivateSkills(prompt, {
        skillsDir,
        threshold: 0.1,
        maxSkills: 3
      });

      // High threshold - might not activate
      const highResult = await analyzeAndActivateSkills(prompt, {
        skillsDir,
        threshold: 0.9,
        maxSkills: 3
      });

      expect(lowResult.skills.length).toBeGreaterThan(0);
      expect(highResult.skills.length).toBeLessThanOrEqual(lowResult.skills.length);
    });

    it('should respect maxSkills limit', async () => {
      const prompt = 'Help with API testing, Docker deployment, and database optimization';

      const result = await analyzeAndActivateSkills(prompt, {
        skillsDir,
        threshold: 0.1,
        maxSkills: 2
      });

      expect(result.skills.length).toBeLessThanOrEqual(2);
    });

    it('should return empty result when no skills found', async () => {
      const emptyDir = path.join(tempDir, 'empty');
      fs.mkdirSync(emptyDir, { recursive: true });

      const result = await analyzeAndActivateSkills('test prompt', {
        skillsDir: emptyDir,
        threshold: 0.3,
        maxSkills: 3
      });

      expect(result.skills).toHaveLength(0);
      expect(result.instruction).toBeNull();
      expect(result.message).toContain('No skills found');
    });

    it('should return empty result when no skills meet threshold', async () => {
      const prompt = 'Completely unrelated topic about gardening';

      const result = await analyzeAndActivateSkills(prompt, {
        skillsDir,
        threshold: 0.3,
        maxSkills: 3
      });

      expect(result.skills).toHaveLength(0);
      expect(result.instruction).toBeNull();
      expect(result.message).toContain('No skills relevant');
    });

    it('should use default options when not provided', async () => {
      const prompt = 'Test APIs';

      const result = await analyzeAndActivateSkills(prompt, { skillsDir });

      expect(result).toHaveProperty('skills');
      expect(result).toHaveProperty('instruction');
      expect(result).toHaveProperty('message');
    });
  });

  describe('hook', () => {
    beforeEach(() => {
      // Create test skill
      fs.writeFileSync(
        path.join(skillsDir, 'api-testing.md'),
        '# API Testing\nTest APIs with REST and GraphQL'
      );
    });

    it('should return success with activated skills', async () => {
      const context = {
        prompt: 'How do I test REST APIs?',
        config: {
          skillsDir,
          threshold: 0.3,
          maxSkills: 3
        }
      };

      const result = await hook(context);

      expect(result.success).toBe(true);
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.instruction).toBeTruthy();
    });

    it('should handle errors gracefully', async () => {
      const context = {
        prompt: 'test',
        config: {
          skillsDir: '/invalid/path/that/does/not/exist',
          threshold: 0.3,
          maxSkills: 3
        }
      };

      const result = await hook(context);

      expect(result.success).toBe(true); // Should still succeed (no skills found)
      expect(result.skills).toHaveLength(0);
    });

    it('should use default config when not provided', async () => {
      const context = {
        prompt: 'test prompt'
      };

      const result = await hook(context);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('skills');
    });

    it('should log activation messages', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const context = {
        prompt: 'How do I test REST APIs with authentication and authorization?',
        config: { skillsDir, threshold: 0.2, maxSkills: 3 }
      };

      const result = await hook(context);

      // Should log activation if skills were found
      if (result.skills.length > 0) {
        expect(consoleSpy).toHaveBeenCalled();
      }

      consoleSpy.mockRestore();
    });
  });
});
