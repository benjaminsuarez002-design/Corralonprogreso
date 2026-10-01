@echo off
setlocal
title Reiniciar cola de impresion - PC5-CAJA
set "CORRALON_PRINT_RESET=%~f0"

rem Solicitar permisos de administrador sin guardar usuarios ni contrasenas.
fltmc >nul 2>&1
if errorlevel 1 (
    powershell.exe -NoProfile -Command "try { Start-Process -FilePath $env:ComSpec -ArgumentList ('/d /c '+[char]34+[char]34+$env:CORRALON_PRINT_RESET+[char]34+[char]34) -Verb RunAs -ErrorAction Stop } catch { Write-Host 'No se aceptaron los permisos de administrador.'; exit 1 }"
    if errorlevel 1 pause
    exit /b
)

echo Reiniciando el servicio de impresion de PC5-CAJA...
echo Los tickets pendientes se conservan.
echo.

powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; $target=if($env:COMPUTERNAME -ieq 'PC5-CAJA'){'.'}else{'PC5-CAJA'}; $service=New-Object System.ServiceProcess.ServiceController('Spooler',$target); try { $service.Refresh(); if($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Stopped){ $service.Stop(); $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped,[TimeSpan]::FromSeconds(20)) }; $service.Start(); $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running,[TimeSpan]::FromSeconds(20)); Write-Host 'Listo: servicio de impresion funcionando en PC5-CAJA.' -ForegroundColor Green; Write-Host 'Revisa que los tickets salgan en papel.' } catch { Write-Host ('No se pudo completar el reinicio: '+$_.Exception.Message) -ForegroundColor Red; Write-Host 'Si lo ejecutaste desde otra PC, probalo directamente en PC5-CAJA como administrador.'; exit 1 } finally { $service.Dispose() }"

echo.
pause
endlocal
