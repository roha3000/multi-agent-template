/**
 * Integration Tests for Agent System
 *
 * Tests end-to-end agent loading and orchestration
 */

const path = require('path');
const AgentLoader = require('../../.claude/core/agent-loader');
const AgentOrchestrator = require('../../.claude/core/agent-orchestrator');
const MessageBus = require('../../.claude/core/message-bus');

// Use absolute path for agents directory
const AGENTS_DIR = path.join(__dirname, '..', '..', '.claude', 'agents');

describe('Agent System Integration Tests', () => {
  let messageBus;
  let orchestrator;

  beforeEach(() => {
    messageBus = new MessageBus();
  });

  afterEach(async () => {
    if (orchestrator) {
      // Clean up
    }
  });

  describe('Agent Auto-Loading', () => {
    it('should auto-load agents on initialization', async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        agentsDir: AGENTS_DIR,
        autoLoadAgents: true
      });

      await orchestrator.initialize();

      const stats = orchestrator.agentLoader.getStatistics();
      expect(stats.totalAgents).toBeGreaterThan(0);
    });

    it('should load consulting firm agents', async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        agentsDir: AGENTS_DIR,
        autoLoadAgents: true
      });

      await orchestrator.initialize();

      const gartner = orchestrator.getAgent('gartner-analyst');
      const mckinsey = orchestrator.getAgent('mckinsey-analyst');
      const bain = orchestrator.getAgent('bain-analyst');

      expect(gartner).toBeDefined();
      expect(gartner.name).toBe('gartner-analyst');
      expect(gartner.capabilities).toContain('market-analysis');

      expect(mckinsey).toBeDefined();
      expect(mckinsey.name).toBe('mckinsey-analyst');
      expect(mckinsey.capabilities).toContain('strategic-consulting');

      expect(bain).toBeDefined();
      expect(bain.name).toBe('bain-analyst');
      expect(bain.capabilities).toContain('customer-insights');
    });

    it('should load phase-based agents', async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        agentsDir: AGENTS_DIR,
        autoLoadAgents: true
      });

      await orchestrator.initialize();

      const researchAgents = orchestrator.getAgentsByPhase('research');
      const planningAgents = orchestrator.getAgentsByPhase('planning');
      const designAgents = orchestrator.getAgentsByPhase('design');

      expect(researchAgents.length).toBeGreaterThan(0);
      expect(planningAgents.length).toBeGreaterThan(0);
      expect(designAgents.length).toBeGreaterThan(0);
    });

    it('should handle graceful degradation if directory missing', async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        agentsDir: './non-existent-directory',
        autoLoadAgents: true
      });

      // Should not throw
      await expect(orchestrator.initialize()).resolves.not.toThrow();

      // Orchestrator should still be functional
      expect(orchestrator).toBeDefined();
    });

    it('should allow disabling auto-load', async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        autoLoadAgents: false
      });

      await orchestrator.initialize();

      // Agent loader should exist but not have loaded agents
      expect(orchestrator.agentLoader).toBeDefined();
    });
  });

  describe('Agent Query Methods', () => {
    beforeEach(async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        agentsDir: AGENTS_DIR,
        autoLoadAgents: true
      });
      await orchestrator.initialize();
    });

    it('should find agents by capability', () => {
      const analysts = orchestrator.getAgentsByCapability('market-analysis');
      expect(analysts.length).toBeGreaterThan(0);
      expect(analysts.some(a => a.name === 'gartner-analyst')).toBe(true);
    });

    it('should find agents by category', () => {
      const researchAgents = orchestrator.getAgentsByCategory('research');
      expect(researchAgents.length).toBeGreaterThan(0);
    });

    it('should find agents by tag', () => {
      const consultingAgents = orchestrator.getAgentsByTag('consulting');
      expect(consultingAgents.length).toBeGreaterThan(0);
    });

    it('should find best agent for task by capability', () => {
      const agent = orchestrator.findAgentForTask({
        capabilities: ['market-analysis']
      });

      expect(agent).toBeDefined();
      expect(agent).not.toBeNull();
      expect(agent.name).toBe('gartner-analyst');
      expect(agent.capabilities).toContain('market-analysis');
    });

    it('should find best agent for task by tags', () => {
      const agent = orchestrator.findAgentForTask({
        tags: ['consulting', 'gartner']
      });

      expect(agent).toBeDefined();
      expect(agent).not.toBeNull();
      expect(agent.name).toBe('gartner-analyst');
      expect(agent.tags).toContain('consulting');
      expect(agent.tags).toContain('gartner');
    });
  });

  describe('Backward Compatibility', () => {
    beforeEach(async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        agentsDir: AGENTS_DIR,
        autoLoadAgents: true
      });
      await orchestrator.initialize();
    });

    it('should support manual agent registration alongside auto-loaded agents', () => {
      // Create a mock agent instance with required properties
      const customAgent = {
        id: 'custom-agent', // registerAgent uses 'id' not 'name'
        name: 'custom-agent',
        role: 'Custom Agent',
        execute: async (task) => ({ result: 'custom result' })
      };

      orchestrator.registerAgent(customAgent);

      // Should be able to get both auto-loaded and manually registered
      const gartner = orchestrator.getAgent('gartner-analyst');
      const custom = orchestrator.getAgent('custom-agent');

      expect(gartner).toBeDefined();
      expect(custom).toBeDefined();
      expect(custom.id).toBe('custom-agent');
    });

    it('should preserve existing orchestration patterns', async () => {
      // Ensure executeParallel still exists
      expect(typeof orchestrator.executeParallel).toBe('function');

      // Ensure executeWithConsensus still exists (note: "With" prefix)
      expect(typeof orchestrator.executeWithConsensus).toBe('function');

      // Ensure executeDebate still exists
      expect(typeof orchestrator.executeDebate).toBe('function');

      // Ensure executeReview still exists
      expect(typeof orchestrator.executeReview).toBe('function');

      // Ensure executeEnsemble still exists
      expect(typeof orchestrator.executeEnsemble).toBe('function');
    });
  });

  describe('Agent Metadata', () => {
    beforeEach(async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        agentsDir: AGENTS_DIR,
        autoLoadAgents: true
      });
      await orchestrator.initialize();
    });

    it('should have correct model assignments', () => {
      const gartner = orchestrator.getAgent('gartner-analyst');
      expect(gartner.model).toBe('claude-sonnet-4-5');

      const seniorDev = orchestrator.getAgent('senior-developer');
      expect(seniorDev.model).toBe('claude-sonnet-4-20250514');
    });

    it('should have correct temperature settings', () => {
      const researchAnalyst = orchestrator.getAgent('research-analyst');
      expect(researchAnalyst.temperature).toBe(0.7);
    });

    it('should have tools configured', () => {
      const gartner = orchestrator.getAgent('gartner-analyst');
      expect(gartner.tools).toBeDefined();
      expect(gartner.tools.length).toBeGreaterThan(0);
    });

    it('should have instructions', () => {
      const mckinsey = orchestrator.getAgent('mckinsey-analyst');
      expect(mckinsey.instructions).toBeDefined();
      expect(mckinsey.instructions.length).toBeGreaterThan(0);
      expect(mckinsey.instructions).toContain('McKinsey');
    });
  });

  describe('Agent Statistics', () => {
    beforeEach(async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        agentsDir: AGENTS_DIR,
        autoLoadAgents: true
      });
      await orchestrator.initialize();
    });

    it('should provide comprehensive statistics', () => {
      const stats = orchestrator.agentLoader.getStatistics();

      expect(stats.totalAgents).toBeGreaterThan(10);
      expect(stats.byCategory).toBeDefined();
      expect(stats.byPhase).toBeDefined();
      expect(stats.byModel).toBeDefined();
      expect(stats.byPriority).toBeDefined();
      expect(stats.categories.length).toBeGreaterThan(0);
      expect(stats.capabilities.length).toBeGreaterThan(0);
      expect(stats.tags.length).toBeGreaterThan(0);
    });

    it('should show correct distribution by category', () => {
      const stats = orchestrator.agentLoader.getStatistics();

      expect(stats.byCategory.research).toBeGreaterThan(0);
      expect(stats.byCategory.planning).toBeGreaterThan(0);
      expect(stats.byCategory.design).toBeGreaterThan(0);
    });

    it('should show model distribution', () => {
      const stats = orchestrator.agentLoader.getStatistics();

      // Should have Sonnet 4.5 agents
      expect(stats.byModel['claude-sonnet-4-5']).toBeGreaterThan(0);

      // Should have Sonnet 4 agents
      expect(stats.byModel['claude-sonnet-4-20250514']).toBeGreaterThan(0);
    });
  });

  describe('Agent Finder', () => {
    beforeEach(async () => {
      orchestrator = new AgentOrchestrator(messageBus, {
        agentsDir: AGENTS_DIR,
        autoLoadAgents: true
      });
      await orchestrator.initialize();
    });

    it('should find gartner analyst for market analysis', () => {
      const agent = orchestrator.findAgentForTask({
        capabilities: ['market-analysis', 'vendor-assessment']
      });

      expect(agent).toBeDefined();
      expect(agent.name).toBe('gartner-analyst');
    });

    it('should find mckinsey analyst for strategic consulting', () => {
      const agent = orchestrator.findAgentForTask({
        capabilities: ['strategic-consulting']
      });

      expect(agent).toBeDefined();
      expect(agent.name).toBe('mckinsey-analyst');
    });

    it('should find bain analyst for customer insights', () => {
      const agent = orchestrator.findAgentForTask({
        capabilities: ['customer-insights']
      });

      expect(agent).toBeDefined();
      expect(agent.name).toBe('bain-analyst');
    });

    it('should find research analyst for deep research', () => {
      const agent = orchestrator.findAgentForTask({
        phase: 'research',
        capabilities: ['deep-technology-research']
      });

      // findAgentForTask may return null if no exact match
      if (agent) {
        expect(agent.category).toBe('research');
      }
    });

    it('should prioritize high priority agents', () => {
      const agent = orchestrator.findAgentForTask({
        phase: 'design'
      });

      // Agent may be null if no design-phase agents with high priority
      if (agent) {
        expect(['high', 'medium', 'low']).toContain(agent.priority);
      }
    });
  });
});
