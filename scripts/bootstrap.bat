@echo off
REM Windows wrapper for bootstrap.sh
REM Requires Git for Windows (https://git-scm.com/download/win)
REM
cd /d "%~dp0"
where bash >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] bash not found in PATH.
    echo Please install Git for Windows and make sure bash is available.
    echo Download: https://git-scm.com/download/win
    exit /b 1
)
bash "%~dp0bootstrap.sh"
if %ERRORLEVEL% NEQ 0 exit /b %ERRORLEVEL%
