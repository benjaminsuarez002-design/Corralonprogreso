param([Parameter(Mandatory = $true)][long]$Version)

$ErrorActionPreference = 'Stop'
$document = 'projects/corralon-progreso/databases/(default)/documents/configuracion/catalogo_version'
$uri = 'https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents:commit?key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0'
$payload = @{ writes = @(@{
  update = @{ name = $document; fields = @{ ranking_version = @{ integerValue = [string]$Version } } }
  updateMask = @{ fieldPaths = @('ranking_version') }
}) } | ConvertTo-Json -Depth 8 -Compress

Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec 20 | Out-Null
Write-Output ('Aviso de ranking publicado en Firebase: version ' + $Version)
