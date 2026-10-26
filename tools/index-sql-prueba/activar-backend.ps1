$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'secretos.ps1')
$secrets=Get-IndexTestSecrets
Push-Location $PSScriptRoot
try {
    foreach($name in @('PUBLISH_TOKEN','CATALOG_COST_KEY')){
        $secrets.$name | & npx.cmd --yes wrangler@4.125.0 secret put $name --config wrangler.jsonc
        if($LASTEXITCODE -ne 0){throw 'No se pudieron configurar los secretos de la copia.'}
    }
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'backend-ready.private.txt'),'ready')
} finally{Pop-Location}
