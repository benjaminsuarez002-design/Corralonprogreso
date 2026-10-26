param([string]$ConfigPath = 'C:\Update\actualizaciones\Subir Lista Index\catalogo-supabase.ini', [switch]$Preview, [string]$SnapshotPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

function Read-SupabaseConfig([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { throw 'Falta la configuracion de Supabase usada por Index.' }
  $values = @{}
  $section = ''
  foreach ($line in [IO.File]::ReadAllLines($path)) {
    $text = $line.Trim()
    if ($text -match '^\[([^]]+)\]$') { $section = $Matches[1].ToLowerInvariant(); continue }
    if ($text -match '^([^=;#]+)=(.*)$') {
      $values[($section + '.' + $Matches[1].Trim().ToLowerInvariant())] = $Matches[2].Trim()
    }
  }
  return $values
}

$settings = Read-SupabaseConfig $ConfigPath
$baseUrl = [string]$settings['supabase.url']
$anonKey = [string]$settings['supabase.anonkey']
$token = [string]$settings['supabase.importtoken']
if (-not $baseUrl -or -not $anonKey -or -not $token) { throw 'Faltan los datos de Supabase para publicar el ranking.' }

$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\CorralonProgreso\LocalSql')
if ($null -eq $key) { throw 'Falta la conexion SQL local.' }
try { $encrypted = [string]$key.GetValue('Connection') } finally { $key.Close() }
if (-not $encrypted) { throw 'Falta la conexion SQL local.' }
$bytes = [Convert]::FromBase64String($encrypted)
$connectionString = [Text.Encoding]::UTF8.GetString(
  [Security.Cryptography.ProtectedData]::Unprotect(
    $bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))

$desde = [DateTime]::Today.AddMonths(-4)
$hasta = [DateTime]::Today
$byArticle = @{}
$connection = New-Object System.Data.SqlClient.SqlConnection($connectionString)
try {
  $connection.Open()
  $command = $connection.CreateCommand()
  $command.CommandTimeout = 120
  $command.CommandText = @'
-- El total de renglones se calcula una vez por comprobante. Distribuir TotalME
-- respeta descuentos/recargos generales, moneda e importes finales históricos.
WITH lineas AS (
SELECT d.IDArt, f.IDSuc, f.IDRecibo, f.Fecha, t.StkPor, d.Cantidad,
       CONVERT(decimal(22,6), d.Importe) AS importe,
       ABS(CONVERT(decimal(22,6), f.TotalME)) AS total,
       SUM(CONVERT(decimal(22,6), d.Importe)) OVER (PARTITION BY f.IDRecibo) AS total_lineas
FROM dbo.FacturasATP f
JOIN dbo.FacturasATS d ON d.IDRecibo = f.IDRecibo
JOIN dbo.TipoComprobantes t ON t.IDComprob = f.IDComprob
WHERE f.Fecha >= @desde AND f.Fecha < @hasta_exclusiva
  AND f.Anulada = 0 AND f.Confirmado = -1 AND f.ActStock = -1
  AND t.IDTipoMovStock > 0 AND f.IDSuc IN (1,2)
)
SELECT IDArt AS idart, IDSuc AS idsuc,
       COUNT(DISTINCT CASE WHEN StkPor < 0 THEN IDRecibo END) AS ventas,
       SUM(CONVERT(decimal(18,3), -Cantidad * StkPor)) AS unidades,
       MAX(CASE WHEN StkPor < 0 THEN CONVERT(date, Fecha) END) AS ultima_venta,
       SUM(CONVERT(decimal(22,6), -StkPor * importe *
           COALESCE(total / NULLIF(total_lineas, 0), 1))) AS importe_vendido
FROM lineas GROUP BY IDArt, IDSuc
'@
  [void]$command.Parameters.Add('@desde', [System.Data.SqlDbType]::DateTime)
  $command.Parameters['@desde'].Value = $desde
  [void]$command.Parameters.Add('@hasta_exclusiva', [System.Data.SqlDbType]::DateTime)
  $command.Parameters['@hasta_exclusiva'].Value = $hasta.AddDays(1)
  $reader = $command.ExecuteReader()
  try {
    while ($reader.Read()) {
      $idart = [string]$reader.GetValue(0)
      if (-not $idart) { continue }
      if (-not $byArticle.ContainsKey($idart)) {
        $byArticle[$idart] = @{
          idart = $idart; ventas_progreso = 0; unidades_progreso = 0;
          ventas_calle5 = 0; unidades_calle5 = 0; ultima_venta = $null;
          importe_progreso = 0; importe_calle5 = 0; puntaje = 0
        }
      }
      $item = $byArticle[$idart]
      $branch = [int]$reader.GetValue(1)
      $suffix = if ($branch -eq 1) { 'progreso' } else { 'calle5' }
      $item['ventas_' + $suffix] = [int]$reader.GetValue(2)
      $item['unidades_' + $suffix] = [decimal]$reader.GetValue(3)
      $item['importe_' + $suffix] = [decimal]$reader.GetValue(5)
      if (-not $reader.IsDBNull(4)) {
        $date = $reader.GetDateTime(4).ToString('yyyy-MM-dd')
        if (-not $item.ultima_venta -or $date -gt $item.ultima_venta) { $item.ultima_venta = $date }
      }
    }
  } finally { $reader.Close(); $command.Dispose() }
} finally { $connection.Dispose() }

if ($byArticle.Count -lt 500) { throw "El ranking devolvio solo $($byArticle.Count) articulos; no se publica un snapshot incompleto." }
foreach ($item in $byArticle.Values) {
  $sales = [decimal]$item.ventas_progreso + [decimal]$item.ventas_calle5
  $amount = [Math]::Max([decimal]0, ([decimal]$item.importe_progreso + [decimal]$item.importe_calle5))
  $item.puntaje = [Math]::Round($sales * $amount / 100000, 6, [MidpointRounding]::AwayFromZero)
}
$rows = @($byArticle.Values | Sort-Object idart)
$payload = @{ desde = $desde.ToString('yyyy-MM-dd'); hasta = $hasta.ToString('yyyy-MM-dd'); rows = $rows } |
  ConvertTo-Json -Depth 4 -Compress
if ($SnapshotPath) { [IO.File]::WriteAllText($SnapshotPath, $payload, (New-Object Text.UTF8Encoding($false))) }
if ($Preview) {
  Write-Output ("Vista previa: {0} articulos, desde {1} hasta {2}; no se publico nada." -f
    $byArticle.Count, $desde.ToString('yyyy-MM-dd'), $hasta.ToString('yyyy-MM-dd'))
  return
}
$uri = $baseUrl.TrimEnd('/') + '/functions/v1/publicar-ranking'
$response = Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json; charset=utf-8' `
  -Headers @{ apikey = $anonKey; Authorization = "Bearer $token" } `
  -Body ([Text.Encoding]::UTF8.GetBytes($payload)) -TimeoutSec 120
if (-not $response.ok) { throw 'Supabase no confirmo la publicacion del ranking.' }
& (Join-Path $PSScriptRoot 'publicar-version-ranking.ps1') -Version ([long]$response.version)
Write-Output ("Ranking publicado: {0} articulos, version {1}, {2} cambios, {3} puestos en cero." -f
  $response.articulos, $response.version, $response.modificados, $response.puestos_en_cero)
