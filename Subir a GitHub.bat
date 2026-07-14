@echo off
setlocal
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0subir_archivos_github.ps1"
exit /b %errorlevel%
