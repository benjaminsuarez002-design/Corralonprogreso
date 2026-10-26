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
    $pageFields = @{}
    foreach ($entry in $manifest.paginas.PSObject.Properties) {
        $fields = @{}
        foreach ($field in @('nombre','version','ultimo_cambio','actualizado','prioridad')) {
            $fields[$field] = @{ stringValue = [string]$entry.Value.$field }
        }
        $pageFields[$entry.Name] = @{ mapValue = @{ fields = $fields } }
    }
    $payload = @{
        fields = @{
            version = @{ stringValue = [string]$manifest.version }
            prioridad = @{ stringValue = [string]$manifest.prioridad }
            mensaje = @{ stringValue = [string]$manifest.mensaje }
            publicado = @{ stringValue = [string]$manifest.publicado }
            actualizado_en = @{ timestampValue = (Get-Date).ToUniversalTime().ToString('o') }
            paginas = @{ mapValue = @{ fields = $pageFields } }
        }
    } | ConvertTo-Json -Depth 12
    # Actualiza solo estos campos para conservar el mapa de prioridades que se
    # administra desde el historial de versiones del menu.
    $url = 'https://firestore.googleapis.com/v1/projects/corralon-progreso/databases/(default)/documents/configuracion/version_web?key=AIzaSyCxwUGX-rVusOI13j7oTfQuAtkeNXdAYH0' +
        '&updateMask.fieldPaths=version' +
        '&updateMask.fieldPaths=prioridad' +
        '&updateMask.fieldPaths=mensaje' +
        '&updateMask.fieldPaths=publicado' +
        '&updateMask.fieldPaths=actualizado_en' +
        '&updateMask.fieldPaths=paginas'
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
        $ExpectedPages = $null,
        [int]$TimeoutSeconds = 30
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            $manifest = Invoke-RestMethod -Uri ("https://raw.githubusercontent.com/benjaminsuarez002-design/Corralonprogreso/main/version-web.json?t=" + $stamp) -Method Get -TimeoutSec 10
            $matches = [string]$manifest.version -eq [string]$ExpectedVersion
            if ($ExpectedPages) {
                foreach ($page in $ExpectedPages.PSObject.Properties) {
                    if ([string]$manifest.paginas.($page.Name).version -ne [string]$page.Value.version) { $matches = $false; break }
                }
            }
            if ($matches) { return $true }
        } catch {}
        Start-Sleep -Milliseconds 1200
    } while ((Get-Date) -lt $deadline)

    return $false
}

