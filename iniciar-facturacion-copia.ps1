param([switch]$SoloCompilar,[switch]$SinAbrir)
$ErrorActionPreference = 'Stop'
$apiSource = Join-Path $PSScriptRoot 'facturacion-copia-api.cs'
$serverSource = Join-Path $PSScriptRoot 'CorralonWebServer.cs'
$runtimeDirectory = Join-Path $PSScriptRoot 'servidor'
$legacyDirectory = Join-Path $PSScriptRoot '.codex-staging'
$legacyApi = Join-Path $legacyDirectory 'FacturacionCopiaApi.exe'
$apiOutput = Join-Path $runtimeDirectory 'FacturacionCopiaApi.exe'
$serverOutput = Join-Path $PSScriptRoot 'CorralonWebServer.exe'
$apiNext = Join-Path $runtimeDirectory 'FacturacionCopiaApi.next.exe'
$serverNext = Join-Path $runtimeDirectory 'CorralonWebServer.next.exe'
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($apiOutput)) | Out-Null
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$apiChanged = -not (Test-Path -LiteralPath $apiOutput) -or (Get-Item -LiteralPath $apiSource).LastWriteTimeUtc -gt (Get-Item -LiteralPath $apiOutput -ErrorAction SilentlyContinue).LastWriteTimeUtc
$serverChanged = -not (Test-Path -LiteralPath $serverOutput) -or (Get-Item -LiteralPath $serverSource).LastWriteTimeUtc -gt (Get-Item -LiteralPath $serverOutput -ErrorAction SilentlyContinue).LastWriteTimeUtc

# Compilar antes de interrumpir el servicio: un error deja la versión actual funcionando.
if ($apiChanged -or $SoloCompilar) {
    & $compiler /nologo /target:exe "/out:$apiNext" /reference:System.Data.dll /reference:System.Drawing.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll $apiSource
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la API de facturación. La versión actual sigue activa.' }
}
if ($serverChanged -or $SoloCompilar) {
    & $compiler /nologo /target:winexe "/out:$serverNext" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Data.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll $serverSource
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el servidor web. La versión actual sigue activa.' }
}
if ($SoloCompilar) { Write-Output $apiNext; Write-Output $serverNext; return }

function Get-OwnProcess([string]$name,[string]$path) {
    $all = @(Get-CimInstance Win32_Process -Filter "Name='$name'")
    $own = @($all | Where-Object { $_.ExecutablePath -eq $path -or ($name -eq 'FacturacionCopiaApi.exe' -and $_.ExecutablePath -eq $legacyApi) })
    if ($all.Count -gt $own.Count) { throw "Hay otro proceso $name abierto desde otra carpeta. Cerralo antes de actualizar." }
    return $own
}
function Stop-OwnApi {
    $running = @(Get-OwnProcess 'FacturacionCopiaApi.exe' $apiOutput)
    if ($running.Count -eq 0) { return }
    try {
        $reply = Invoke-RestMethod -Uri 'http://localhost:8081/shutdown' -Method Post -TimeoutSec 7
        if ($reply.ok -ne $true) { throw 'La API no aceptó el apagado.' }
    } catch { throw "No se pudo detener la API sin riesgo de cortar una emisión o impresión. Reintentá cuando termine. $($_.Exception.Message)" }
    foreach ($process in $running) {
        try { Wait-Process -Id $process.ProcessId -Timeout 8 -ErrorAction Stop }
        catch { throw 'La API recibió el apagado, pero aún está abierta. Reintentá luego.' }
    }
}

