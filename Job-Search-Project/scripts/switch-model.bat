@echo off
REM switch-model.bat - Windows model switching
set PHASE=%1

if "%PHASE%"=="research" (
    set CLAUDE_MODEL=claude-opus-4
    echo Switched to Claude Opus for research phase
    goto run_claude
)
if "%PHASE%"=="planning" (
    set CLAUDE_MODEL=claude-opus-4
    echo Switched to Claude Opus for planning phase
    goto run_claude
)
if "%PHASE%"=="design" (
    set CLAUDE_MODEL=claude-opus-4
    echo Switched to Claude Opus for design phase  
    goto run_claude
)
if "%PHASE%"=="validation" (
    set CLAUDE_MODEL=claude-opus-4
    echo Switched to Claude Opus for validation phase
    goto run_claude
)
if "%PHASE%"=="iteration" (
    set CLAUDE_MODEL=claude-opus-4
    echo Switched to Claude Opus for iteration phase
    goto run_claude
)
if "%PHASE%"=="testing" (
    set CLAUDE_MODEL=claude-sonnet-4-20250514
    echo Switched to Claude Sonnet for testing phase
    goto run_claude
)
if "%PHASE%"=="implementation" (
    set CLAUDE_MODEL=claude-sonnet-4-20250514
    echo Switched to Claude Sonnet for implementation phase
    goto run_claude
)
if "%PHASE%"=="debug" (
    set CLAUDE_MODEL=claude-sonnet-4-20250514
    echo Switched to Claude Sonnet for debug phase
    goto run_claude
)

echo Usage: switch-model.bat {research^|planning^|design^|testing^|implementation^|debug^|validation^|iteration}
exit /b 1

:run_claude
claude --model %CLAUDE_MODEL%