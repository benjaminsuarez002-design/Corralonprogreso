$ErrorActionPreference='Stop'
function Decode-Firestore($value){
    if($null -eq $value){return $null}
    if($value.PSObject.Properties.Name -contains 'stringValue'){return [string]$value.stringValue}
    if($value.PSObject.Properties.Name -contains 'booleanValue'){return [bool]$value.booleanValue}
    if($value.PSObject.Properties.Name -contains 'integerValue'){return [long]$value.integerValue}
    if($value.PSObject.Properties.Name -contains 'doubleValue'){return [double]$value.doubleValue}
    if($value.mapValue){$map=@{};foreach($property in $value.mapValue.fields.PSObject.Properties){$map[$property.Name]=Decode-Firestore $property.Value};return $map}
    if($value.arrayValue){return ,@($value.arrayValue.values|ForEach-Object {Decode-Firestore $_})}
    return $null
}
$base='https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/'
$api='AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0'
$configs=[Collections.Generic.List[object]]::new();$page=''
do {
    $url=$base+'configAridosArticulos?pageSize=300&key='+$api
    if($page){$url+='&pageToken='+[Uri]::EscapeDataString($page)}
    $result=Invoke-RestMethod -Uri $url -TimeoutSec 30
    foreach($doc in $result.documents){$item=@{};foreach($property in $doc.fields.PSObject.Properties){$item[$property.Name]=Decode-Firestore $property.Value};if(!$item.codigo){$item.codigo=[Uri]::UnescapeDataString(($doc.name -split '/')[-1])};$configs.Add($item)}
    $page=$result.nextPageToken
} while($page)
$doc=Invoke-RestMethod -Uri ($base+'config/aridosFletes?key='+$api) -TimeoutSec 30
$freight=@{};foreach($property in $doc.fields.PSObject.Properties){$freight[$property.Name]=Decode-Firestore $property.Value}
$file=Join-Path $PSScriptRoot 'config-inicial.json'
[IO.File]::WriteAllText($file,(ConvertTo-Json @{aridos=@($configs.ToArray());freight=$freight} -Depth 12 -Compress),[Text.UTF8Encoding]::new($false))
Write-Output ('Configuraciones de aridos copiadas: '+$configs.Count)