$mainRunning = @(Get-OwnProcess 'CorralonWebServer.exe' $serverOutput)
$apiRunning = @(Get-OwnProcess 'FacturacionCopiaApi.exe' $apiOutput)
$migrateLegacy = @($apiRunning | Where-Object { $_.ExecutablePath -eq $legacyApi }).Count -gt 0 -or !(Test-Path -LiteralPath (Join-Path $runtimeDirectory 'facturacion-operador.json'))
if ($apiChanged -or $serverChanged) {
    if ($apiRunning.Count -gt 0) { Stop-OwnApi }
    foreach ($process in $mainRunning) {
        Stop-Process -Id $process.ProcessId -ErrorAction Stop
        Wait-Process -Id $process.ProcessId -Timeout 8 -ErrorAction SilentlyContinue
    }
    # El supervisor puede haber reabierto la API justo antes de cerrar el servidor.
    Stop-OwnApi
    # Migrar solamente datos operativos, nunca las herramientas de desarrollo.
    # No reemplazar estados distintos ni perder borradores o recuperaciones fiscales.
    if ($migrateLegacy -and (Test-Path -LiteralPath $legacyDirectory)) {
        Get-ChildItem -LiteralPath $legacyDirectory -File | Where-Object {
            $_.Name -eq 'facturacion-operador.json' -or $_.Name -like 'wsfe-*.bin' -or $_.Name -like 'venta-revision-*.bin'
        } | ForEach-Object {
            $destination = Join-Path $runtimeDirectory $_.Name
            if (!(Test-Path -LiteralPath $destination)) { Copy-Item -LiteralPath $_.FullName -Destination $destination }
            elseif ((Get-FileHash -LiteralPath $_.FullName).Hash -ne (Get-FileHash -LiteralPath $destination).Hash) {
                throw "Hay dos estados distintos de $($_.Name). Se conservaron ambos; revisar antes de iniciar."
            }
        }
    }
    if ($apiChanged) { Copy-Item -LiteralPath $apiNext -Destination $apiOutput -Force }
    if ($serverChanged) { Copy-Item -LiteralPath $serverNext -Destination $serverOutput -Force }
    $mainRunning = @()
}
if ($mainRunning.Count -eq 0) {
    # Task Scheduler crea el proceso fuera del arbol de Codex/VS Code.
    # Sin limite de duracion ni apagado al usar bateria.
    $scheduler = New-Object -ComObject 'Schedule.Service'
    $scheduler.Connect()
    $taskFolder = $scheduler.GetFolder('\')
    $definition = $scheduler.NewTask(0)
    $definition.RegistrationInfo.Description = "Servidor independiente de Corralon Progreso: $PSScriptRoot"
    $definition.Principal.UserId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $definition.Principal.LogonType = 3
    $definition.Settings.ExecutionTimeLimit = 'PT0S'
    $definition.Settings.DisallowStartIfOnBatteries = $false
    $definition.Settings.StopIfGoingOnBatteries = $false
    $definition.Settings.MultipleInstances = 2
    $action = $definition.Actions.Create(0)
    $action.Path = $serverOutput
    $action.Arguments = '--tray'
    $action.WorkingDirectory = $PSScriptRoot
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $taskSuffix = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($PSScriptRoot)))).Replace('-','').Substring(0,12) } finally { $hash.Dispose() }
    $task = $taskFolder.RegisterTaskDefinition("CorralonProgreso-Servidor-$taskSuffix",$definition,6,$definition.Principal.UserId,$null,3)
    [void]$task.Run($null)
}
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 350
    try {
        $reply = Invoke-RestMethod -Uri 'http://localhost:8080/api/facturacion/bootstrap' -TimeoutSec 3
        if ($reply.ok -eq $true) { $ready = $true; break }
    } catch { }
}
if (-not $ready) { throw 'Facturación no pudo volver a consultar SQL. Revisá CorralonWebServer.log.' }
$facturacionUrl = 'http://localhost:8080/facturacion.html'
$shortcut = Join-Path $PSScriptRoot 'Facturacion.url'
if (Test-Path -LiteralPath $shortcut) {
    $shortcutUrl = Get-Content -LiteralPath $shortcut | Where-Object { $_ -like 'URL=*' } | Select-Object -First 1
    if ($shortcutUrl) { $facturacionUrl = $shortcutUrl.Substring(4).Trim() }
}
if (-not $SinAbrir) { Start-Process -FilePath $facturacionUrl | Out-Null }
Write-Host 'Sistema iniciado y conectado con SQL, independiente de Codex.'
