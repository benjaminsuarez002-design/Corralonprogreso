Add-Type -AssemblyName System.Windows.Forms

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dialogOwner = $null

function New-DialogOwner {
    $owner = New-Object System.Windows.Forms.Form
    $owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $owner.ShowInTaskbar = $false
    $owner.TopMost = $true
    $owner.Size = New-Object System.Drawing.Size(1, 1)
    $owner.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $owner.Location = New-Object System.Drawing.Point(-32000, -32000)
    $owner.Opacity = 0.01
    $owner.Show()
    $owner.Activate()
    return $owner
}

function Show-Message {
    param(
        [string]$Text,
        [string]$Title = 'Subir a GitHub',
        [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
    )
    if ($script:dialogOwner) {
        [System.Windows.Forms.MessageBox]::Show($script:dialogOwner, $Text, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $Icon) | Out-Null
    } else {
        [System.Windows.Forms.MessageBox]::Show($Text, $Title, [System.Windows.Forms.MessageBoxButtons]::OK, $Icon) | Out-Null
    }
}

function Run-Git {
    param(
        [string[]]$Arguments,
        [string]$WorkingDirectory = $repoRoot,
        [switch]$AllowFailure,
        [switch]$SuppressWarnings
    )

    $previousErrorAction = $ErrorActionPreference
    try {
        # Git envia mensajes normales de fetch/push por stderr. No deben tratarse
        # como excepciones: el resultado real lo determina su codigo de salida.
        $ErrorActionPreference = 'Continue'
        if ($SuppressWarnings) {
            $output = & git -C $WorkingDirectory @Arguments 2>$null | Out-String
        } else {
            $output = & git -C $WorkingDirectory @Arguments 2>&1 | Out-String
        }
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if (-not $AllowFailure -and $exitCode -ne 0) {
        throw "Git devolvio un error:`r`n$output"
    }
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output.Trim()
    }
}

function Get-Sha256Hash {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $sha.ComputeHash($stream)
        return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Publish-WebVersionRealtime {
    param([string]$ManifestPath)
    if (-not (Test-Path -LiteralPath $ManifestPath)) { return $false }
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $payload = @{
        fields = @{
            version = @{ stringValue = [string]$manifest.version }
            prioridad = @{ stringValue = [string]$manifest.prioridad }
            mensaje = @{ stringValue = [string]$manifest.mensaje }
            publicado = @{ stringValue = [string]$manifest.publicado }
            actualizado_en = @{ timestampValue = (Get-Date).ToUniversalTime().ToString('o') }
        }
    } | ConvertTo-Json -Depth 6
    # Actualiza solo estos campos para conservar el mapa de prioridades que se
    # administra desde el historial de versiones del menu.
    $url = 'https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/configuracion/version_web?key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0' +
        '&updateMask.fieldPaths=version' +
        '&updateMask.fieldPaths=prioridad' +
        '&updateMask.fieldPaths=mensaje' +
        '&updateMask.fieldPaths=publicado' +
        '&updateMask.fieldPaths=actualizado_en'
    Invoke-RestMethod -Uri $url -Method Patch -ContentType 'application/json; charset=utf-8' -Body $payload -TimeoutSec 20 | Out-Null
    return $true
}

function Publish-CloudflareDirect {
    param([string]$WorkingDirectory)

    $previousErrorAction = $ErrorActionPreference
    Push-Location $WorkingDirectory
    try {
        $ErrorActionPreference = 'Continue'
        $output = & npx.cmd --yes wrangler@4.125.0 deploy 2>&1 | Out-String
        $exitCode = $LASTEXITCODE
    } finally {
        Pop-Location
        $ErrorActionPreference = $previousErrorAction
    }

    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $output.Trim()
    }
}

function Wait-GitHubManifest {
    param(
        [string]$ExpectedVersion,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $manifest = Invoke-RestMethod -Uri ("https://raw.githubusercontent.com/benjaminsuarez002-design/Corralonprogreso/main/version-web.json?t=" + $stamp) -Method Get -TimeoutSec 10
            if ([string]$manifest.version -eq [string]$ExpectedVersion) { return $true }
        } catch {}
        Start-Sleep -Milliseconds 1200
    } while ((Get-Date) -lt $deadline)

    return $false
}

