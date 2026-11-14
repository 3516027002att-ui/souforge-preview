@echo off
setlocal
set "SOULFORGE_ROOT=%~dp0.."
node "%~dp0require-node.cjs" || exit /b 1
node "%~dp0sfcli.mjs" %*
exit /b %ERRORLEVEL%
