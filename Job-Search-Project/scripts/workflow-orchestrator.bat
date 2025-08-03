@echo off
REM workflow-orchestrator.bat - Windows workflow automation
set PROJECT_NAME=%1
set PROJECT_DESC=%2

if "%PROJECT_NAME%"=="" (
    echo Usage: workflow-orchestrator.bat "project-name" "project description"
    exit /b 1
)
if "%PROJECT_DESC%"=="" (
    echo Usage: workflow-orchestrator.bat "project-name" "project description"
    exit /b 1
)

echo Starting Multi-Agent Workflow for: %PROJECT_NAME%
echo Description: %PROJECT_DESC%
echo ==============================================

echo.
echo Phase 1: Research ^& Discovery
call scripts\switch-model.bat research
echo Execute in Claude: /research-phase "%PROJECT_DESC%"
pause

echo.
echo Phase 2: Strategic Planning
call scripts\switch-model.bat planning
echo Execute in Claude: /planning-phase "%PROJECT_DESC%"
pause

echo.
echo Phase 3: Architecture ^& Design
call scripts\switch-model.bat design
echo Execute in Claude: /design-phase "%PROJECT_DESC%"
pause

echo.
echo Phase 4: Test-First Development
call scripts\switch-model.bat testing
echo Execute in Claude: /test-first-phase "%PROJECT_DESC%"
pause

echo.
echo Phase 5: Implementation
call scripts\switch-model.bat implementation
echo Execute in Claude: /implement-phase "%PROJECT_DESC%"
pause

echo.
echo Phase 6: Cross-Agent Validation
call scripts\switch-model.bat validation
echo Execute in Claude: /validate-phase "%PROJECT_DESC%"
pause

echo.
echo Phase 7: Strategic Iteration (optional)
echo Execute in Claude: /iterate-phase "feedback and improvement areas"
pause

echo ==============================================
echo Multi-Agent Workflow Complete for: %PROJECT_NAME%
echo Check quality gates and documentation