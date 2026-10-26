$ErrorActionPreference='Stop'
$log=Join-Path $PSScriptRoot 'sincronizacion.log'
try {
    & (Join-Path $PSScriptRoot 'publicar.ps1') *>> $log
    if((Get-Item -LiteralPath $log).Length -gt 2000000){$lines=Get-Content -LiteralPath $log -Tail 300;[IO.File]::WriteAllLines($log,$lines)}
} catch {
    Add-Content -LiteralPath $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm')+' ERROR: '+$_.Exception.Message)
    exit 1
}
