@echo off
title Termina Save Editor
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Download the LTS version from https://nodejs.org, install it, then run this again. & pause & exit /b 1)
node editor.js %*
pause
