$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'facturacion-copia-api.cs'
$output = Join-Path $root '.codex-staging\FacturacionCopiaApi.fiscal-test.exe'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe "/out:$output" /reference:System.Data.dll /reference:System.Drawing.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll $source (Join-Path $root 'caja-sql-api.cs')
if ($LASTEXITCODE -ne 0) { throw 'No compiló la API de facturación.' }
$assembly = [Reflection.Assembly]::LoadFrom($output)
$type = $assembly.GetType('FacturacionCopiaApi', $true)
$method = $type.GetMethod('FiscalAmounts', [Reflection.BindingFlags]'NonPublic, Static')
function Assert-FiscalAmounts($gross, $final, $net21, $iva21, $net105, $iva105) {
    $amounts = [decimal[]]$method.Invoke($null, [object[]]@([decimal]$gross, [decimal]$final, [decimal]$net21, [decimal]$iva21, [decimal]$net105, [decimal]$iva105))
    if ($amounts[0] + $amounts[1] + $amounts[2] -ne [decimal]$final) { throw 'ImpTotal no coincide con neto + IVA + no gravado.' }
    if ($amounts[0] -ne $amounts[3] + $amounts[5] -or $amounts[1] -ne $amounts[4] + $amounts[6]) { throw 'El detalle de alícuotas no coincide con los importes fiscales.' }
    if ($final -ne $gross) {
        if ([math]::Abs($amounts[4] - [decimal]::Round($amounts[3] * [decimal]'0.21', 2, [MidpointRounding]::AwayFromZero)) -gt [decimal]'0.01') { throw 'La alícuota del 21% no coincide.' }
        if ([math]::Abs($amounts[6] - [decimal]::Round($amounts[5] * [decimal]'0.105', 2, [MidpointRounding]::AwayFromZero)) -gt [decimal]'0.01') { throw 'La alícuota del 10,5% no coincide.' }
    }
    return $amounts
}
$single = Assert-FiscalAmounts 13843.50 13800.00 11440.91 2402.59 0 0
if ($single[2] -ne 0) { throw 'El descuento generó importe no gravado indebido.' }
$mixed = Assert-FiscalAmounts 331.50 330.00 100 21 100 10.50
if ($mixed[2] -ne 99.55) { throw 'No se distribuyó el ajuste al importe no gravado.' }
$unchanged = Assert-FiscalAmounts 13843.50 13843.50 11440.91 2402.59 0 0
if ($unchanged[3] -ne 11440.91 -or $unchanged[4] -ne 2402.59) { throw 'Una venta sin ajuste cambió sus importes fiscales.' }
Write-Output 'PASS importes fiscales con descuento y venta sin ajuste'
