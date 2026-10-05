@echo off
setlocal
title Iniciar sistema - Corralon Progreso
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar-facturacion-copia.ps1" -SinAbrir
if errorlevel 1 (
  echo.
  echo No se pudo iniciar el sistema. Revisa el mensaje anterior.
  pause
  exit /b 1
)
start "" "http://localhost:8080/menu.html"
