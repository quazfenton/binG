@echo off
REM binG CLI Launcher
REM This script runs the CLI from the bundled dist folder

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0

REM Run the CLI using Node.js
node %SCRIPT_DIR%dist\bin.js %*

REM Forward exit code
exit /b %ERRORLEVEL%