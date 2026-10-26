$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
$scriptPath=Join-Path $projectRoot 'subir_archivos_github.ps1'
$parseErrors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($scriptPath,[ref]$null,[ref]$parseErrors)
if($parseErrors.Count){throw 'Sintaxis incorrecta del importador'}
foreach($name in @('Get-Sha256Hash','Get-ModifiedUploadPaths','ConvertTo-PageKey','Get-NextPageVersion','Update-PageVersions','Publish-WebVersionRealtime')){
 $function=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true)
 Invoke-Expression $function.Extent.Text
}
function Run-Git { param($WorkingDirectory,$Arguments) [pscustomobject]@{Output="pedidos.html`nigual.css`nborrado.js`nassets/nuevo.svg"} }
$fixture=Join-Path $projectRoot ('tmp/version-test-'+[guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory((Join-Path $fixture 'assets'))
[IO.File]::WriteAllText((Join-Path $fixture 'pedidos.html'),'<script src="corralon-system.js?v=1.0.47"></script>')
[IO.File]::WriteAllText((Join-Path $fixture 'igual.css'),'igual')
[IO.File]::WriteAllText((Join-Path $fixture 'assets/nuevo.svg'),'<svg/>')
[IO.File]::WriteAllText((Join-Path $fixture 'secret.private.json'),'no publicar')
$baseline=[pscustomobject]@{files=@([pscustomobject]@{path='pedidos.html';hash='contenido-anterior'},[pscustomobject]@{path='igual.css';hash=(Get-Sha256Hash (Join-Path $fixture 'igual.css'))},[pscustomobject]@{path='borrado.js';hash='anterior'})}
(Get-Item (Join-Path $fixture 'pedidos.html')).LastWriteTime=[datetime]'2000-01-01'
$changed=@(Get-ModifiedUploadPaths -Root $fixture -Baseline $baseline)
if($changed.Count -ne 3 -or $changed -notcontains 'pedidos.html' -or $changed -notcontains 'borrado.js' -or $changed -notcontains 'assets/nuevo.svg'){throw "Seleccion incorrecta: $changed"}
$repoRoot=$fixture
[IO.File]::WriteAllText((Join-Path $fixture 'version-web.json'),' {"paginas":{"pedidos":{"nombre":"Pedidos","version":"1.0.47","ultimo_cambio":"","actualizado":"","prioridad":"normal"}},"historial":[]}')
[IO.File]::WriteAllText((Join-Path $fixture 'tarjetas.html'),'<script src="corralon-system.js"></script>')
Update-PageVersions -HtmlFiles @((Join-Path $fixture 'pedidos.html'),(Join-Path $fixture 'tarjetas.html')) -Change 'Prueba' -Priority 'importante'
$updated=Get-Content (Join-Path $fixture 'version-web.json') -Raw | ConvertFrom-Json
if($updated.paginas.pedidos.version -ne '1.0.48' -or $updated.paginas.tarjetas.version -ne '0.0.1'){throw 'Version incorrecta'}
if([IO.File]::ReadAllText((Join-Path $fixture 'tarjetas.html')) -notmatch 'corralon-system.js\?v=0.0.1'){throw 'Falta version en script nuevo'}
if([IO.File]::ReadAllText((Join-Path $fixture 'pedidos.html')) -notmatch 'corralon-system.js\?v=1.0.48'){throw 'Version de HTML desactualizada'}
function Invoke-RestMethod { param($Uri,$Method,$ContentType,$Body,$TimeoutSec) $script:capturedPayload=$Body | ConvertFrom-Json; $script:capturedUrl=$Uri }
[void](Publish-WebVersionRealtime -ManifestPath (Join-Path $fixture 'version-web.json'))
if($capturedPayload.fields.paginas.mapValue.fields.pedidos.mapValue.fields.version.stringValue -ne '1.0.48'){throw 'Aviso Firebase sin version de Pedidos'}
if($capturedUrl -notmatch 'updateMask.fieldPaths=paginas'){throw 'No conserva el mapa de versiones'}
Write-Output 'PASS contenido con fecha antigua, subcarpetas, eliminaciones, exclusiones y versionado de paginas.'
