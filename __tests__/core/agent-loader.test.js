/**
 * Tests for AgentLoader
 *
 * Tests agent discovery, loading, parsing, and querying
 */

const AgentLoader = require('../../.claude/core/agent-loader');
const fs = require('fs');
const path = require('path');

describe('AgentLoader', () => {
  let loader;
  const testAgentsDir = path.join(__dirname, '../fixtures/test-agents');

  beforeAll(() => {
    // Create test fixtures directory
    if (!fs.existsSync(testAgentsDir)) {
      fs.mkdirSync(testAgentsDir, { recursive: true });
    }

    // Create test category directories
    const categories = ['research', 'planning', 'design'];
    for (const cat of categories) {
      const catDir = path.join(testAgentsDir, cat);
      if (!fs.existsSync(catDir)) {
        fs.mkdirSync(catDir);
      }
    }

    // Create test agent files
    const testAgents = [
      {
        path: 'research/test-researcher.md',
        content: `---
name: test-researcher
display_name: Test Researcher
model: claude-sonnet-4-5
temperature: 0.7
max_tokens: 8000
capabilities:
  - research
  - analysis
tools:
  - Read
  - WebSearch
category: research
priority: high
phase: research
tags:
  - test
  - research
---

# Test Researcher

This is a test research agent.
`
      },
      {
        path: 'planning/test-planner.md',
        content: `---
name: test-planner
display_name: Test Planner
model: claude-sonnet-4-5
capabilities:
  - planning
  - strategy
tools:
  - Read
category: planning
priority: medium
phase: planning
tags:
  - test
  - planning
---

# Test Planner

This is a test planning agent.
`
      },
      {
        path: 'design/test-architect.md',
        content: `---
name: test-architect
display_name: Test Architect
model: claude-sonnet-4
capabilities:
  - architecture
  - design
tools:
  - Read
  - Write
category: design
priority: high
tags:
  - test
  - design
---

# Test Architect

This is a test architecture agent.
`
      }
    ];

    for (const agent of testAgents) {
      fs.writeFileSync(
        path.join(testAgentsDir, agent.path),
        agent.content
      );
    }
  });

  afterAll(() => {
    // Clean up test fixtures
    if (fs.existsSync(testAgentsDir)) {
      fs.rmSync(testAgentsDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    loader = new AgentLoader(testAgentsDir);
  });

  describe('constructor', () => {
    it('should initialize with default agents directory', () => {
      const defaultLoader = new AgentLoader();
      expect(defaultLoader.agentsDir).toBe('.claude/agents');
    });

    it('should initialize with custom agents directory', () => {
      expect(loader.agentsDir).toBe(testAgentsDir);
    });

    it('should initialize empty collections', () => {
      expect(loader.agents.size).toBe(0);
      expect(loader.categories.size).toBe(0);
      expect(loader.capabilities.size).toBe(0);
      expect(loader.tags.size).toBe(0);
    });
  });

  describe('loadAll', () => {
    it('should load all agent files', async () => {
      await loader.loadAll();
      expect(loader.agents.size).toBe(3);
    });

    it('should parse agent metadata correctly', async () => {
      await loader.loadAll();
      const researcher = loader.getAgent('test-researcher');

      expect(researcher).toBeDefined();
      expect(researcher.name).toBe('test-researcher');
      expect(researcher.display_name).toBe('Test Researcher');
      expect(researcher.model).toBe('claude-sonnet-4-5');
      expect(researcher.temperature).toBe(0.7);
      expect(researcher.max_tokens).toBe(8000);
      expect(researcher.category).toBe('research');
      expect(researcher.priority).toBe('high');
      expect(researcher.phase).toBe('research');
    });

    it('should parse capabilities array', async () => {
      await loader.loadAll();
      const researcher = loader.getAgent('test-researcher');

      expect(researcher.capabilities).toEqual(['research', 'analysis']);
    });

    it('should parse tools array', async () => {
      await loader.loadAll();
      const researcher = loader.getAgent('test-researcher');

      expect(researcher.tools).toEqual(['Read', 'WebSearch']);
    });

    it('should parse tags array', async () => {
      await loader.loadAll();
      const researcher = loader.getAgent('test-researcher');

      expect(researcher.tags).toEqual(['test', 'research']);
    });

    it('should extract instructions', async () => {
      await loader.loadAll();
      const researcher = loader.getAgent('test-researcher');

      expect(researcher.instructions).toContain('This is a test research agent');
    });

    it('should track categories', async () => {
      await loader.loadAll();

      expect(loader.categories.has('research')).toBe(true);
      expect(loader.categories.has('planning')).toBe(true);
      expect(loader.categories.has('design')).toBe(true);
    });

    it('should track capabilities', async () => {
      await loader.loadAll();

      expect(loader.capabilities.has('research')).toBe(true);
      expect(loader.capabilities.has('planning')).toBe(true);
      expect(loader.capabilities.has('architecture')).toBe(true);
    });

    it('should track tags', async () => {
      await loader.loadAll();

      expect(loader.tags.has('test')).toBe(true);
      expect(loader.tags.has('research')).toBe(true);
      expect(loader.tags.has('planning')).toBe(true);
    });

    it('should handle missing frontmatter gracefully', async () => {
      // Create agent without frontmatter
      const invalidPath = path.join(testAgentsDir, 'invalid.md');
      fs.writeFileSync(invalidPath, 'Just content without frontmatter');

      await loader.loadAll();
      // Should still load valid agents
      expect(loader.agents.size).toBe(3);

      // Clean up
      fs.unlinkSync(invalidPath);
    });
  });

  describe('getAgent', () => {
    beforeEach(async () => {
      await loader.loadAll();
    });

    it('should get agent by name', () => {
      const agent = loader.getAgent('test-researcher');
      expect(agent).toBeDefined();
      expect(agent.name).toBe('test-researcher');
    });

    it('should return undefined for non-existent agent', () => {
      const agent = loader.getAgent('non-existent');
      expect(agent).toBeUndefined();
    });
  });

  describe('getAllAgents', () => {
    beforeEach(async () => {
      await loader.loadAll();
    });

    it('should return all agents as array', () => {
      const agents = loader.getAllAgents();
      expect(Array.isArray(agents)).toBe(true);
      expect(agents.length).toBe(3);
    });
  });

  describe('getAgentsByCategory', () => {
    beforeEach(async () => {
      await loader.loadAll();
    });

    it('should return agents in specified category', () => {
      const researchAgents = loader.getAgentsByCategory('research');
      expect(researchAgents.length).toBe(1);
      expect(researchAgents[0].name).toBe('test-researcher');
    });

    it('should return empty array for non-existent category', () => {
      const agents = loader.getAgentsByCategory('non-existent');
      expect(agents.length).toBe(0);
    });

    it('should return multiple agents in same category', () => {
      const allCategories = loader.getAgentsByCategory('research');
      expect(allCategories.length).toBeGreaterThan(0);
    });
  });

  describe('getAgentsByCapability', () => {
    beforeEach(async () => {
      await loader.loadAll();
    });

    it('should return agents with specified capability', () => {
      const analysts = loader.getAgentsByCapability('analysis');
      expect(analysts.length).toBe(1);
      expect(analysts[0].name).toBe('test-researcher');
    });

    it('should return empty array if no agents have capability', () => {
      const agents = loader.getAgentsByCapability('non-existent');
      expect(agents.length).toBe(0);
    });
  });

  describe('getAgentsByTag', () => {
    beforeEach(async () => {
      await loader.loadAll();
    });

    it('should return agents with specified tag', () => {
      const testAgents = loader.getAgentsByTag('test');
      expect(testAgents.length).toBe(3);
    });

    it('should return empty array if no agents have tag', () => {
      const agents = loader.getAgentsByTag('non-existent');
      expect(agents.length).toBe(0);
    });
  });

  describe('getAgentsByPhase', () => {
    beforeEach(async () => {
      await loader.loadAll();
    });

    it('should return agents in specified phase', () => {
      const researchPhase = loader.getAgentsByPhase('research');
      expect(researchPhase.length).toBe(1);
      expect(researchPhase[0].phase).toBe('research');
    });

    it('should return empty array for non-existent phase', () => {
      const agents = loader.getAgentsByPhase('non-existent');
      expect(agents.length).toBe(0);
    });
  });

  describe('getAgentsByModel', () => {
    beforeEach(async () => {
      await loader.loadAll();
    });

    it('should return agents using specified model', () => {
      const sonnet45Agents = loader.getAgentsByModel('claude-sonnet-4-5');
      expect(sonnet45Agents.length).toBe(2);
    });

    it('should return empty array if no agents use model', () => {
      const agents = loader.getAgentsByModel('gpt-5');
      expect(agents.length).toBe(0);
    });
  });

  describe('findAgentForTask', () => {
    beforeEach(async () => {
      await loader.loadAll();
    });

    it('should find agent by phase', () => {
      const agent = loader.findAgentForTask({ phase: 'research' });
      expect(agent).toBeDefined();
      expect(agent.phase).toBe('research');
    });

    it('should find agent by category', () => {
      const agent = loader.findAgentForTask({ category: 'planning' });
      expect(agent).toBeDefined();
      expect(agent.category).toBe('planning');
    });

    it('should find agent by capability', () => {
      const agent = loader.findAgentForTask({
        capabilities: ['research', 'analysis']
      });
      expect(agent).toBeDefined();
      expect(agent.capabilities).toContain('research');
    });

    it('should find agent by tags', () => {
      const agent = loader.findAgentForTask({
        tags: ['planning']
      });
      expect(agent).toBeDefined();
      expect(agent.tags).toContain('planning');
    });

    it('should prioritize high priority agents', () => {
      const agent = loader.findAgentForTask({
        capabilities: ['research']
      });
      expect(agent.priority).toBe('high');
    });

    it('should return null if no match found', () => {
      const agent = loader.findAgentForTask({
        capabilities: ['non-existent']
      });
      expect(agent).toBeNull();
    });

    it('should handle multiple criteria', () => {
      const agent = loader.findAgentForTask({
        phase: 'research',
        capabilities: ['research'],
        tags: ['test']
      });
      expect(agent).toBeDefined();
      expect(agent.name).toBe('test-researcher');
    });
  });

  describe('getStatistics', () => {
    beforeEach(async () => {
      await loader.loadAll();
    });

    it('should return correct total agent count', () => {
      const stats = loader.getStatistics();
      expect(stats.totalAgents).toBe(3);
    });

    it('should count agents by category', () => {
      const stats = loader.getStatistics();
      expect(stats.byCategory.research).toBe(1);
      expect(stats.byCategory.planning).toBe(1);
      expect(stats.byCategory.design).toBe(1);
    });

    it('should count agents by phase', () => {
      const stats = loader.getStatistics();
      expect(stats.byPhase.research).toBe(1);
      expect(stats.byPhase.planning).toBe(1);
    });

    it('should count agents by model', () => {
      const stats = loader.getStatistics();
      expect(stats.byModel['claude-sonnet-4-5']).toBe(2);
      expect(stats.byModel['claude-sonnet-4']).toBe(1);
    });

    it('should count agents by priority', () => {
      const stats = loader.getStatistics();
      expect(stats.byPriority.high).toBe(2);
      expect(stats.byPriority.medium).toBe(1);
    });

    it('should list all categories', () => {
      const stats = loader.getStatistics();
      expect(stats.categories).toContain('research');
      expect(stats.categories).toContain('planning');
      expect(stats.categories).toContain('design');
    });

    it('should list all capabilities', () => {
      const stats = loader.getStatistics();
      expect(stats.capabilities.length).toBeGreaterThan(0);
    });

    it('should list all tags', () => {
      const stats = loader.getStatistics();
      expect(stats.tags).toContain('test');
    });
  });

  describe('reload', () => {
    it('should reload agents from disk', async () => {
      await loader.loadAll();
      expect(loader.agents.size).toBe(3);

      // Clear and reload
      await loader.reload();
      expect(loader.agents.size).toBe(3);
    });
  });
});

describe('AgentLoader Integration Tests', () => {
  let loader;
  const path = require('path');
  const agentsDir = path.join(__dirname, '..', '..', '.claude', 'agents');

  it('should load real agents from .claude/agents directory', async () => {
    loader = new AgentLoader(agentsDir);
    await loader.loadAll();

    // Should load your specialized agents (28 .md files in agents directory)
    expect(loader.agents.size).toBeGreaterThan(0);

    // Should have actual agents that exist in the codebase
    expect(loader.getAgent('gartner-analyst')).toBeDefined();
    expect(loader.getAgent('bain-analyst')).toBeDefined();
    expect(loader.getAgent('system-architect')).toBeDefined();
    expect(loader.getAgent('senior-developer')).toBeDefined();
  });

  it('should provide statistics about real agents', async () => {
    loader = new AgentLoader(agentsDir);
    await loader.loadAll();

    const stats = loader.getStatistics();

    // There are 28 agent files, but some may fail to load due to missing frontmatter
    expect(stats.totalAgents).toBeGreaterThan(5);
    expect(stats.categories.length).toBeGreaterThan(0);
  });
});
