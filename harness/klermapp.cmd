@echo off
node "%~dp0packages\desktop\scripts\launch-desktop.mjs" %*
exit /b %errorlevel%