function ConvertTo-PageKey {
    param([string]$FileName)
    $value = ([System.IO.Path]::GetFileNameWithoutExtension($FileName)).ToLowerInvariant().Replace(' ', '-')
    $normalized = $value.Normalize([Text.NormalizationForm]::FormD)
    $builder = New-Object Text.StringBuilder
    foreach ($char in $normalized.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($char) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
            [void]$builder.Append($char)
        }
    }
    return $builder.ToString().Normalize([Text.NormalizationForm]::FormC)
}

function Get-NextPageVersion {
    param([string]$Version)
    $parts = @([string]$Version -split '\.')
    if ($parts.Count -ne 3) { throw "Version de pagina invalida: $Version" }
    return "$($parts[0]).$($parts[1]).$([int]$parts[2] + 1)"
}

function Show-VersionDetailsDialog {
    param([string[]]$HtmlFiles, $Manifest)
    $form = New-Object Windows.Forms.Form
    $form.Text = 'Datos de la actualizacion'
    $form.Width = 600
    $form.Height = 410
    $form.FormBorderStyle = [Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
    $form.TopMost = $true

    $label = New-Object Windows.Forms.Label
    $label.Left = 16; $label.Top = 14; $label.Width = 550
    $label.Text = 'Paginas HTML que cambiaran de version:'
    $list = New-Object Windows.Forms.TextBox
    $list.Left = 16; $list.Top = 38; $list.Width = 550; $list.Height = 105
    $list.Multiline = $true; $list.ReadOnly = $true; $list.ScrollBars = 'Vertical'
    $versionLines = foreach ($file in $HtmlFiles) {
        $key = ConvertTo-PageKey $file
        $property = $Manifest.paginas.PSObject.Properties[$key]
        if ($property) { "$(Split-Path $file -Leaf): $($property.Value.version) -> $(Get-NextPageVersion $property.Value.version)" }
    }
    $list.Text = $versionLines -join "`r`n"

    $changeLabel = New-Object Windows.Forms.Label
    $changeLabel.Left = 16; $changeLabel.Top = 154; $changeLabel.Width = 550
    $changeLabel.Text = '¿Que se actualizo?'
    $change = New-Object Windows.Forms.TextBox
    $change.Left = 16; $change.Top = 177; $change.Width = 550; $change.Height = 70; $change.Multiline = $true
    $priorityLabel = New-Object Windows.Forms.Label
    $priorityLabel.Left = 16; $priorityLabel.Top = 260; $priorityLabel.Width = 85; $priorityLabel.Text = 'Importancia:'
    $priority = New-Object Windows.Forms.ComboBox
    $priority.Left = 105; $priority.Top = 256; $priority.Width = 170; $priority.DropDownStyle = 'DropDownList'
    [void]$priority.Items.AddRange(@('Normal', 'Recomendada', 'Importante')); $priority.SelectedIndex = 0
    $upload = New-Object Windows.Forms.Button
    $upload.Text = 'Subir'; $upload.Left = 374; $upload.Top = 306; $upload.Width = 92; $upload.DialogResult = 'OK'
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = 'Cancelar'; $cancel.Left = 474; $cancel.Top = 306; $cancel.Width = 92; $cancel.DialogResult = 'Cancel'
    $form.Controls.AddRange(@($label, $list, $changeLabel, $change, $priorityLabel, $priority, $upload, $cancel))
    $form.AcceptButton = $upload; $form.CancelButton = $cancel
    $form.Add_Shown({ $form.Activate(); $change.Focus() })
    if ($form.ShowDialog($dialogOwner) -ne [Windows.Forms.DialogResult]::OK) { $form.Dispose(); return $null }
    if ([string]::IsNullOrWhiteSpace($change.Text)) {
        $form.Dispose()
        Show-Message -Text 'Escribi que se actualizo.'
        return $null
    }
    $result = [pscustomobject]@{ Change = $change.Text.Trim(); Priority = $priority.SelectedItem.ToString().ToLowerInvariant() }
    $form.Dispose()
    return $result
}

function Update-PageVersions {
    param([string[]]$HtmlFiles, [string]$Change, [string]$Priority)
    $manifestPath = Join-Path $repoRoot 'version-web.json'
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $newHistory = @()
    foreach ($file in $HtmlFiles) {
        $key = ConvertTo-PageKey $file
        $property = $manifest.paginas.PSObject.Properties[$key]
        if (-not $property) { continue }
        $page = $property.Value
        $next = Get-NextPageVersion ([string]$page.version)
        $page.version = $next
        $page.ultimo_cambio = $Change
        $page.actualizado = Get-Date -Format 'dd/MM/yyyy'
        $html = [IO.File]::ReadAllText($file)
        $html = [Text.RegularExpressions.Regex]::Replace($html, '(corralon-system\.js\?v=)\d+\.\d+\.\d+', "`${1}$next", 1)
        $sourceBytes = [IO.File]::ReadAllBytes($file)
        $hasBom = $sourceBytes.Length -ge 3 -and $sourceBytes[0] -eq 239 -and $sourceBytes[1] -eq 187 -and $sourceBytes[2] -eq 191
        [IO.File]::WriteAllText($file, $html, (New-Object Text.UTF8Encoding($hasBom)))
        $newHistory += [pscustomobject][ordered]@{
            version = $next
            pagina = [string]$page.nombre
            cambio = $Change
            prioridad = $Priority
            publicado = Get-Date -Format 'dd/MM/yyyy HH:mm'
        }
    }
    $manifest.historial = @($newHistory) + @($manifest.historial)
    $json = $manifest | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($manifestPath, $json, (New-Object Text.UTF8Encoding($false)))
}

$uploadWorktree = $null
$scriptExitCode = 0
$versionOriginals = @{}
$uploadSucceeded = $false

try {
    $dialogOwner = New-DialogOwner
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Git no esta instalado o no se encuentra en PATH.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
        throw "No encontre el repositorio Git en:`r`n$repoRoot"
    }

    Run-Git -Arguments @('fetch', 'origin', 'main') | Out-Null
    $trackedOutput = Run-Git -Arguments @('-c', 'core.quotepath=false', 'diff', '--name-only', 'origin/main', '--') -SuppressWarnings
    $untrackedOutput = Run-Git -Arguments @('-c', 'core.quotepath=false', 'ls-files', '--others', '--exclude-standard') -SuppressWarnings
    $relativeFiles = @($trackedOutput.Output -split "`r?`n") + @($untrackedOutput.Output -split "`r?`n") |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Where-Object { $_ -notmatch '^(\.codex|\.git|tmp/|node_modules/|supabase/\.temp/|vendor/)' } |
        Where-Object { $_ -notmatch '(\.log$|\.bak(\.|$)|backup.*\.exe$|\.test\.exe$)' } |
        Sort-Object -Unique
    if (-not $relativeFiles.Count) {
        Show-Message -Text 'No hay archivos modificados desde la ultima subida.'
        return
    }

    $confirmationText = "Se detectaron $($relativeFiles.Count) archivos modificados desde la ultima subida.`r`n`r`n¿Subir automaticamente todos los archivos modificados?"
    $answer = [System.Windows.Forms.MessageBox]::Show(
        $dialogOwner,
        $confirmationText,
        'Subida automatica',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
        return
    }

    $htmlFiles = @($relativeFiles | Where-Object { $_ -match '\.html$' } | ForEach-Object { Join-Path $repoRoot $_ } | Where-Object { Test-Path -LiteralPath $_ })
    if ($htmlFiles.Count) {
        $manifestSource = Join-Path $repoRoot 'version-web.json'
        if (-not (Test-Path -LiteralPath $manifestSource)) { throw 'No encontre version-web.json.' }
        $manifestForDialog = Get-Content -LiteralPath $manifestSource -Raw -Encoding UTF8 | ConvertFrom-Json
        $versionDetails = Show-VersionDetailsDialog -HtmlFiles $htmlFiles -Manifest $manifestForDialog
        if (-not $versionDetails) { return }
        foreach ($versionFile in @($htmlFiles) + @($manifestSource)) {
            $versionOriginals[$versionFile] = [IO.File]::ReadAllBytes($versionFile)
        }
        Update-PageVersions -HtmlFiles $htmlFiles -Change $versionDetails.Change -Priority $versionDetails.Priority
        if ($relativeFiles -notcontains 'version-web.json') { $relativeFiles += 'version-web.json' }
    }

    $selectedFiles = @($relativeFiles | ForEach-Object { Join-Path $repoRoot $_ })
    $fileNames = @($relativeFiles)
    $uploadWorktree = Join-Path ([System.IO.Path]::GetTempPath()) ("corralon-github-upload-" + [System.Guid]::NewGuid().ToString('N'))
    Run-Git -Arguments @('worktree', 'add', '--detach', $uploadWorktree, 'origin/main') | Out-Null

    foreach ($relativePath in $relativeFiles) {
        $source = Join-Path $repoRoot $relativePath
        $destination = Join-Path $uploadWorktree $relativePath
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }
            continue
        }
        $destinationDirectory = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $destinationDirectory)) { [IO.Directory]::CreateDirectory($destinationDirectory) | Out-Null }
        $sourceFull = [System.IO.Path]::GetFullPath($source)
        $destinationFull = [System.IO.Path]::GetFullPath($destination)
        if (-not [string]::Equals($sourceFull, $destinationFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            [System.IO.File]::Copy($sourceFull, $destinationFull, $true)
        }
    }

    Run-Git -WorkingDirectory $uploadWorktree -Arguments (@('add', '-A', '--') + $fileNames) | Out-Null
    $staged = Run-Git -WorkingDirectory $uploadWorktree -Arguments (@('diff', '--cached', '--quiet', '--') + $fileNames) -AllowFailure
    if ($staged.ExitCode -eq 0) {
        Show-Message -Text 'Los archivos elegidos no tienen cambios para subir.'
        return
    }
    if ($staged.ExitCode -ne 1) {
        throw "No pude comprobar los cambios seleccionados:`r`n$($staged.Output)"
    }

    # Sin esto Git escapa nombres Unicode (por ejemplo, garantias con tilde)
    # como "garant\303\255as.html" y Windows lo interpreta como una ruta invalida.
    $changedFilesText = Run-Git -WorkingDirectory $uploadWorktree -Arguments (@('-c', 'core.quotepath=false', 'diff', '--cached', '--name-only', '--') + $fileNames)
    $changedFiles = @($changedFilesText.Output -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if (-not $changedFiles.Count) {
        Show-Message -Text 'Los archivos elegidos no tienen cambios para subir.'
        return
    }

    $manifestName = 'actualizacion-version.json'
    $manifestPath = Join-Path $uploadWorktree $manifestName
    $previousVersion = 0
    $fileMap = @{}
    if (Test-Path -LiteralPath $manifestPath) {
        try {
            $previousManifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $previousVersion = [int]$previousManifest.version
            foreach ($entry in @($previousManifest.files)) {
                if ($entry.path) {
                    $fileMap[[string]$entry.path] = [ordered]@{
                        path = [string]$entry.path
                        hash = [string]$entry.hash
                        size = [long]$entry.size
                    }
                }
            }
        } catch {
            $previousVersion = 0
            $fileMap = @{}
        }
    }

    $newVersion = $previousVersion + 1
    foreach ($relativePath in $changedFiles) {
        $normalizedPath = ([string]$relativePath).Replace('\', '/')
        $fullChangedPath = Join-Path $uploadWorktree $relativePath
        if (-not (Test-Path -LiteralPath $fullChangedPath -PathType Leaf)) { continue }
        $info = Get-Item -LiteralPath $fullChangedPath
        $fileMap[$normalizedPath] = [ordered]@{
            path = $normalizedPath
            hash = Get-Sha256Hash -Path $fullChangedPath
            size = [long]$info.Length
        }
    }

    $manifest = [ordered]@{
        version = $newVersion
        publishedAt = (Get-Date).ToUniversalTime().ToString('o')
        files = @($fileMap.Values | Sort-Object { $_.path })
        lastRelease = @($changedFiles | ForEach-Object { ([string]$_).Replace('\', '/') })
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($manifestPath, $manifestJson, (New-Object System.Text.UTF8Encoding($false)))
    Run-Git -WorkingDirectory $uploadWorktree -Arguments @('add', '--', $manifestName) | Out-Null

    $message = 'Version ' + $newVersion
    Run-Git -WorkingDirectory $uploadWorktree -Arguments @('commit', '-m', $message) | Out-Null

    $push = Run-Git -WorkingDirectory $uploadWorktree -Arguments @('push', 'origin', 'HEAD:main') -AllowFailure
    if ($push.ExitCode -ne 0) {
        throw "El commit se creo, pero GitHub rechazo la subida:`r`n$($push.Output)"
    }
    $uploadSucceeded = $true

    [System.IO.File]::Copy($manifestPath, (Join-Path $repoRoot $manifestName), $true)
    $cloudflare = Publish-CloudflareDirect -WorkingDirectory $uploadWorktree
    $cloudflareReady = $cloudflare.ExitCode -eq 0
    $cloudflareStatus = if ($cloudflareReady) {
        "`r`n`r`nCloudflare actualizado directamente."
    } else {
        "`r`n`r`nGitHub se actualizo, pero fallo el despliegue directo a Cloudflare. " +
        "El despliegue automatico queda como respaldo.`r`n`r`n$($cloudflare.Output)"
    }
    $realtimeStatus = ''
    if ($cloudflareReady) {
        try {
            $publishedManifest = Get-Content -LiteralPath (Join-Path $uploadWorktree 'version-web.json') -Raw -Encoding UTF8 | ConvertFrom-Json
            $rawReady = Wait-GitHubManifest -ExpectedVersion ([string]$publishedManifest.version)
            Publish-WebVersionRealtime -ManifestPath (Join-Path $uploadWorktree 'version-web.json') | Out-Null
            $realtimeStatus = if ($rawReady) {
                "`r`nAviso en tiempo real enviado despues de verificar Cloudflare y GitHub."
            } else {
                "`r`nAviso enviado; GitHub Raw no confirmo a tiempo, pero queda activo el control cada 60 segundos."
            }
        } catch {
            $realtimeStatus = "`r`nCloudflare se actualizo, pero no se pudo enviar el aviso en tiempo real: $($_.Exception.Message)"
        }
    }
    Show-Message -Text ("Version $newVersion subida correctamente.`r`n`r`n" + (($changedFiles | ForEach-Object { "- $_" }) -join "`r`n") + $cloudflareStatus + $realtimeStatus)
} catch {
    Show-Message -Text $_.Exception.Message -Title 'Error al subir' -Icon ([System.Windows.Forms.MessageBoxIcon]::Error)
    $scriptExitCode = 1
} finally {
    if (-not $uploadSucceeded -and $versionOriginals.Count) {
        foreach ($entry in $versionOriginals.GetEnumerator()) {
            [IO.File]::WriteAllBytes([string]$entry.Key, [byte[]]$entry.Value)
        }
    }
    if ($uploadWorktree) {
        & git -C $repoRoot worktree remove --force $uploadWorktree 2>$null | Out-Null
        & git -C $repoRoot worktree prune 2>$null | Out-Null
    }
    if ($dialogOwner) {
        $dialogOwner.Close()
        $dialogOwner.Dispose()
    }
}

exit $scriptExitCode
