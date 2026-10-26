param([string]$ApiPath='servidor/FacturacionCopiaApi.next.exe')
$ErrorActionPreference='Stop'
$taskType=([Reflection.Assembly]::LoadFrom((Join-Path $PWD $ApiPath))).GetType('FacturacionCopiaApi',$true)
$taskFlags=[Reflection.BindingFlags]'NonPublic,Static'
$taskError=$taskType.GetMethod('CustomerDocumentError',$taskFlags)
$taskIdentity=$taskType.GetMethod('CustomerDocumentIdentity',$taskFlags)
foreach($taskValue in @('','123','123123','1231231','12312312','11111111','12345678','00000001','123123123','f4287197')){
 if($taskError.Invoke($null,[object[]]@([int]50,$taskValue)) -eq ''){throw "DNI de relleno aceptado: $taskValue"}
}
foreach($taskValue in @('36932458','4287197','04.287.197')){
 if($taskError.Invoke($null,[object[]]@([int]50,$taskValue)) -ne ''){throw 'DNI con formato admitido rechazado.'}
}
if($taskError.Invoke($null,[object[]]@([int]67,'20-36932458-7')) -ne ''){throw 'CUIT con verificador correcto rechazado.'}
foreach($taskValue in @('20369324585','00000000000','123')){
 if($taskError.Invoke($null,[object[]]@([int]67,$taskValue)) -eq ''){throw 'CUIT inválido aceptado.'}
}
$taskDni=$taskIdentity.Invoke($null,@('36932458'))
if($taskDni -ne $taskIdentity.Invoke($null,@('20-36932458-7'))){throw 'No relacionó DNI con CUIT personal.'}
if($taskDni -eq $taskIdentity.Invoke($null,@('20369324585'))){throw 'Relacionó CUIT con verificador inválido.'}
if($taskIdentity.Invoke($null,@('4287197')) -ne $taskIdentity.Invoke($null,@('04287197'))){throw 'No normalizó DNI de siete cifras.'}
if($taskDni -eq $taskIdentity.Invoke($null,@('30-36932458-1'))){throw 'Relacionó una sociedad con un DNI por sus dígitos centrales.'}
'Validación del servidor y cruce DNI/CUIT: correctos. No se modificó SQL.'
