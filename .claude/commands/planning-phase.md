# Planning Phase - Strategic Planning with Logic Validation

Create detailed project plan with multi-agent validation and reasoning.

## Usage
`/planning-phase "project description and constraints"`

## Process
Use Claude Opus for strategic planning, validated by o1-preview reasoning simulation.

STRATEGIC PLANNER (Claude Opus 4): Create comprehensive project plan for {project_description}:

### Project Planning Components:

1. **Project Scope & Objectives**
   - Clear problem statement
   - Success criteria and KPIs
   - Scope boundaries and exclusions
   - Stakeholder identification

2. **Timeline & Milestones**
   - Detailed work breakdown structure
   - Critical path identification
   - Milestone definitions with deliverables
   - Buffer time for risk mitigation

3. **Resource Allocation**
   - Team composition and roles
   - Skill requirements and gaps
   - Infrastructure and tooling needs
   - Budget allocation by category

4. **Risk Management**
   - Risk identification and classification
   - Impact and probability assessment
   - Mitigation and contingency strategies
   - Risk monitoring plan

5. **Dependencies & Constraints**
   - Internal and external dependencies
   - Technical constraints and limitations
   - Business and regulatory constraints
   - Resource and timeline constraints

Now for validation:

LOGIC REVIEWER (o1-preview simulation): Review the project plan for:

### Validation Criteria:
- **Logical Consistency**: Do timeline estimates align with resource allocation?
- **Dependency Analysis**: Are all dependencies identified and properly sequenced?
- **Risk Assessment**: Are risks realistic and mitigation strategies viable?
- **Resource Optimization**: Is resource allocation efficient and realistic?
- **Feasibility Check**: Are objectives achievable within constraints?
- **Edge Case Analysis**: What could go wrong that wasn't considered?

### Expected Deliverables:
- Validated project roadmap with timeline
- Resource allocation matrix
- Risk register with mitigation plans
- Dependency mapping diagram
- Success criteria and measurement plan
- Contingency planning documentation

### Quality Standards:
- Timeline is achievable and realistic
- All major dependencies identified
- Risk mitigation strategies are viable
- Resource allocation is optimized
- Logic validation passes all checks

Minimum Quality Score Required: 85/100

Provide integrated planning document with validation notes and any recommended adjustments.