function ConvertTo-PageKey {
    param([string]$FileName)
    $value = ([System.IO.Path]::GetFileNameWithoutExtension($FileName)).ToLowerInvariant().Replace(' ', '-')
    if ($value -eq 'gestion') { return 'facturacion' }
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

function Get-ModifiedUploadPaths {
    param([string]$Root, $Baseline)
    $published = @{}
    foreach ($entry in @($Baseline.files)) { $published[[string]$entry.path] = [string]$entry.hash }
    $paths = @($published.Keys)
    $tracked = Run-Git -WorkingDirectory $Root -Arguments @('-c', 'core.quotepath=false', 'ls-files')
    $paths += @($tracked.Output -split "`r?`n" | Where-Object { $_ })
    $paths += @(Get-ChildItem -LiteralPath $Root -File | ForEach-Object Name)
    foreach ($folder in @('assets','vendor','tests','tools','supabase')) {
        $directory = Join-Path $Root $folder
        if (Test-Path -LiteralPath $directory) {
            $paths += @(Get-ChildItem -LiteralPath $directory -File -Recurse | ForEach-Object { $_.FullName.Substring($Root.Length).TrimStart([char[]]@('\','/')).Replace('\','/') })
        }
    }
    foreach ($path in @($paths | Sort-Object -Unique)) {
        $path = $path.Replace('\','/')
        if ($path -match '\.(new|next)\.exe$') { continue }
        if ($path -eq 'actualizacion-version.json' -or $path -match '(^|/)(\.git|node_modules|\.codex[^/]*|\.wrangler|servidor|tmp|output|outputs|access_export)(/|$)|(^|/)\.env|\.private\.|api-key|service.?account|credentials|\.bak(\.|$)|\.(log|bin|pfx|p12|mdb|accdb)$') { continue }
        $full = Join-Path $Root $path
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { if ($published.ContainsKey($path)) { $path }; continue }
        if (-not $published.ContainsKey($path) -and [IO.Path]::GetExtension($path) -notmatch '^\.(html|js|mjs|cjs|css|json|txt|ps1|cs|sql|svg|png|jpg|jpeg|webp|ico|woff2?|toml|md)$') { continue }
        if (-not $published.ContainsKey($path) -or (Get-Sha256Hash -Path $full) -ne $published[$path]) { $path }
    }
}

function Show-VersionDetailsDialog {
    param([string[]]$HtmlFiles, $Manifest, [string[]]$UploadFiles)
    $form = New-Object Windows.Forms.Form
    $form.Text = 'Datos de la actualizacion'
    $form.Width = 600
    $form.Height = 550
    $form.FormBorderStyle = [Windows.Forms.FormBorderStyle]::FixedDialog
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.StartPosition = [Windows.Forms.FormStartPosition]::CenterScreen
    $form.TopMost = $true

    $label = New-Object Windows.Forms.Label
    $label.Left = 16; $label.Top = 14; $label.Width = 550
    $label.Text = "Archivos que se subiran: $($UploadFiles.Count) (incluye eliminaciones y dependencias)"
    $list = New-Object Windows.Forms.TextBox
    $list.Left = 16; $list.Top = 38; $list.Width = 550; $list.Height = 245
    $list.Multiline = $true; $list.ReadOnly = $true; $list.ScrollBars = 'Vertical'
    $versionLines = foreach ($file in $HtmlFiles) {
        $key = ConvertTo-PageKey $file
        $property = $Manifest.paginas.PSObject.Properties[$key]
        if ($property) { "$(Split-Path $file -Leaf): $($property.Value.version) -> $(Get-NextPageVersion $property.Value.version)" }
        else { "$(Split-Path $file -Leaf): nueva pagina -> 0.0.1" }
    }
    $fileLines = foreach ($path in $UploadFiles) {
        $prefix = if (Test-Path -LiteralPath (Join-Path $repoRoot $path) -PathType Leaf) { 'SUBIR' } else { 'ELIMINAR' }
        "$prefix  $path"
    }
    $list.Text = (@($fileLines) + @('', 'Paginas que cambiaran de version:') + @($versionLines)) -join "`r`n"

    $changeLabel = New-Object Windows.Forms.Label
    $changeLabel.Left = 16; $changeLabel.Top = 294; $changeLabel.Width = 550
    $changeLabel.Text = '¿Que se actualizo?'
    $change = New-Object Windows.Forms.TextBox
    $change.Left = 16; $change.Top = 317; $change.Width = 550; $change.Height = 70; $change.Multiline = $true
    $priorityLabel = New-Object Windows.Forms.Label
    $priorityLabel.Left = 16; $priorityLabel.Top = 400; $priorityLabel.Width = 85; $priorityLabel.Text = 'Importancia:'
    $priority = New-Object Windows.Forms.ComboBox
    $priority.Left = 105; $priority.Top = 396; $priority.Width = 170; $priority.DropDownStyle = 'DropDownList'
    [void]$priority.Items.AddRange(@('Normal', 'Recomendada', 'Importante')); $priority.SelectedIndex = 0
    $upload = New-Object Windows.Forms.Button
    $upload.Text = 'Subir'; $upload.Left = 374; $upload.Top = 446; $upload.Width = 92; $upload.DialogResult = 'OK'
    $cancel = New-Object Windows.Forms.Button
    $cancel.Text = 'Cancelar'; $cancel.Left = 474; $cancel.Top = 446; $cancel.Width = 92; $cancel.DialogResult = 'Cancel'
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
        if (-not $property) {
            $pageName = [IO.Path]::GetFileNameWithoutExtension($file)
            $manifest.paginas | Add-Member -NotePropertyName $key -NotePropertyValue ([pscustomobject]@{nombre=$pageName;version='0.0.0';ultimo_cambio='';actualizado='';prioridad='normal'})
            $property = $manifest.paginas.PSObject.Properties[$key]
        }
        $page = $property.Value
        $next = Get-NextPageVersion ([string]$page.version)
        $page.version = $next
        $page.ultimo_cambio = $Change
        $page.actualizado = Get-Date -Format 'dd/MM/yyyy'
        $page | Add-Member -NotePropertyName prioridad -NotePropertyValue $Priority -Force
        $html = [IO.File]::ReadAllText($file)
        $html = [Text.RegularExpressions.Regex]::Replace($html, '(corralon-system\.js\?v=)\d+\.\d+\.\d+', "`${1}$next", 1)
        $html = [Text.RegularExpressions.Regex]::Replace($html, '(corralon-system\.js)(["''])', ('${1}?v=' + $next + '${2}'), 1)
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

    $baselinePath = Join-Path $repoRoot 'actualizacion-version.json'
    if (-not (Test-Path -LiteralPath $baselinePath -PathType Leaf)) { throw 'No encontre actualizacion-version.json.' }
    $baseline = Get-Content -LiteralPath $baselinePath -Raw -Encoding UTF8 | ConvertFrom-Json
    $automaticFiles = @(Get-ModifiedUploadPaths -Root $repoRoot -Baseline $baseline)
    $confirmationText = "Se detectaron $($automaticFiles.Count) archivos nuevos, modificados o eliminados respecto de la ultima publicacion (comparacion por contenido).`r`n`r`n¿Seleccionarlos todos automaticamente? Vas a ver la lista completa antes de subir."
    $answer = [System.Windows.Forms.MessageBox]::Show(
        $dialogOwner,
        $confirmationText,
        'Subida automatica',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    if ($answer -eq [System.Windows.Forms.DialogResult]::Yes) {
        if (-not $automaticFiles.Count) {
            Show-Message -Text 'No hay cambios respecto de la ultima publicacion.'
            return
        }
        $selectedFiles = @($automaticFiles | ForEach-Object { Join-Path $repoRoot $_ })
    } else {
        $dialog = New-Object System.Windows.Forms.OpenFileDialog
        $dialog.Title = 'Elegir archivos para subir a Corralonprogreso'
        $dialog.InitialDirectory = $repoRoot
        $dialog.Filter = 'Archivos del sistema (*.html;*.js;*.css;*.json;*.txt)|*.html;*.js;*.css;*.json;*.txt|Todos los archivos (*.*)|*.*'
        $dialog.Multiselect = $true
        $dialog.CheckFileExists = $true
        $dialog.RestoreDirectory = $true
        if ($dialog.ShowDialog($dialogOwner) -ne [System.Windows.Forms.DialogResult]::OK) { return }
        $selectedFiles = @($dialog.FileNames)
    }

    $relativeFiles = @($selectedFiles | ForEach-Object {
        $fullPath = [IO.Path]::GetFullPath($_)
        if (-not $fullPath.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "El archivo debe estar dentro de Corralonprogreso-main:`r`n$fullPath"
        }
        $fullPath.Substring($repoRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
    } | Sort-Object -Unique)
    $pedidoShareFiles = @('pedidos.html', 'pedido-compartido.html', 'cloudflare-worker.js', 'wrangler.jsonc', '.assetsignore')
    if (@($relativeFiles | Where-Object { $pedidoShareFiles -contains $_ }).Count) {
        foreach ($dependency in $pedidoShareFiles) {
            if ((Test-Path -LiteralPath (Join-Path $repoRoot $dependency) -PathType Leaf) -and $relativeFiles -notcontains $dependency) {
                $relativeFiles += $dependency
            }
        }
        $relativeFiles = @($relativeFiles | Sort-Object -Unique)
    }
    $catalogoVersionFiles = @('corralon-system.js', 'catalogo-realtime-worker.js', 'catalogo-version-publish.js')
    if (@($relativeFiles | Where-Object { $catalogoVersionFiles -contains $_ -or $_ -eq 'soloadmin.html' }).Count) {
        foreach ($dependency in $catalogoVersionFiles) {
            if ((Test-Path -LiteralPath (Join-Path $repoRoot $dependency) -PathType Leaf) -and $relativeFiles -notcontains $dependency) {
                $relativeFiles += $dependency
            }
        }
        $relativeFiles = @($relativeFiles | Sort-Object -Unique)
    }
    # Index y su tema deben publicarse junto con las imágenes que utilizan.
    if ($relativeFiles -contains 'index.html' -or $relativeFiles -contains 'theme-corralon.css') {
        $indexThemeFiles = @('theme-corralon.css', 'assets/halloween/hero-halloween.png', 'assets/halloween/fondo-index-halloween.png', 'assets/halloween/categorias-halloween-ceramico.png')
        foreach ($dependency in $indexThemeFiles) {
            if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $dependency) -PathType Leaf)) {
                throw "Falta una imagen o archivo del tema de Index: $dependency. No se publicó la actualización."
            }
            if ($relativeFiles -notcontains $dependency) { $relativeFiles += $dependency }
        }
        $relativeFiles = @($relativeFiles | Sort-Object -Unique)
    }

    # Los cambios en JS/CSS compartidos tambien actualizan las paginas que los usan.
    $dependencies = @($relativeFiles | Where-Object { $_ -match '\.(js|css)$' })
    foreach ($pageFile in @(Get-ChildItem -LiteralPath $repoRoot -Filter '*.html' -File)) {
        if ($pageFile.Name -match ' - copia|\(\d+\)|-reference') { continue }
        $source = [IO.File]::ReadAllText($pageFile.FullName)
        foreach ($dependency in $dependencies) {
            if ($source.Contains($dependency) -and $relativeFiles -notcontains $pageFile.Name) { $relativeFiles += $pageFile.Name; break }
        }
    }
    $relativeFiles = @($relativeFiles | Where-Object { $_ -notmatch '\.(new|next)\.exe$' } | Sort-Object -Unique)
    $htmlFiles = @($relativeFiles | Where-Object { $_ -match '^[^/]+\.html$' -and $_ -notmatch ' - copia|\(\d+\)|-reference' } | ForEach-Object { Join-Path $repoRoot $_ } | Where-Object { Test-Path -LiteralPath $_ })
    $manifestSource = Join-Path $repoRoot 'version-web.json'
    $manifestForDialog = Get-Content -LiteralPath $manifestSource -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($htmlFiles.Count -and $relativeFiles -notcontains 'version-web.json') { $relativeFiles += 'version-web.json' }
    $displayFiles = @($relativeFiles) + @('actualizacion-version.json')
    $versionDetails = Show-VersionDetailsDialog -HtmlFiles $htmlFiles -Manifest $manifestForDialog -UploadFiles $displayFiles
    if (-not $versionDetails) { return }
    if ($htmlFiles.Count) {
        if (-not (Test-Path -LiteralPath $manifestSource)) { throw 'No encontre version-web.json.' }
        foreach ($versionFile in @($htmlFiles) + @($manifestSource)) {
            $versionOriginals[$versionFile] = [IO.File]::ReadAllBytes($versionFile)
        }
        Update-PageVersions -HtmlFiles $htmlFiles -Change $versionDetails.Change -Priority $versionDetails.Priority
        if ($relativeFiles -notcontains 'version-web.json') { $relativeFiles += 'version-web.json' }
    }

    $fileNames = @($relativeFiles)
    Run-Git -Arguments @('fetch', 'origin', 'main') | Out-Null
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

    # Una ruta de la referencia local puede no existir tampoco en origin/main.
    # Omitirla evita un pathspec invalido; conservar las eliminaciones registradas.
    $uploadTracked = Run-Git -WorkingDirectory $uploadWorktree -Arguments @('-c', 'core.quotepath=false', 'ls-files')
    $uploadTrackedPaths = @($uploadTracked.Output -split "`r?`n" | Where-Object { $_ })
    $fileNames = @($fileNames | Where-Object {
        (Test-Path -LiteralPath (Join-Path $uploadWorktree $_) -PathType Leaf) -or
        ($uploadTrackedPaths -contains $_)
    })
    if (-not $fileNames.Count) {
        Show-Message -Text 'Los archivos elegidos ya no existen ni estan registrados en GitHub. No hay cambios para subir.'
        return
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
        if (-not (Test-Path -LiteralPath $fullChangedPath -PathType Leaf)) {
            [void]$fileMap.Remove($normalizedPath)
            continue
        }
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
            $rawReady = Wait-GitHubManifest -ExpectedVersion ([string]$publishedManifest.version) -ExpectedPages $publishedManifest.paginas
            Publish-WebVersionRealtime -ManifestPath (Join-Path $uploadWorktree 'version-web.json') | Out-Null
            $realtimeStatus = if ($rawReady) {
                "`r`nAviso en tiempo real enviado despues de verificar Cloudflare y GitHub."
            } else {
                "`r`nAviso Firebase enviado con las versiones publicadas. GitHub Raw aun no confirmo su cache. Sin sondeo periodico."
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
