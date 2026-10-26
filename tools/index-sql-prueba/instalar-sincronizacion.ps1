$ErrorActionPreference='Stop'
$name='Corralon - Index SQL prueba'
$runtime=(Get-Command pwsh -ErrorAction SilentlyContinue).Source
if(!$runtime){$runtime=Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'}
$script=Join-Path $PSScriptRoot 'sincronizar.ps1'
$launcher=Join-Path $PSScriptRoot 'sincronizar-oculto.vbs'
$hostPath=Join-Path $env:WINDIR 'System32/wscript.exe'
$action=New-ScheduledTaskAction -Execute $hostPath -Argument ('//B //Nologo "'+$launcher+'" "'+$runtime+'" "'+$script+'"') -WorkingDirectory $PSScriptRoot
$repeat=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes 2)
$login=New-ScheduledTaskTrigger -AtLogOn -User ([Security.Principal.WindowsIdentity]::GetCurrent().Name)
$principal=New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $name -Action $action -Trigger @($repeat,$login) -Settings $settings -Principal $principal -Description 'Prueba aislada: copia el catalogo SQL y publica solo si cambio. No modifica Index oficial ni Supabase.' -Force | Select-Object TaskName,State
