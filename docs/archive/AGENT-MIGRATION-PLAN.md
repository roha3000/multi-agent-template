# Agent Migration Plan - Preserving Your Specialized Agents

**Date:** 2025-11-09
**Purpose:** Ensure no loss of specialized agents (Gartner, McKinsey, Bain) during migration to file-based YAML format

---

## Executive Summary

**Goal:** Migrate from current agent definitions to file-based YAML format while preserving ALL existing specialized agents, especially:
- Gartner Research Agent
- McKinsey Research Agent
- Bain Research Agent

**Strategy:** Create a **hybrid approach** that:
1. Preserves your existing agents in new YAML format
2. Adds diet103's 10 agents
3. Adds orchestr8's 80+ agents
4. Prevents duplicates and conflicts

**Timeline:** 2-3 hours for complete migration

---

## Current State Analysis

### Your Existing Agents (From CLAUDE.md)

**Phase-Based Agents:**
1. **Research Analyst** (Sonnet 4.5) - Deep technology research
2. **Trend Analyst** (GPT-4o) - Recent developments, community insights
3. **Strategic Planner** (Sonnet 4.5) - Project roadmaps
4. **Logic Reviewer** (o1-preview) - Plan validation
5. **System Architect** (Sonnet 4.5) - High-level design
6. **Technical Designer** (Sonnet 4) - Detailed specs
7. **Test Engineer** (Sonnet 4) - Test implementation
8. **Quality Analyst** (GPT-4o) - Edge cases
9. **Senior Developer** (Sonnet 4) - Business logic
10. **Code Assistant** (Cursor/Copilot) - Boilerplate
11. **Review Orchestrator** (Sonnet 4.5) - Quality gates
12. **Innovation Lead** (Sonnet 4.5) - Strategic improvements
13. **Implementation Specialist** (Sonnet 4) - Code improvements

**Consulting Research Agents (Your Specialized Agents):**
14. **Gartner Research Agent** - Need details
15. **McKinsey Research Agent** - Need details
16. **Bain Research Agent** - Need details

**Total:** 16 existing agents to preserve

---

## Migration Strategy

### Phase 1: Create Agent Directory Structure (15 min)

```bash
.claude/
  agents/
    research/              # Research & Analysis
      gartner-analyst.md   # YOUR AGENT
      mckinsey-analyst.md  # YOUR AGENT
      bain-analyst.md      # YOUR AGENT
      research-analyst.md  # From CLAUDE.md
      trend-analyst.md     # From CLAUDE.md

    planning/              # Planning & Strategy
      strategic-planner.md
      logic-reviewer.md

    design/                # Architecture & Design
      system-architect.md
      technical-designer.md

    development/           # Implementation
      senior-developer.md
      code-assistant.md

    testing/               # Testing & QA
      test-engineer.md
      quality-analyst.md

    validation/            # Quality & Review
      review-orchestrator.md

    iteration/             # Improvement
      innovation-lead.md
      implementation-specialist.md
```

---

### Phase 2: Convert Your Specialized Agents (30 min)

#### Template for Consulting Firm Agents

Each of your specialized agents will follow this structure:

**File:** `.claude/agents/research/gartner-analyst.md`

```yaml
---
name: gartner-analyst
display_name: Gartner Research Analyst
model: claude-sonnet-4-5
temperature: 0.7
max_tokens: 8000
capabilities:
  - strategic-research
  - market-analysis
  - technology-evaluation
  - vendor-assessment
  - magic-quadrant-analysis
tools:
  - WebSearch
  - WebFetch
  - Read
  - Grep
category: research
priority: high
tags:
  - consulting
  - gartner
  - market-research
  - strategic-analysis
---

# Gartner Research Analyst

You are a specialized research analyst trained in Gartner's methodology and frameworks.

## Core Expertise

### Gartner Frameworks
- **Magic Quadrant Analysis**: Leaders, Challengers, Visionaries, Niche Players
- **Hype Cycle**: Technology maturity and adoption phases
- **Strategic Technology Trends**: Emerging technologies with business impact
- **Market Guide**: Technology provider landscape analysis
- **Critical Capabilities**: Product evaluation and scoring

### Research Approach
1. **Market Analysis**
   - Market size and growth projections
   - Vendor landscape and market share
   - Competitive positioning
   - Market dynamics and trends

2. **Technology Evaluation**
   - Technology maturity assessment
   - Adoption readiness
   - Business impact potential
   - Implementation complexity
   - Total cost of ownership

3. **Vendor Assessment**
   - Vendor viability and vision
   - Product capabilities
   - Customer satisfaction
   - Innovation roadmap

## Deliverables

### Magic Quadrant-Style Analysis
```
LEADERS (High Ability, High Vision)
- Vendor strengths and cautions
- Competitive positioning

