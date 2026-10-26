$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskOutput=Join-Path $taskRoot '.codex-staging/FacturacionCopiaApi.payment-test.exe'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe "/out:$taskOutput" /reference:System.Data.dll /reference:System.Drawing.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll (Join-Path $taskRoot 'facturacion-copia-api.cs') (Join-Path $taskRoot 'caja-sql-api.cs')
if($LASTEXITCODE -ne 0){throw 'No compiló la API de pagos.'}
$taskType=([Reflection.Assembly]::LoadFrom($taskOutput)).GetType('FacturacionCopiaApi',$true)
$taskAmount=$taskType.GetMethod('SupplierValidateAmount',[Reflection.BindingFlags]'NonPublic, Static')
foreach($case in @(@(100,100),@(25,100),@(-50,-50),@(-10,-50))){$null=$taskAmount.Invoke($null,[object[]]@([decimal]$case[0],[decimal]$case[1]))}
foreach($case in @(@(101,100),@(0,100),@(-1,100),@(1,-100),@(-51,-50))){$rejected=$false;try{$null=$taskAmount.Invoke($null,[object[]]@([decimal]$case[0],[decimal]$case[1]))}catch{$rejected=$true};if(-not $rejected){throw 'Se aceptó un importe inválido.'}}
$taskWords=$taskType.GetMethod('SupplierPaymentWords',[Reflection.BindingFlags]'NonPublic, Static')
foreach($case in @(@('1','UN PESOS CON 00/100'),@('21.50','VEINTIUN PESOS CON 50/100'),@('1000','MIL PESOS CON 00/100'),@('1280880.52','UN MILLON DOSCIENTOS OCHENTA MIL OCHOCIENTOS OCHENTA PESOS CON 52/100'))){$actual=$taskWords.Invoke($null,[object[]]@([decimal]::Parse($case[0],[Globalization.CultureInfo]::InvariantCulture)));if($actual -ne $case[1]){throw ('Importe en letras incorrecto: '+$actual)}}
Write-Output '13 validaciones de importes y letras correctas. No se ejecutaron escrituras SQL ni pagos.'
