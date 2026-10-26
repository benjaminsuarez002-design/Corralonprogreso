param([string]$ApiPath='.codex-staging/FacturacionCopiaApi.cash-test.exe')
$ErrorActionPreference='Stop'
$api=[Reflection.Assembly]::LoadFrom((Join-Path $PWD $ApiPath)).GetType('FacturacionCopiaApi')
$flags=[Reflection.BindingFlags]'NonPublic,Static'
$connection=$api.GetMethod('Connect',$flags).Invoke($null,@())
function Scalar($query,$transaction=$null){
  $command=$connection.CreateCommand();$command.Transaction=$transaction;$command.CommandText=$query
  try{return $command.ExecuteScalar()}finally{$command.Dispose()}
}
function Check($condition,$message){if(-not $condition){throw $message}}
try{
  $id=Scalar "SELECT TOP 1 p.IDRecibo FROM dbo.ComprasTP p WHERE p.Confirmado=1 AND p.IDFormaPago=3 AND p.Total>0 AND ISNULL(p.IDRecImp,0)=0 AND NOT EXISTS(SELECT 1 FROM dbo.OrdPagosTSFac f JOIN dbo.OrdPagosTP o ON o.NroOrden=f.NroOrden WHERE f.IDFactura=p.IDRecibo AND o.Confirmado=1 AND ISNULL(o.Anulado,0)=0) ORDER BY p.IDRecibo DESC"
  Check ($null -ne $id) 'No hay una factura de cuenta corriente sin pagos para verificar.'
  $id=[int]$id;$before=[int](Scalar 'SELECT COUNT(*) FROM dbo.OrdPagosTP')
  $tx=$connection.BeginTransaction([Data.IsolationLevel]::Serializable)
  try{
    $method=$api.GetMethod('PurchaseCashPayment',$flags)
    $method.Invoke($null,[object[]]@($connection,$tx,$id,4))|Out-Null
    Check ((Scalar "SELECT IDFormaPago FROM dbo.ComprasTP WHERE IDRecibo=$id" $tx) -eq 1) 'La factura no pasó a efectivo.'
    Check ((Scalar 'SELECT COUNT(*) FROM dbo.OrdPagosTP' $tx) -eq ($before+1)) 'No se generó exactamente una orden.'
    $valid=Scalar "SELECT COUNT(*) FROM dbo.ComprasTP p JOIN dbo.OrdPagosTSFac f ON f.IDFactura=p.IDRecibo JOIN dbo.OrdPagosTP o ON o.NroOrden=f.NroOrden JOIN dbo.OrdPagosTSPag v ON v.NroOrden=o.NroOrden WHERE p.IDRecibo=$id AND o.Confirmado=1 AND o.Anulado=0 AND o.Fecha=p.Fecha AND v.FechaVto=p.Fecha AND f.Importe=p.Total AND o.TotalCpras=p.Total AND o.TotalPagos=p.Total AND v.Importe=p.Total AND v.IDTipoPago=1 AND v.IDBanco=0" $tx
    Check ($valid -eq 1) 'Fecha, efectivo o imputación incorrectos.'
    $method.Invoke($null,[object[]]@($connection,$tx,$id,4))|Out-Null
    Check ((Scalar 'SELECT COUNT(*) FROM dbo.OrdPagosTP' $tx) -eq ($before+1)) 'Reintentar duplicó el pago.'
    Scalar "UPDATE dbo.ComprasTP SET IDFormaPago=3 WHERE IDRecibo=$id" $tx | Out-Null
    $rejected=$false
    try{$method.Invoke($null,[object[]]@($connection,$tx,$id,4))|Out-Null}catch{
      if($_.Exception.ToString() -notmatch 'ya tienen una orden de pago'){throw}
      $rejected=$true
    }
    Check $rejected 'Una factura con orden aplicada permitió cambiar a efectivo.'
    Check ((Scalar "SELECT IDFormaPago FROM dbo.ComprasTP WHERE IDRecibo=$id" $tx) -eq 3) 'El rechazo modificó la forma de pago.'
    Check ((Scalar 'SELECT COUNT(*) FROM dbo.OrdPagosTP' $tx) -eq ($before+1)) 'El rechazo generó otra orden.'
  }finally{$tx.Rollback();$tx.Dispose()}
  Check ((Scalar 'SELECT COUNT(*) FROM dbo.OrdPagosTP') -eq $before) 'La prueba dejó una orden guardada.'
  Check ((Scalar "SELECT IDFormaPago FROM dbo.ComprasTP WHERE IDRecibo=$id") -eq 3) 'La prueba dejó modificada la factura.'
  'PASS: efectivo, fecha original, reintento y bloqueo con orden aplicada. Cambios revertidos.'
}finally{$connection.Dispose()}