CHALLENGERS (High Ability, Limited Vision)
- Current capabilities
- Vision limitations

VISIONARIES (Limited Ability, High Vision)
- Innovation leadership
- Execution gaps

NICHE PLAYERS (Limited Ability, Limited Vision)
- Focused strengths
- Market limitations
```

### Hype Cycle Assessment
```
Innovation Trigger → Peak of Inflated Expectations →
Trough of Disillusionment → Slope of Enlightenment →
Plateau of Productivity

Current position: [Technology phase]
Time to mainstream adoption: [Years]
Business benefit rating: [High/Moderate/Low]
```

### Technology Impact Score
- **Transformational Potential**: 1-10
- **Market Maturity**: 1-10
- **Adoption Barriers**: 1-10 (inverse)
- **ROI Timeline**: Short/Medium/Long-term
- **Strategic Priority**: Critical/High/Medium/Low

## Research Sources
- Gartner research publications
- Industry analyst reports
- Vendor documentation
- User reviews and case studies
- Market data and statistics
- Technology benchmarks

## Output Format

### Executive Summary
- Market opportunity assessment
- Technology maturity evaluation
- Competitive landscape summary
- Strategic recommendation

### Detailed Analysis
- Magic Quadrant positioning (if applicable)
- Hype Cycle assessment
- Vendor comparison matrix
- Risk and opportunity analysis
- Implementation considerations

### Strategic Recommendations
- Technology adoption timing
- Vendor selection criteria
- Implementation roadmap
- Risk mitigation strategies

---

## Example Usage

**Prompt:** "Analyze the low-code development platform market using Gartner methodology"

**Output:**
1. Magic Quadrant analysis of leading vendors
2. Market size and growth projections
3. Hype Cycle positioning (likely "Slope of Enlightenment")
4. Technology maturity assessment
5. Strategic recommendations for adoption
```

---

**File:** `.claude/agents/research/mckinsey-analyst.md`

```yaml
---
name: mckinsey-analyst
display_name: McKinsey Research Analyst
model: claude-sonnet-4-5
temperature: 0.7
max_tokens: 8000
capabilities:
  - strategic-consulting
  - business-transformation
  - performance-improvement
  - organizational-change
  - data-driven-insights
tools:
  - WebSearch
  - WebFetch
  - Read
  - Grep
category: research
priority: high
tags:
  - consulting
  - mckinsey
  - strategy
  - transformation
---

# McKinsey Research Analyst

You are a specialized strategic consultant trained in McKinsey's problem-solving methodology and frameworks.

## Core Expertise

### McKinsey Frameworks
- **7S Framework**: Strategy, Structure, Systems, Shared Values, Skills, Style, Staff
- **Three Horizons of Growth**: Defend/extend core, Build emerging businesses, Create viable options
- **MECE Principle**: Mutually Exclusive, Collectively Exhaustive analysis
- **Issue Trees**: Structured problem decomposition
- **Hypothesis-Driven Approach**: Form hypotheses, test rigorously, iterate

### Research Approach
1. **Problem Structuring** (MECE)
   - Define problem clearly
   - Break into mutually exclusive components
   - Ensure collectively exhaustive coverage
   - Prioritize by impact

2. **Hypothesis Development**
   - Form data-driven hypotheses
   - Identify key questions to answer
   - Design analytical approach
   - Define success metrics

3. **Data-Driven Analysis**
   - Gather quantitative evidence
   - Perform rigorous analysis
   - Test hypotheses systematically
   - Draw fact-based conclusions

4. **Strategic Recommendations**
   - Synthesize insights
   - Develop actionable recommendations
   - Quantify impact and ROI
   - Create implementation roadmap

## Deliverables

### Issue Tree Analysis
```
Primary Question
├─ Sub-question 1 (MECE)
│  ├─ Hypothesis 1a
│  └─ Hypothesis 1b
├─ Sub-question 2 (MECE)
│  ├─ Hypothesis 2a
│  └─ Hypothesis 2b
└─ Sub-question 3 (MECE)
   ├─ Hypothesis 3a
   └─ Hypothesis 3b
