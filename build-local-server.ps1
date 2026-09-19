param([string]$OutputPath = '.codex-staging\CorralonWebServer.local-articles.exe')
$ErrorActionPreference = 'Stop'
$output = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $OutputPath))
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output)) | Out-Null
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:$output" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Data.dll /reference:System.Security.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'CorralonWebServer.cs')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el servidor.' }
Write-Output $output
