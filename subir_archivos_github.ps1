Add-Type -AssemblyName System.Windows.Forms

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Show-Message {
    param(
        [string]$Text,
        [string]$Title = 'Subir a GitHub',
        [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
    )
    [System.Windows.Forms.MessageBox]::Show(
        $Text,
        $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        $Icon
    ) | Out-Null
}

function Run-Git {
    param(
        [string[]]$Arguments,
        [string]$WorkingDirectory = $repoRoot,
        [switch]$AllowFailure
    )

    $previousErrorAction = $ErrorActionPreference
    try {
        # Git envia mensajes normales de fetch/push por stderr. No deben tratarse
        # como excepciones: el resultado real lo determina su codigo de salida.
        $ErrorActionPreference = 'Continue'
        $output = & git -C $WorkingDirectory @Arguments 2>&1 | Out-String
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

$uploadWorktree = $null
$scriptExitCode = 0

try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Git no esta instalado o no se encuentra en PATH.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot '.git'))) {
        throw "No encontre el repositorio Git en:`r`n$repoRoot"
    }

    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Elegir archivos para subir a Corralonprogreso'
    $dialog.Filter = 'Archivos del sistema (*.html;*.js;*.css;*.json;*.txt)|*.html;*.js;*.css;*.json;*.txt|Todos los archivos (*.*)|*.*'
    $dialog.Multiselect = $true
    $dialog.CheckFileExists = $true
    $dialog.RestoreDirectory = $true

    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        return
    }

    $selectedFiles = @($dialog.FileNames)
    $duplicateNames = $selectedFiles |
        Group-Object { [System.IO.Path]::GetFileName($_) } |
        Where-Object Count -gt 1
    if ($duplicateNames) {
        $names = ($duplicateNames | ForEach-Object Name) -join "`r`n"
        throw "Elegiste archivos distintos con el mismo nombre:`r`n$names`r`n`r`nDeja solamente uno de cada nombre."
    }

    $fileNames = $selectedFiles | ForEach-Object { [System.IO.Path]::GetFileName($_) }
    $confirmationText = "Se subiran solamente estos archivos a la rama main:`r`n`r`n" +
        (($fileNames | ForEach-Object { "- $_" }) -join "`r`n") +
        "`r`n`r`nDespues se subiran a la rama main. ¿Continuar?"
    $answer = [System.Windows.Forms.MessageBox]::Show(
        $confirmationText,
        'Confirmar subida',
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) {
        return
    }

    Run-Git -Arguments @('fetch', 'origin', 'main') | Out-Null
    $uploadWorktree = Join-Path ([System.IO.Path]::GetTempPath()) ("corralon-github-upload-" + [System.Guid]::NewGuid().ToString('N'))
    Run-Git -Arguments @('worktree', 'add', '--detach', $uploadWorktree, 'origin/main') | Out-Null

    foreach ($source in $selectedFiles) {
        $name = [System.IO.Path]::GetFileName($source)
        $destination = Join-Path $uploadWorktree $name
        $sourceFull = [System.IO.Path]::GetFullPath($source)
        $destinationFull = [System.IO.Path]::GetFullPath($destination)
        if (-not [string]::Equals($sourceFull, $destinationFull, [System.StringComparison]::OrdinalIgnoreCase)) {
            [System.IO.File]::Copy($sourceFull, $destinationFull, $true)
        }
    }

    Run-Git -WorkingDirectory $uploadWorktree -Arguments (@('add', '--') + $fileNames) | Out-Null
    $staged = Run-Git -WorkingDirectory $uploadWorktree -Arguments (@('diff', '--cached', '--quiet', '--') + $fileNames) -AllowFailure
    if ($staged.ExitCode -eq 0) {
        Show-Message -Text 'Los archivos elegidos no tienen cambios para subir.'
        return
    }
    if ($staged.ExitCode -ne 1) {
        throw "No pude comprobar los cambios seleccionados:`r`n$($staged.Output)"
    }

    $message = 'Actualizar archivos ' + (Get-Date -Format 'yyyy-MM-dd HH:mm')
    Run-Git -WorkingDirectory $uploadWorktree -Arguments @('commit', '-m', $message) | Out-Null

    $push = Run-Git -WorkingDirectory $uploadWorktree -Arguments @('push', 'origin', 'HEAD:main') -AllowFailure
    if ($push.ExitCode -ne 0) {
        throw "El commit se creo, pero GitHub rechazo la subida:`r`n$($push.Output)"
    }

    Show-Message -Text ("Subida completada correctamente.`r`n`r`n" + (($fileNames | ForEach-Object { "- $_" }) -join "`r`n"))
} catch {
    Show-Message -Text $_.Exception.Message -Title 'Error al subir' -Icon ([System.Windows.Forms.MessageBoxIcon]::Error)
    $scriptExitCode = 1
} finally {
    if ($uploadWorktree) {
        & git -C $repoRoot worktree remove --force $uploadWorktree 2>$null | Out-Null
        & git -C $repoRoot worktree prune 2>$null | Out-Null
    }
}

exit $scriptExitCode
