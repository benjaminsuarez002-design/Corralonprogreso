param([switch]$SoloPreparar)
$ErrorActionPreference='Stop'
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
function Invoke-PublisherProcess($fileName,$arguments,$failureMessage) {
    $info=[Diagnostics.ProcessStartInfo]::new()
    $info.FileName=$fileName
    $info.Arguments=$arguments
    $info.WorkingDirectory=$PSScriptRoot
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true
    $info.RedirectStandardError=$true
    $process=[Diagnostics.Process]::new()
    $process.StartInfo=$info
    try {
        [void]$process.Start()
        $stdout=$process.StandardOutput.ReadToEndAsync()
        $stderr=$process.StandardError.ReadToEndAsync()
        $process.WaitForExit()
        $output=$stdout.GetAwaiter().GetResult()
        $errors=$stderr.GetAwaiter().GetResult()
        if($output){Write-Output $output.TrimEnd()}
        if($errors){Write-Output $errors.TrimEnd()}
        if($process.ExitCode -ne 0){throw $failureMessage}
    } finally {$process.Dispose()}
}
$mutex=[Threading.Mutex]::new($false,'Local\CorralonIndexSqlPruebaPublisher')
if(!$mutex.WaitOne(0)){$mutex.Dispose();return}
try {
    & (Join-Path $PSScriptRoot 'exportar.ps1')
    $manifest=Get-Content -LiteralPath (Join-Path $root 'catalogo-sql-prueba/manifest.json') -Raw | ConvertFrom-Json
    $stage=Join-Path $PSScriptRoot 'public'
    $data=Join-Path $stage 'catalogo-sql-prueba'
    [IO.Directory]::CreateDirectory($data)|Out-Null
    $files=@('index-sql-prueba.js','index-sql-api.js','index-cloudflare.js','corralon-system.js','corralon-cache-db.js','funciones.js','nav-helper.js','presupuesto-shared.js','theme-corralon.css','index-mobile.css','recargar-deslizando.js','favicon.png','apple-touch-icon.png','logo-corralon.png','facturacion-revisiones.js')
    foreach($name in $files){$source=Join-Path $root $name;if(Test-Path -LiteralPath $source){Copy-Item -LiteralPath $source -Destination (Join-Path $stage $name) -Force}}
    Copy-Item -LiteralPath (Join-Path $root 'index - copia.html') -Destination (Join-Path $stage 'index.html') -Force
    [IO.Directory]::CreateDirectory((Join-Path $stage 'assets/halloween'))|Out-Null
    foreach($name in @('fondo-index-halloween.png','hero-halloween.png','categorias-halloween-ceramico.png')){Copy-Item -LiteralPath (Join-Path $root ('assets/halloween/'+$name)) -Destination (Join-Path $stage ('assets/halloween/'+$name)) -Force}
    $wanted=@('manifest.json')+@($manifest.files | ForEach-Object {$_.file})+@($manifest.costs.file,$manifest.config.file)
    # Solo elimina fragmentos generados anteriores dentro de la carpeta de prueba verificada.
    $resolvedData=[IO.Path]::GetFullPath($data)
    if(!$resolvedData.StartsWith([IO.Path]::GetFullPath($PSScriptRoot)+[IO.Path]::DirectorySeparatorChar)){throw 'Destino de prueba invalido.'}
    Get-ChildItem -LiteralPath $data -File | Where-Object {$_.Name -match '^[a-f0-9]{1,2}-[a-f0-9]{64}\.json$' -and $_.Name -notin $wanted} | ForEach-Object {Remove-Item -LiteralPath $_.FullName}
    foreach($name in $wanted){Copy-Item -LiteralPath (Join-Path $root ('catalogo-sql-prueba/'+$name)) -Destination (Join-Path $data $name) -Force}
    $encoding=[Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText((Join-Path $stage '_headers'),"/catalogo-sql-prueba/manifest.json`n  Cache-Control: no-cache`n/catalogo-sql-prueba/*`n  Access-Control-Allow-Origin: *`n",$encoding)
    $hash=(@(Get-ChildItem -LiteralPath $stage -File | Sort-Object Name | ForEach-Object {(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}) -join '')+$manifest.version
    $statePath=Join-Path $PSScriptRoot 'publicado.txt'
    if($SoloPreparar){Write-Output 'Prueba preparada localmente.';return}
    if((Test-Path -LiteralPath $statePath) -and [IO.File]::ReadAllText($statePath) -eq $hash){Write-Output 'Sin cambios: no se vuelve a publicar.';return}
    Push-Location $PSScriptRoot
    try { Invoke-PublisherProcess $env:ComSpec ('/d /s /c ""'+(Get-Command npx.cmd -CommandType Application).Source+'" --yes wrangler@4.125.0 deploy --config wrangler.jsonc"') 'Fallo la publicacion de prueba. La version anterior sigue disponible.' }
    finally{Pop-Location}
    [IO.File]::WriteAllText($statePath,$hash,$encoding)
} finally {$mutex.ReleaseMutex();$mutex.Dispose()}
