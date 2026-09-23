param([switch]$SoloCompilar)
$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'facturacion-copia-api.cs'
$output = Join-Path $PSScriptRoot '.codex-staging\FacturacionCopiaApi.exe'
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output)) | Out-Null
$url = 'http://localhost:8080/facturacion%20-%20copia.html'
$apiUrl = 'http://localhost:8081/bootstrap'
$apiDisponible = $false
$necesitaCompilar = -not (Test-Path -LiteralPath $output) -or (Get-Item -LiteralPath $source).LastWriteTimeUtc -gt (Get-Item -LiteralPath $output -ErrorAction SilentlyContinue).LastWriteTimeUtc
try {
    $respuesta = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 3
    $apiDisponible = $respuesta.ok -eq $true
} catch { }
if ($necesitaCompilar -and $apiDisponible) {
    $servicioAnterior = Get-CimInstance Win32_Process -Filter "Name='FacturacionCopiaApi.exe'" | Where-Object { $_.ExecutablePath -eq $output }
    if (-not $servicioAnterior) { throw 'El puerto 8081 está ocupado por otro proceso. Cerralo antes de actualizar la copia.' }
    $servicioAnterior | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction Stop }
    $apiDisponible = $false
    Start-Sleep -Milliseconds 350
}
if ($necesitaCompilar -or $SoloCompilar) {
    & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe "/out:$output" /reference:System.Data.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll $source
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la API de facturación.' }
}
if ($SoloCompilar) { Write-Output $output; return }
if (-not $apiDisponible) {
    Start-Process -FilePath $output -WindowStyle Hidden | Out-Null
    for ($intento = 0; $intento -lt 20; $intento++) {
        Start-Sleep -Milliseconds 250
        try {
            $respuesta = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 3
            if ($respuesta.ok -eq $true) { $apiDisponible = $true; break }
        } catch { }
    }
}
if (-not $apiDisponible) { throw 'La API local no pudo arrancar o no pudo consultar SQL. Revisá la conexión local.' }
Start-Process -FilePath $url
Write-Host 'Copia de facturación abierta. La API local quedó en segundo plano.'
