#!/bin/bash
# workflow-orchestrator.sh - Complete workflow automation
# Usage: ./workflow-orchestrator.sh "project-name" "project description"

PROJECT_NAME=$1
PROJECT_DESC=$2

if [ -z "$PROJECT_NAME" ] || [ -z "$PROJECT_DESC" ]; then
    echo "Usage: $0 'project-name' 'project description'"
    exit 1
fi

echo "Starting Multi-Agent Workflow for: $PROJECT_NAME"
echo "Description: $PROJECT_DESC"
echo "=============================================="

# Phase 1: Research
echo "Phase 1: Research & Discovery"
./scripts/switch-model.sh research
echo "Execute: /research-phase '$PROJECT_DESC'"
echo "Press Enter when research phase is complete..."
read

# Phase 2: Planning  
echo "Phase 2: Strategic Planning"
./scripts/switch-model.sh planning
echo "Execute: /planning-phase '$PROJECT_DESC'"
echo "Press Enter when planning phase is complete..."
read

# Phase 3: Design
echo "Phase 3: Architecture & Design"
./scripts/switch-model.sh design
echo "Execute: /design-phase '$PROJECT_DESC'"
echo "Press Enter when design phase is complete..."
read

# Phase 4: Testing
echo "Phase 4: Test-First Development"
./scripts/switch-model.sh testing
echo "Execute: /test-first-phase '$PROJECT_DESC'"
echo "Press Enter when testing phase is complete..."
read

# Phase 5: Implementation
echo "Phase 5: Implementation"
./scripts/switch-model.sh implementation
echo "Execute: /implement-phase '$PROJECT_DESC'"
echo "Press Enter when implementation phase is complete..."
read

# Phase 6: Validation
echo "Phase 6: Cross-Agent Validation"
./scripts/switch-model.sh validation
echo "Execute: /validate-phase '$PROJECT_DESC'"
echo "Press Enter when validation phase is complete..."
read

# Phase 7: Iteration (optional)
echo "Phase 7: Strategic Iteration (optional)"
echo "Execute: /iterate-phase 'feedback and improvement areas'"
echo "Or press Enter to complete workflow..."
read

echo "=============================================="
echo "Multi-Agent Workflow Complete for: $PROJECT_NAME"
echo "Check quality gates and documentation"