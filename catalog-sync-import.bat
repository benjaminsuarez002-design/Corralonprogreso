@echo off
setlocal enableextensions

set "SOURCE_FILE=%~2"
set "SYNC_DIR=C:\Update\actualizaciones\Subir Lista Index"
set "TMP_JSON=%TEMP%\articulos_import_%RANDOM%_%RANDOM%.json"
set "SYNC_HOME=%LOCALAPPDATA%\CorralonSync"
set "NPM_PREFIX=%SYNC_HOME%\npm"
set "NPM_CACHE=%SYNC_HOME%\npm-cache"
set "NODE_PATH=%NPM_PREFIX%\node_modules"
set "PARSER=%SYNC_DIR%\parse_excel_to_json.js"
set "SYNC_SCRIPT=%SYNC_DIR%\sync_catalogo_supabase.js"
set "SYNC_CONFIG=%SYNC_DIR%\catalogo-supabase.ini"

if "%SOURCE_FILE%"=="" (
  echo [IMPORT] ERROR: no se recibio el archivo
  exit /b 1
)
if not exist "%SOURCE_FILE%" (
  echo [IMPORT] ERROR: no existe %SOURCE_FILE%
  exit /b 1
)
if not exist "%PARSER%" exit /b 1
if not exist "%SYNC_SCRIPT%" exit /b 1
if not exist "%SYNC_CONFIG%" exit /b 1

where node >nul 2>nul
if errorlevel 1 exit /b 1

if not exist "%SYNC_HOME%" mkdir "%SYNC_HOME%"
if not exist "%NPM_PREFIX%" mkdir "%NPM_PREFIX%"
if not exist "%NPM_CACHE%" mkdir "%NPM_CACHE%"
if not exist "%NPM_PREFIX%\package.json" (
  > "%NPM_PREFIX%\package.json" echo {}
)
if not exist "%NPM_PREFIX%\node_modules\xlsx\package.json" (
  call npm --prefix "%NPM_PREFIX%" --cache "%NPM_CACHE%" --no-audit --no-fund install xlsx
  if errorlevel 1 exit /b 1
)

echo [IMPORT] Parseando archivo...
node "%PARSER%" --excel "%SOURCE_FILE%" --out "%TMP_JSON%"
if errorlevel 1 (
  if exist "%TMP_JSON%" del /f /q "%TMP_JSON%" >nul 2>nul
  exit /b 1
)

echo [IMPORT] Sincronizando catalogo completo...
node "%SYNC_SCRIPT%" --json "%TMP_JSON%" --excel "%SOURCE_FILE%" --config "%SYNC_CONFIG%" --full
if errorlevel 1 (
  if exist "%TMP_JSON%" del /f /q "%TMP_JSON%" >nul 2>nul
  exit /b 1
)

if exist "%TMP_JSON%" del /f /q "%TMP_JSON%" >nul 2>nul
echo [IMPORT] FINALIZADO OK
exit /b 0
