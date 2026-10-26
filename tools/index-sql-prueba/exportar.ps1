param([switch]$ImportarMetadatos)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
. (Join-Path $PSScriptRoot 'secretos.ps1')
$secrets=Get-IndexTestSecrets
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$out=Join-Path $root 'catalogo-sql-prueba'
[IO.Directory]::CreateDirectory($out) | Out-Null
$encoding=[Text.UTF8Encoding]::new($false)
function Write-Atomic($path,$text) {
    [IO.File]::WriteAllText($path+'.next',$text,$encoding)
    Move-Item -LiteralPath ($path+'.next') -Destination $path -Force
}
$metaPath=Join-Path $PSScriptRoot 'metadatos.json'
if($ImportarMetadatos) {
    # Migracion inicial de datos publicos. El ciclo habitual nunca consulta Supabase.
    $source=[IO.File]::ReadAllText((Join-Path $root 'index - copia.html'))
    $url=[regex]::Match($source,"const SUPABASE_URL = '([^']+)'").Groups[1].Value
    $anon=[regex]::Match($source,"const SUPABASE_ANON_KEY = '([^']+)'").Groups[1].Value
    if(!$url -or !$anon){throw 'No se encontro la configuracion publica para migrar los metadatos.'}
    $fields='codigo,detalle,tags_ocultos,foto_url,imagenes,oferta,oferta_pct,oferta_hasta,destacado,mas_vendido,acceso_rapido,ceramico,ceramico_m2,ceramico_placas,edicion_updated_at'
    $metadata=[Collections.Generic.List[object]]::new()
    for($offset=0;;$offset+=1000) {
        $batch=Invoke-RestMethod -Uri ($url+'/rest/v1/catalogo_articulos_publico?select='+$fields+'&order=codigo.asc&limit=1000&offset='+$offset) -Headers @{apikey=$anon;Authorization=('Bearer '+$anon)} -TimeoutSec 60
        foreach($item in $batch){$metadata.Add($item)}
        if($batch.Count -lt 1000){break}
    }
    if(!$metadata.Count){throw 'La migracion no devolvio metadatos; se conserva la copia anterior.'}
    if(($metadata | Group-Object codigo | Where-Object Count -gt 1)){throw 'La migracion contiene codigos duplicados; se conserva la copia anterior.'}
    Write-Atomic $metaPath (ConvertTo-Json -InputObject @($metadata.ToArray()) -Depth 12 -Compress)
    Write-Output ('Metadatos migrados: '+$metadata.Count)
}
if(!(Test-Path -LiteralPath $metaPath)){throw 'Primero ejecutar con -ImportarMetadatos para conservar fotos y etiquetas.'}
$byCode=@{}
foreach($item in (Get-Content -Raw -LiteralPath $metaPath | ConvertFrom-Json)){$byCode[[string]$item.codigo]=$item}
$remoteConfig=$null
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'backend-ready.private.txt')){
    # Si no podemos comprobar las ediciones, no publicar una lista que las borre.
    $remoteConfig=Invoke-RestMethod -Uri 'https://corralon-index-sql-prueba.benjaminsuarez002.workers.dev/api/index-prueba/publisher/export' -Headers @{'x-publisher-token'=$secrets.PUBLISH_TOKEN} -TimeoutSec 30
    foreach($item in $remoteConfig.edits){$byCode[[string]$item.codigo]=$item}
}
$key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\CorralonProgreso\LocalSql')
if(!$key){throw 'Falta configurar SQL local.'}
try{$encrypted=[string]$key.GetValue('Connection')}finally{$key.Close()}
$connectionString=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($encrypted),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
$connection=[Data.SqlClient.SqlConnection]::new($connectionString)
$rows=[Collections.Generic.List[object]]::new()
$costs=[Collections.Generic.List[object]]::new()
$providers=[Collections.Generic.List[object]]::new()
try {
    $connection.Open()
    $cmd=$connection.CreateCommand();$cmd.CommandTimeout=90
    # Solo lectura. Sin clientes, proveedores, credenciales ni documentos de venta.
    $cmd.CommandText=@'
SELECT a.IDArt,a.[Descripción],a.IDArtProv,a.IDProveedor,a.IDRubro,r.[Descripción] AS rubro,
 a.PrecioVta3*CASE WHEN a.IDMoneda=1 THEN 1 ELSE m.ImpCotiz END AS precio,
 ISNULL(s.progreso,0) AS progreso,ISNULL(s.calle5,0) AS calle5,
 a.PrecioCpraCI*CASE WHEN a.IDMoneda=1 THEN 1 ELSE m.ImpCotiz END AS costoCI,
 a.PrecioCpraSISDto*CASE WHEN a.IDMoneda=1 THEN 1 ELSE m.ImpCotiz END AS costoSinDto,a.PorcGanMin
FROM dbo.[Artículos] a
LEFT JOIN dbo.Rubros r ON r.IDRubro=a.IDRubro
LEFT JOIN dbo.Monedas m ON m.IDMoneda=a.IDMoneda
LEFT JOIN (SELECT IDArt,SUM(CASE WHEN IDSuc=1 THEN StockAct ELSE 0 END) AS progreso,
 SUM(CASE WHEN IDSuc=2 THEN StockAct ELSE 0 END) AS calle5 FROM dbo.ArtsStock WHERE IDSuc IN(1,2) GROUP BY IDArt) s ON s.IDArt=a.IDArt
WHERE ISNULL(a.Suspendido,0)=0 ORDER BY a.IDArt
'@
    $reader=$cmd.ExecuteReader()
    try {
        while($reader.Read()) {
            if($reader.IsDBNull(6)){throw 'Un articulo tiene precio sin cotizacion; se conserva la lista publicada.'}
            $code=([string]$reader[0]).Trim()
            $row=[ordered]@{codigo=$code;idart=$code;nombre=([string]$reader[1]).Trim();descripcion=([string]$reader[1]).Trim();idartprov=([string]$reader[2]).Trim();codprov=([string]$reader[2]).Trim();idProveedor=[string]$reader[3];id_proveedor=[string]$reader[3];idRubro=[int]$reader[4];rubro=([string]$reader[5]).Trim();precio=[decimal]$reader[6];PrecioVta3=[decimal]$reader[6];stockSucursalProgresoRuta=[decimal]$reader[7];stockSucursalCalle5Espana=[decimal]$reader[8];stock=([decimal]$reader[7]+[decimal]$reader[8]);activo=$true}
            $costs.Add(@{codigo=$code;PrecioCpraCI=if($reader.IsDBNull(9)){0}else{[decimal]$reader[9]};PrecioCpraSISDto=if($reader.IsDBNull(10)){0}else{[decimal]$reader[10]};PorcGanMin=if($reader.IsDBNull(11)){0}else{[decimal]$reader[11]}})
            $meta=$byCode[$code]
            if($meta) {
                foreach($name in @('detalle','imagenes','oferta','destacado','ceramico')){$row[$name]=$meta.$name}
                foreach($pair in @(@('tagsOcultos','tags_ocultos'),@('fotoUrl','foto_url'),@('ofertaPct','oferta_pct'),@('ofertaHasta','oferta_hasta'),@('masVendido','mas_vendido'),@('accesoRapido','acceso_rapido'),@('ceramicoM2','ceramico_m2'),@('ceramicoPlacas','ceramico_placas'),@('edicionUpdatedAt','edicion_updated_at'))){$row[$pair[0]]=$meta.($pair[1])}
                $row['sqlEditRevision']=[long]$meta.revision
            }
            $rows.Add($row)
        }
    } finally {$reader.Close();$cmd.Dispose()}
    $cmd=$connection.CreateCommand();$cmd.CommandText='SELECT IDProveedor,[RazónSocial] FROM dbo.Proveedores ORDER BY IDProveedor'
    $reader=$cmd.ExecuteReader()
    try{while($reader.Read()){$providers.Add(@{id=[string]$reader[0];id_proveedor=[string]$reader[0];proveedor=[string]$reader[1];nombre=[string]$reader[1]})}}finally{$reader.Close();$cmd.Dispose()}
} finally {$connection.Dispose()}
if($rows.Count -lt 100){throw 'Catalogo demasiado pequeno; no se reemplaza la ultima lista.'}
$sha=[Security.Cryptography.SHA256]::Create()
function Hash-Text($text){return ([BitConverter]::ToString($sha.ComputeHash($encoding.GetBytes($text)))).Replace('-','').ToLowerInvariant()}
$buckets=@{}
foreach($row in $rows){$bucket=(Hash-Text $row.codigo).Substring(0,1);if(!$buckets.ContainsKey($bucket)){$buckets[$bucket]=[Collections.Generic.List[object]]::new()};$buckets[$bucket].Add($row)}
$files=@()
foreach($bucket in ($buckets.Keys | Sort-Object)) {
    $json=ConvertTo-Json -InputObject @($buckets[$bucket].ToArray()) -Depth 12 -Compress
    $hash=Hash-Text $json;$name=$bucket+'-'+$hash+'.json'
    $path=Join-Path $out $name
    if(!(Test-Path -LiteralPath $path)){Write-Atomic $path $json}
    $files+=@{file=$name;hash=$hash;count=$buckets[$bucket].Count}
}
$costJson=ConvertTo-Json -InputObject @{articles=@($costs.ToArray());providers=@($providers.ToArray())} -Depth 6 -Compress
$costHash=Hash-Text $costJson
$costName='costos-'+$costHash+'.json'
$costPath=Join-Path $out $costName
if(!(Test-Path -LiteralPath $costPath)){
    $nonce=[Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
    $clear=$encoding.GetBytes($costJson);$cipher=[byte[]]::new($clear.Length);$tag=[byte[]]::new(16)
    $aes=[Security.Cryptography.AesGcm]::new([Convert]::FromBase64String($secrets.CATALOG_COST_KEY),16)
    try{$aes.Encrypt($nonce,$clear,$cipher,$tag)}finally{$aes.Dispose()}
    $combined=[byte[]]::new($cipher.Length+16);[Array]::Copy($cipher,$combined,$cipher.Length);[Array]::Copy($tag,0,$combined,$cipher.Length,16)
    Write-Atomic $costPath (ConvertTo-Json @{schema=1;nonce=[Convert]::ToBase64String($nonce);data=[Convert]::ToBase64String($combined)} -Compress)
}
$config=@{aridos=@();freight=$null}
$configPath=Join-Path $PSScriptRoot 'config-inicial.json'
if(Test-Path -LiteralPath $configPath){$seed=Get-Content -Raw -LiteralPath $configPath|ConvertFrom-Json;$config.aridos=@($seed.aridos);$config.freight=$seed.freight}
if($remoteConfig){
    $aridosByCode=@{};foreach($item in $config.aridos){$aridosByCode[[string]$item.codigo]=$item};foreach($item in $remoteConfig.aridos){$aridosByCode[[string]$item.codigo]=$item}
    $config.aridos=@($aridosByCode.Values|Sort-Object codigo)
    if($remoteConfig.freight){$config.freight=$remoteConfig.freight}
}
$configJson=ConvertTo-Json -InputObject $config -Depth 10 -Compress
$configHash=Hash-Text $configJson;$configName='config-'+$configHash+'.json'
if(!(Test-Path -LiteralPath (Join-Path $out $configName))){Write-Atomic (Join-Path $out $configName) $configJson}
$version=Hash-Text ((($files | ForEach-Object {$_.hash}) -join '')+$costHash+$configHash)
$manifestPath=Join-Path $out 'manifest.json'
$old=if(Test-Path -LiteralPath $manifestPath){Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json}else{$null}
if($old.version -ne $version){
    $manifest=@{schema=1;version=$version;generatedAt=[DateTime]::UtcNow.ToString('o');count=$rows.Count;files=$files;costs=@{file=$costName;hash=$costHash};config=@{file=$configName;hash=$configHash}}
    # Se cambia el manifiesto solo despues de escribir TODOS los fragmentos.
    Write-Atomic $manifestPath (ConvertTo-Json -InputObject $manifest -Depth 5 -Compress)
}
$sha.Dispose()
Write-Output ('SQL: {0} articulos. Version {1}. Cambio: {2}' -f $rows.Count,$version.Substring(0,12),($old.version -ne $version))