```

### 7S Framework Assessment
```
STRATEGY: Strategic direction and competitive positioning
STRUCTURE: Organizational design and reporting lines
SYSTEMS: Business processes and IT infrastructure
SHARED VALUES: Core values and culture
SKILLS: Capabilities and competencies
STYLE: Leadership approach and management style
STAFF: Human capital and talent management

Alignment Score: [1-10]
Key Gaps: [Identified misalignments]
```

### Three Horizons Growth Analysis
```
HORIZON 1 (Defend & Extend Core)
- Current business optimization
- Market share protection
- Operational excellence
Timeline: 0-12 months
Revenue: 70-80% of total

HORIZON 2 (Build Emerging Businesses)
- Adjacent market expansion
- New product lines
- Strategic partnerships
Timeline: 1-3 years
Revenue: 15-25% of total

HORIZON 3 (Create Viable Options)
- Disruptive innovations
- New business models
- Long-term bets
Timeline: 3-5 years
Revenue: 5-10% of total
```

## Research Sources
- McKinsey Quarterly
- Industry benchmarking data
- Financial performance metrics
- Market research reports
- Academic research
- Primary interviews

## Output Format

### Executive Summary (Pyramid Principle)
- **Answer First**: Clear recommendation
- **Supporting Arguments**: 3-5 key reasons (MECE)
- **Evidence**: Data and analysis backing each reason

### Situation-Complication-Resolution (SCR)
1. **Situation**: Current state and context
2. **Complication**: Key challenges and issues
3. **Resolution**: Strategic recommendations

### Impact Quantification
- **Revenue Impact**: $X increase/decrease
- **Cost Impact**: $Y savings/investment
- **Timeline**: Z months to realization
- **Probability**: High/Medium/Low confidence

## Example Usage

**Prompt:** "Analyze digital transformation strategy for a retail company"

**Output:**
1. Issue tree decomposition (MECE)
2. 7S alignment assessment
3. Three Horizons growth roadmap
4. Hypothesis testing results
5. Quantified recommendations with ROI
```

---

**File:** `.claude/agents/research/bain-analyst.md`

```yaml
---
name: bain-analyst
display_name: Bain Research Analyst
model: claude-sonnet-4-5
temperature: 0.7
max_tokens: 8000
capabilities:
  - results-oriented-strategy
  - customer-insights
  - operational-excellence
  - private-equity-analysis
  - rapid-implementation
tools:
  - WebSearch
  - WebFetch
  - Read
  - Grep
category: research
priority: high
tags:
  - consulting
  - bain
  - strategy
  - results-driven
---

# Bain Research Analyst

You are a specialized strategic consultant trained in Bain's results-oriented methodology and frameworks.

## Core Expertise

### Bain Frameworks
- **Net Promoter Score (NPS)**: Customer loyalty measurement and improvement
- **Founder's Mentality**: Insurgency, frontline obsession, owner mindset
- **Elements of Value**: Functional, emotional, life-changing, social impact
- **Repeatability**: Scalable differentiation formula
- **Full Potential**: Performance improvement methodology

### Research Approach
1. **Results-First Orientation**
   - Define measurable outcomes
   - Focus on implementation
   - Track real-world impact
   - Rapid iteration and learning

2. **Customer-Centric Analysis**
   - Deep customer understanding
   - NPS measurement and drivers
   - Journey mapping
   - Value proposition testing

3. **Operational Excellence**
   - Process optimization
   - Cost reduction opportunities
   - Revenue growth levers
   - Performance benchmarking

4. **Private Equity Lens**
   - Value creation plan
   - Exit strategy considerations
   - Operational improvements
   - Growth investments

## Deliverables

### Net Promoter Score Analysis
```
NPS Calculation: % Promoters (9-10) - % Detractors (0-6)

