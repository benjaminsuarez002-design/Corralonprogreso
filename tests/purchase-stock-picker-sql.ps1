param([int]$InvoiceId = 0)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$type = [Reflection.Assembly]::LoadFrom((Join-Path (Get-Location) '.codex-staging/FacturacionCopiaApi.stock-picker-test.exe')).GetType('FacturacionCopiaApi')
$flags = [Reflection.BindingFlags]'NonPublic,Static'
$cn = $type.GetMethod('Connect', $flags).Invoke($null, @())
try {
  $cmd = $cn.CreateCommand()
  $cmd.CommandText = 'SELECT TOP 1 r.IDProveedor,p.IDDepósito FROM dbo.RecibosTP r JOIN dbo.[Depósitos] p ON p.IDSucAsoc=r.IDSuc WHERE r.IDTipoMov=23 AND r.Confirmado=1 AND r.Anulado=0 ORDER BY r.IDRecibo DESC'
  $reader = $cmd.ExecuteReader()
  if (-not $reader.Read()) { throw 'Sin movimientos de compra para verificar' }
  $provider = [int]$reader[0]; $point = [int]$reader[1]; $reader.Close()
  $source = Get-Content facturacion-copia-api.cs -Encoding UTF8
  $line = $source | Where-Object { $_ -match 'if \(query == "movimientos"\).*sucursalNombre' }
  $sql = [regex]::Match($line, 'Rows\(c, "(.*?)", provider, point\)').Groups[1].Value
  $rows = $type.GetMethod('Rows', $flags)
  $items = $rows.Invoke($null, [object[]]@($cn, $sql, [object[]]@($provider, $point)))
  Write-Output ('PASS SQL movimientos disponibles: ' + $items.Count)
  $line = $source | Where-Object { $_ -match 'Rows\(c,"SELECT d.IDArt AS idart' }
  $sql = [regex]::Match($line, 'Rows\(c,"(.*?)",id\)').Groups[1].Value
  $cmd.CommandText = 'SELECT TOP 1 IDRecibo FROM dbo.RecibosTP WHERE IDTipoMov=23 AND Confirmado=1 AND Anulado=0 ORDER BY IDRecibo DESC'
  $details = $rows.Invoke($null, [object[]]@($cn, $sql, [object[]]@([int]$cmd.ExecuteScalar())))
  Write-Output ('PASS SQL artículos del movimiento: ' + $details.Count)
  $cmd.CommandText = 'SELECT TOP 1 p.IDRecibo FROM dbo.ComprasTP p JOIN dbo.RecibosTP r ON r.IDFactura=p.IDRecibo WHERE r.IDTipoMov=23 AND r.Confirmado=1 AND r.Anulado=0 ORDER BY p.IDRecibo DESC'
  $invoice = if ($InvoiceId -gt 0) { $InvoiceId } else { $cmd.ExecuteScalar() }
  if ($invoice -ne $null -and $invoice -ne [DBNull]::Value) {
    $state = $type.GetMethod('PurchaseRemovalPreview', $flags).Invoke($null, [object[]]@($cn, $null, [int]$invoice))
    if ($state.stock.Count -eq 0) { throw 'No detectó la carga vinculada' }
    if ($state.motivos -contains 'Tiene una carga de stock vinculada. Debés resolver ese movimiento antes de eliminar la compra.') { throw 'Sigue bloqueando por stock' }
    Write-Output ('PASS SQL previsualización: conserva ' + $state.stock.Count + ' cargas; bloqueos vigentes: ' + $state.motivos.Count); if ($InvoiceId -gt 0) { Write-Output ('Cargas anuladas: ' + @($state.stock | Where-Object { $_.Anulado }).Count); if ($state.bloqueado) { throw ('La factura sigue bloqueada: ' + ($state.motivos -join ' ')) } }
  }
  Write-Output 'PASS consultas de solo lectura: no se modificaron facturas ni existencias'
} finally { $cn.Dispose() }
