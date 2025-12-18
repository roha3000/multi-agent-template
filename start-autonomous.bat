@echo off
REM ============================================================================
REM Autonomous Multi-Agent Loop Launcher
REM ============================================================================
REM
REM Starts the complete autonomous execution system:
REM 1. Dashboard for monitoring
REM 2. Autonomous orchestrator with quality gates
REM
REM Usage:
REM   start-autonomous.bat                     # Start with default task
REM   start-autonomous.bat "Your task here"   # Start with custom task
REM   start-autonomous.bat --phase research   # Start at specific phase
REM
REM ============================================================================

setlocal enabledelayedexpansion

REM Get the directory of this script
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

REM Parse arguments
set "TASK="
set "PHASE=research"
set "THRESHOLD=65"
set "MAX_SESSIONS=0"

:parse_args
if "%~1"=="" goto :done_args
if "%~1"=="--phase" (
    set "PHASE=%~2"
    shift
    shift
    goto :parse_args
)
if "%~1"=="--threshold" (
    set "THRESHOLD=%~2"
    shift
    shift
    goto :parse_args
)
if "%~1"=="--max-sessions" (
    set "MAX_SESSIONS=%~2"
    shift
    shift
    goto :parse_args
)
if "%~1"=="--help" goto :show_help
REM Assume it's the task description
set "TASK=%~1"
shift
goto :parse_args

:done_args

echo.
echo ============================================================================
echo  AUTONOMOUS MULTI-AGENT EXECUTION SYSTEM
echo ============================================================================
echo.
echo  Starting autonomous execution with:
echo    Phase: %PHASE%
echo    Threshold: %THRESHOLD%%
echo    Max Sessions: %MAX_SESSIONS% (0 = unlimited)
if defined TASK echo    Task: %TASK%
echo.
echo ============================================================================
echo.

REM Check if dashboard is already running
netstat -an | findstr ":3033" > nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Dashboard already running on port 3033
) else (
    echo [STARTING] Dashboard on port 3033...
    start "Context Dashboard" cmd /c "node global-context-manager.js"
    timeout /t 2 /nobreak > nul
)

REM Open dashboard in browser
echo [OPENING] Dashboard in browser...
start http://localhost:3033/global-dashboard.html

REM Wait for dashboard to be ready
echo [WAITING] For dashboard to initialize...
timeout /t 3 /nobreak > nul

REM Build the orchestrator command
set "CMD=node autonomous-orchestrator.js"
set "CMD=%CMD% --phase %PHASE%"
set "CMD=%CMD% --threshold %THRESHOLD%"
if not "%MAX_SESSIONS%"=="0" set "CMD=%CMD% --max-sessions %MAX_SESSIONS%"
if defined TASK set "CMD=%CMD% --task "%TASK%""

echo.
echo [LAUNCHING] Autonomous orchestrator...
echo Command: %CMD%
echo.
echo ============================================================================
echo  Claude will now run autonomously with quality gates.
echo  Press Ctrl+C to stop the orchestrator.
echo ============================================================================
echo.

REM Run the orchestrator (this takes over the terminal)
%CMD%

goto :eof

:show_help
echo.
echo Autonomous Multi-Agent Loop Launcher
echo.
echo Usage:
echo   start-autonomous.bat [options] [task]
echo.
echo Options:
echo   --phase ^<phase^>        Starting phase (research, design, implement, test)
echo   --threshold ^<percent^>  Context threshold for session cycling (default: 65)
echo   --max-sessions ^<n^>     Maximum sessions to run (default: unlimited)
echo   --help                 Show this help
echo.
echo Examples:
echo   start-autonomous.bat "Build a REST API for user management"
echo   start-autonomous.bat --phase design "Implement authentication"
echo   start-autonomous.bat --threshold 60 --max-sessions 10
echo.
goto :eof