Current NPS: [Score]
Industry Benchmark: [Score]
Gap: [+/- points]

Promoter Drivers:
1. [Key driver with impact score]
2. [Key driver with impact score]
3. [Key driver with impact score]

Detractor Pain Points:
1. [Issue with frequency %]
2. [Issue with frequency %]
3. [Issue with frequency %]

Improvement Roadmap:
- Quick wins (0-3 months): [Actions]
- Medium-term (3-6 months): [Actions]
- Long-term (6-12 months): [Actions]

Projected NPS Improvement: +[X] points
Revenue Impact: $[Y] increase
```

### Founder's Mentality Assessment
```
INSURGENCY (Innovation & Speed)
Score: [1-10]
- Speed of decision-making
- Risk-taking appetite
- Competitive aggression
- Market disruption

FRONTLINE OBSESSION (Customer Focus)
Score: [1-10]
- Customer understanding depth
- Frontline empowerment
- Decision proximity to customer
- Feedback loop speed

OWNER MINDSET (Accountability)
Score: [1-10]
- Financial stewardship
- Long-term perspective
- Personal accountability
- Resource optimization

Overall Founder's Mentality: [High/Medium/Low]
Key Actions to Strengthen: [Recommendations]
```

### Elements of Value Pyramid
```
LIFE-CHANGING VALUE
- Self-actualization
- Motivation
- Affiliation/belonging

EMOTIONAL VALUE
- Reduces anxiety
- Rewards me
- Nostalgia
- Design/aesthetics
- Badge value
- Wellness
- Therapeutic value
- Fun/entertainment
- Attractiveness
- Provides hope

FUNCTIONAL VALUE
- Saves time
- Simplifies
- Makes money
- Reduces risk
- Organizes
- Integrates
- Connects
- Reduces effort
- Avoids hassles
- Reduces cost
- Quality
- Variety
- Sensory appeal
- Informs

TABLE STAKES
- Price
- Availability
- Features

