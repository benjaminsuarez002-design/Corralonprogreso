$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'secretos.ps1')
$secrets=Get-IndexTestSecrets
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$source=[IO.File]::ReadAllText((Join-Path $root 'index - copia.html'))
$url=[regex]::Match($source,"const SUPABASE_URL = '([^']+)'").Groups[1].Value
$anon=[regex]::Match($source,"const SUPABASE_ANON_KEY = '([^']+)'").Groups[1].Value
$count=0
for($offset=0;;$offset+=200){
    $batch=Invoke-RestMethod -Uri ($url+'/rest/v1/presupuestos_web?select=numero,tipo,fecha,fecha_iso,total,cliente_nombre,telefono,medio_pago,nota,usuario_id,usuario_nombre,items&order=numero.asc&limit=200&offset='+$offset) -Headers @{apikey=$anon;Authorization=('Bearer '+$anon)} -TimeoutSec 60
    if($batch.Count){
        $body=ConvertTo-Json -InputObject @{records=@($batch)} -Depth 20 -Compress
        $reply=Invoke-RestMethod -Uri 'https://corralon-index-sql-prueba.benjaminsuarez002.workers.dev/api/index-prueba/publisher/import-budgets' -Method Post -Headers @{'x-publisher-token'=$secrets.PUBLISH_TOKEN} -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 60
        if(!$reply.ok){throw 'No se confirmo la copia del lote de presupuestos.'}
        $count+=$batch.Count
    }
    if($batch.Count -lt 200){break}
}
Write-Output ('Presupuestos copiados al historial aislado: '+$count)
