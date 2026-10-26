Add-Type -AssemblyName System.Security
function Get-IndexTestSecrets {
    $file=Join-Path $PSScriptRoot 'credenciales.private.json'
    if(Test-Path -LiteralPath $file){$encrypted=[Convert]::FromBase64String([IO.File]::ReadAllText($file));return ([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))|ConvertFrom-Json)}
    $values=@{PUBLISH_TOKEN=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32));CATALOG_COST_KEY=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))}
    $json=ConvertTo-Json $values -Compress
    $encrypted=[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($json),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllText($file,[Convert]::ToBase64String($encrypted))
    return ($json|ConvertFrom-Json)
}