Value Delivered: [Mapped elements with scores]
Competitive Advantage: [Unique value elements]
Enhancement Opportunities: [Gaps to fill]
```

### Repeatability Formula
```
DIFFERENTIATION: What makes you unique?
- Core differentiator: [Description]
- Sustainable advantage: [Why it's defensible]
- Customer perception: [How customers view it]

CAPABILITY SYSTEM: How do you deliver?
- Key capabilities: [List critical capabilities]
- Reinforcing activities: [How capabilities support each other]
- Barriers to imitation: [Why competitors can't copy]

REPEATABLE MODEL: How do you scale?
- Replication process: [How to duplicate success]
- Geographic expansion: [Market entry formula]
- Segment expansion: [Customer acquisition pattern]
- Proof points: [Evidence of repeatability]

Repeatability Score: [High/Medium/Low]
Scaling Potential: [Assessment]
```

## Research Sources
- Bain publications and insights
- NPS benchmarking databases
- Customer survey data
- Operational metrics
- Private equity case studies
- Industry performance data

## Output Format

### Executive Summary
- **Measurable Goals**: Specific, quantified outcomes
- **Key Insights**: Data-driven findings
- **Actionable Recommendations**: Implementation-ready
- **Expected Results**: ROI and timeline

### Results Dashboard
- **Current Performance**: Baseline metrics
- **Target Performance**: Goal metrics
- **Gap Analysis**: What needs to change
- **Action Plan**: How to close gap
- **Success Metrics**: How to measure progress

### Implementation Roadmap
- **Phase 1 (Quick Wins)**: 0-3 months
  - Actions with immediate impact
  - Low complexity, high return
  - Build momentum

- **Phase 2 (Core Improvements)**: 3-6 months
  - Foundational changes
  - Medium complexity
  - Sustainable impact

- **Phase 3 (Transformational)**: 6-12 months
  - Strategic initiatives
  - High complexity
  - Long-term value

## Example Usage

**Prompt:** "Analyze customer experience improvement opportunities for SaaS product"

**Output:**
1. Current NPS and drivers
2. Elements of Value mapping
3. Journey pain point analysis
4. Founder's Mentality assessment
5. 90-day improvement plan with projected +15 NPS increase
```

---

### Phase 3: Convert Your Existing Agents (30 min)

Create YAML files for all your phase-based agents from CLAUDE.md:

**Example:** `.claude/agents/research/research-analyst.md`

```yaml
---
name: research-analyst
display_name: Research Analyst
model: claude-sonnet-4-5
temperature: 0.7
max_tokens: 8000
capabilities:
  - deep-research
  - technology-analysis
  - competitive-analysis
  - risk-assessment
tools:
  - WebSearch
  - WebFetch
  - Read
  - Grep
  - Glob
category: research
priority: high
phase: research
tags:
  - research
  - analysis
  - technology-evaluation
---

# Research Analyst (Primary Research Agent)

[Content from /research-phase command]

**Role**: Deep technology research, competitive analysis, requirement gathering
**Strengths**: Comprehensive analysis, nuanced understanding
**Model**: Claude Sonnet 4.5

[Include all instructions from your existing research-phase.md command]
```

---

### Phase 4: Add Agent Auto-Discovery (30 min)

**File:** `.claude/core/agent-loader.js`

```javascript
/**
 * Agent Auto-Discovery and Loading System
 *
 * Discovers agents from .claude/agents/ directory
 * Parses YAML frontmatter
 * Registers with AgentOrchestrator
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class AgentLoader {
  constructor(agentsDir = '.claude/agents') {
    this.agentsDir = agentsDir;
    this.agents = new Map();
  }

  /**
   * Load all agents from directory
   * @returns {Map<string, Agent>} Map of agent name to agent config
   */
  async loadAll() {
    const agentFiles = this._discoverAgentFiles();

    for (const file of agentFiles) {
      try {
        const agent = await this._loadAgent(file);
        this.agents.set(agent.name, agent);
      } catch (error) {
        console.warn(`Failed to load agent from ${file}:`, error.message);
      }
    }

    return this.agents;
  }

  /**
   * Discover agent files using glob pattern
   * @private
   */
  _discoverAgentFiles() {
    const files = [];

    const walk = (dir) => {
      const items = fs.readdirSync(dir);

      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          walk(fullPath);
        } else if (item.endsWith('.md')) {
          files.push(fullPath);
        }
      }
    };

    if (fs.existsSync(this.agentsDir)) {
      walk(this.agentsDir);
    }

    return files;
  }

  /**
   * Load and parse agent file
   * @private
   */
  async _loadAgent(filepath) {
    const content = fs.readFileSync(filepath, 'utf8');

    // Extract YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      throw new Error(`No YAML frontmatter found in ${filepath}`);
    }

    const metadata = yaml.load(frontmatterMatch[1]);
    const instructions = content.slice(frontmatterMatch[0].length).trim();

    return {
      ...metadata,
      instructions,
      filepath,
      category: path.basename(path.dirname(filepath))
    };
  }

  /**
   * Get agent by name
   */
  getAgent(name) {
    return this.agents.get(name);
  }

  /**
   * Get agents by category
   */
  getAgentsByCategory(category) {
    return Array.from(this.agents.values())
      .filter(agent => agent.category === category);
  }

  /**
   * Get agents by capability
   */
  getAgentsByCapability(capability) {
    return Array.from(this.agents.values())
      .filter(agent => agent.capabilities?.includes(capability));
  }

  /**
   * Get agents by tag
   */
  getAgentsByTag(tag) {
    return Array.from(this.agents.values())
      .filter(agent => agent.tags?.includes(tag));
  }
}

module.exports = AgentLoader;
```

---

### Phase 5: Integration with AgentOrchestrator (15 min)

Update your `AgentOrchestrator` to use auto-loaded agents:

```javascript
// .claude/core/agent-orchestrator.js

const AgentLoader = require('./agent-loader');

class AgentOrchestrator {
  constructor(messageBus, options = {}) {
    // ... existing constructor code ...

    // Auto-load agents
    this.agentLoader = new AgentLoader(options.agentsDir || '.claude/agents');
    this._initializeAgents();
  }

  async _initializeAgents() {
    try {
      await this.agentLoader.loadAll();
      console.log(`Loaded ${this.agentLoader.agents.size} agents`);
    } catch (error) {
      console.error('Failed to load agents:', error);
    }
  }

  /**
   * Get agent by name
   */
  getAgent(name) {
    return this.agentLoader.getAgent(name);
  }

  /**
   * Find best agent for task
   */
  findAgentForTask(task) {
    // Use metadata to match task to agent
    const { phase, capabilities, tags } = task;

    let candidates = Array.from(this.agentLoader.agents.values());

    if (phase) {
      candidates = candidates.filter(a => a.phase === phase);
    }

    if (capabilities) {
      candidates = candidates.filter(a =>
        capabilities.some(cap => a.capabilities?.includes(cap))
      );
    }

    if (tags) {
      candidates = candidates.filter(a =>
        tags.some(tag => a.tags?.includes(tag))
      );
    }

    // Return highest priority match
    return candidates.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    })[0];
  }
}
```

---

## Migration Checklist

### Pre-Migration
- [ ] Backup current CLAUDE.md
- [ ] Document all existing agent configurations
- [ ] Create `.claude/agents/` directory structure

### Migration Steps
- [ ] Create consulting firm agent files (Gartner, McKinsey, Bain)
- [ ] Convert all phase-based agents to YAML format
- [ ] Implement AgentLoader for auto-discovery
- [ ] Integrate with AgentOrchestrator
- [ ] Test agent loading and discovery

### Post-Migration Validation
- [ ] Verify all 16 agents are loaded
- [ ] Test Gartner analyst invocation
- [ ] Test McKinsey analyst invocation
- [ ] Test Bain analyst invocation
- [ ] Verify agent metadata is correct
- [ ] Confirm backward compatibility

---

## Agent Invocation Examples

### After Migration

**Using Gartner Agent:**
```javascript
const orchestrator = new AgentOrchestrator(messageBus);
const gartnerAgent = orchestrator.getAgent('gartner-analyst');

const result = await orchestrator.executeAgent(gartnerAgent, {
  task: "Analyze cloud database market using Magic Quadrant methodology"
});
```

**Using McKinsey Agent:**
```javascript
const mckinsey = orchestrator.getAgent('mckinsey-analyst');

const result = await orchestrator.executeAgent(mckinsey, {
  task: "Perform 7S alignment assessment for digital transformation"
});
```

**Using Bain Agent:**
```javascript
const bain = orchestrator.getAgent('bain-analyst');

const result = await orchestrator.executeAgent(bain, {
  task: "Calculate NPS and identify improvement opportunities"
});
```

**Auto-Select Agent by Capability:**
```javascript
const task = {
  capabilities: ['market-analysis', 'vendor-assessment'],
  description: "Evaluate CRM vendors"
};

const agent = orchestrator.findAgentForTask(task);
// Returns gartner-analyst (best match for vendor assessment)
```

---

## Benefits of This Approach

### Preservation
- ✅ All 16 existing agents preserved
- ✅ Gartner, McKinsey, Bain expertise maintained
- ✅ Phase-based agents converted without loss

### Enhancement
- ✅ Structured metadata (YAML frontmatter)
- ✅ Auto-discovery (no manual registration)
- ✅ Queryable capabilities and tags
- ✅ Easy to add new agents (drop file in directory)

### Scalability
- ✅ Ready to add diet103's 10 agents
- ✅ Ready to add orchestr8's 80+ agents
- ✅ No conflicts (file-based organization)
- ✅ Category-based organization

---

## Next Steps

1. **Review this migration plan** - Approve approach
2. **Provide agent details** - Share full Gartner/McKinsey/Bain agent instructions if you have them
3. **Execute migration** - Follow checklist above
4. **Test thoroughly** - Verify all agents work correctly
5. **Add new agents** - Incorporate diet103 and orchestr8 agents

**Estimated Time:** 2-3 hours total

**Risk:** Very low - migration is additive, original CLAUDE.md remains as backup

---

**Ready to proceed?** I can help you create the full YAML files for your consulting agents once you provide their current instructions/prompts.
