@echo off
rem The architect command, run on the app's own Node so no separate Node install is needed.
rem It sits beside Architect.exe; add this folder to PATH to type `architect` anywhere.
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0Architect.exe" "%~dp0resources\app.asar.unpacked\out\cli\architect.mjs" %*
exit /b %ERRORLEVEL%
