param([string]$ApiPath='servidor/FacturacionCopiaApi.next.exe',[switch]$SqlReadOnly)
$ErrorActionPreference='Stop'
$taskType=([Reflection.Assembly]::LoadFrom((Join-Path $PWD $ApiPath))).GetType('FacturacionCopiaApi',$true)
$taskFlags=[Reflection.BindingFlags]'NonPublic,Static'
$taskCheck=$taskType.GetMethod('InvoiceValuesBalanceError',$taskFlags)
$taskCases=@(
 @{total=75000;articles=75127.98;base=75000;fee=0;paid=75000;valid=$false},
 @{total=75000;articles=75127.98;base=75127.98;fee=-127.98;paid=75000;valid=$true},
 @{total=75000;articles=75127.98;base=75127.98;fee=-127.98;paid=74999.99;valid=$false},
 @{total=-75000;articles=75127.98;base=75127.98;fee=-127.98;paid=75000;valid=$true},
 @{total=110;articles=100;base=110;fee=0;paid=110;valid=$false},
 @{total=110;articles=100;base=100;fee=10;paid=110;valid=$true},
 @{total=100;articles=100;base=100;fee=0;paid=100;valid=$true}
)
foreach($taskCase in $taskCases){
 $taskError=$taskCheck.Invoke($null,[object[]]@([decimal]$taskCase.total,[decimal]$taskCase.articles,[decimal]$taskCase.base,[decimal]$taskCase.fee,[decimal]$taskCase.paid))
 if(($taskError -eq '') -ne $taskCase.valid){throw 'Validacion de base/ajuste/total incorrecta.'}
}
if($SqlReadOnly){
 $taskConnection=$taskType.GetMethod('Connect',$taskFlags).Invoke($null,@())
 try{
  $taskRows=$taskType.GetMethod('CajaInvoiceDifferences',$taskFlags).Invoke($null,[object[]]@($taskConnection,$null,[datetime]'2026-10-26',[int]1,[int]4,[int]0))
  $taskRow=$taskRows | Where-Object { $_.IDRecibo -eq 500938 }
  if(-not $taskRow -or [decimal]$taskRow['ImpDifBase'] -ne 127.98 -or [decimal]$taskRow['ImpDifArticulos'] -ne 127.98){throw 'Caja no detecto el comprobante reportado con su diferencia de ajuste.'}
 }finally{$taskConnection.Close();$taskConnection.Dispose()}
}
'7 casos de conciliacion correctos; consulta opcional de Caja sin escrituras.'
