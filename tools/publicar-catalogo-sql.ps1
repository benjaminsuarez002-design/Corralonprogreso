param([switch]$SoloExtraer)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Data
Add-Type -AssemblyName System.Security
$root=Split-Path $PSScriptRoot -Parent
$runtime=Join-Path $root 'servidor'
$lock=$null
try {
 $lock=[IO.File]::Open((Join-Path $runtime 'catalogo-sql.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
} catch {Write-Output 'Ya hay una publicacion SQL en curso.';exit 0}
try {
 $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\CorralonProgreso\LocalSql')
 if(!$key){throw 'Falta configurar SQL local.'}
 try{$encrypted=[string]$key.GetValue('Connection')}finally{$key.Close()}
 $cs=[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($encrypted),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))
 $connection=[Data.SqlClient.SqlConnection]::new($cs)
 $rows=[Collections.Generic.List[object]]::new()
 try {
  $connection.Open();$cmd=$connection.CreateCommand();$cmd.CommandTimeout=120
  # Equivalente nativo de ExportArts + AArticulos + FArtsStockFS. Solo lectura.
  $cmd.CommandText=@"
SELECT a.IDArt,a.IDArtProv,a.[Descripción] AS [AArtículos.Descripción],
 a.PrecioCpraSISDto,a.PrecioCpraCI,a.PorcGanMin,
 a.PrecioVta3*m.ImpCotiz AS PrecioVta3,r.[Descripción] AS [Rubros.Descripción],
 s.StockAct,a.IDProveedor,s.IDSuc,a.IDRubro
FROM dbo.[Artículos] a
JOIN dbo.Proveedores p ON p.IDProveedor=a.IDProveedor
JOIN dbo.Monedas m ON m.IDMoneda=a.IDMoneda
JOIN dbo.PorcIVA i ON i.IDPorcIVA=a.IDPorcIVA
JOIN dbo.Rubros r ON r.IDRubro=a.IDRubro
JOIN dbo.ArtsStock s ON s.IDArt=a.IDArt
JOIN dbo.Sucursales b ON b.IDSuc=s.IDSuc
WHERE a.Suspendido=0 ORDER BY a.IDArt,s.IDSuc
"@
  $reader=$cmd.ExecuteReader()
  try{while($reader.Read()){$row=[ordered]@{};for($j=0;$j -lt $reader.FieldCount;$j++){$row[$reader.GetName($j)]=if($reader.IsDBNull($j)){$null}else{$reader.GetValue($j)}};if($null -eq $row.PrecioVta3){throw 'Precio sin cotizacion. No se publica.'};$rows.Add($row)}}finally{$reader.Close();$cmd.Dispose()}
 } finally {$connection.Dispose()}
 if($rows.Count -lt 100){throw 'Extraccion incompleta: menos de 100 filas. No se publica.'}
 $raw=Join-Path $runtime 'catalogo-sql-fuente.json';$json=Join-Path $runtime 'catalogo-sql-lista.json'
 [IO.File]::WriteAllText($raw,(ConvertTo-Json -InputObject @($rows.ToArray()) -Depth 8 -Compress),[Text.UTF8Encoding]::new($false))
 & node (Join-Path $PSScriptRoot 'catalogo-sql-normalizar.js') --excel $raw --out $json
 if($LASTEXITCODE -ne 0){throw 'Fallo la normalizacion SQL.'}
 if($SoloExtraer){Write-Output ('Extraccion SQL correcta: '+$rows.Count+' filas. Sin publicar.');exit 0}
 & node (Join-Path $PSScriptRoot 'catalogo-sql-publicar.js') --json $json --excel SQL-ExportArts --config 'C:\Update\actualizaciones\Subir Lista Index\catalogo-supabase.ini' --state 'C:\Update\actualizaciones\Subir Lista Index\catalogo-sync-state.json'
 if($LASTEXITCODE -ne 0){throw 'Fallo la publicacion SQL.'}
 [IO.File]::WriteAllText((Join-Path $runtime 'catalogo-sql-ultima-publicacion.txt'),[DateTime]::UtcNow.ToString('o'))
} finally {$lock.Dispose()}
