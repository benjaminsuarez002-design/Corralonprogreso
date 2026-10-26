$ErrorActionPreference = 'Stop'
$document = 'projects/corralon-progreso/databases/(default)/documents/configuracion/catalogo_version'
$uri = 'https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents:commit?key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0'
$payload = @{ writes = @(@{ transform = @{ document = $document; fieldTransforms = @(@{ fieldPath = 'version'; increment = @{ integerValue = '1' } }) } }) } | ConvertTo-Json -Depth 8 -Compress
$response = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec 20
Write-Output ('Aviso de catalogo publicado en Firebase: version ' + $response.writeResults[0].transformResults[0].integerValue)
