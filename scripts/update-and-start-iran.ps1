# Safe all-in-one update of isolated Transit Fuel SMS Sandbox after Git pull.
# First test + back up, then stop only verified local port 8112 Node server, then restart.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
Write-Host 'TRANSIT_MULTILINGUAL_FINISH_BEGIN'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'finish-iran-prelaunch.ps1')
if ($LASTEXITCODE -ne 0) { throw 'TESTS_OR_BACKUP_FAILED_SERVER_UNCHANGED' }
Write-Host 'PRELAUNCH_VERIFIED_AND_BACKED_UP'
$connections = @(Get-NetTCPConnection -LocalPort 8112 -State Listen -ErrorAction SilentlyContinue)
if ($connections.Count -gt 0) {
    $ids = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
    if ($ids.Count -ne 1) { throw 'PORT_8112_MULTIPLE_PROCESSES_STOP_MANUALLY' }
    $id = [int]$ids[0]
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $id" -ErrorAction Stop
    if (!$process -or $process.Name -ne 'node.exe' -or $process.CommandLine -notmatch 'server[\\/]app\.js') {
        throw 'PORT_8112_NOT_VERIFIED_TRANSIT_NODE_SERVER'
    }
    Write-Host 'STOPPING_VERIFIED_OLD_SANDBOX_PID:' $id
    Stop-Process -Id $id -ErrorAction Stop
    for ($attempt=0; $attempt -lt 30; $attempt++) {
        if (!(Get-NetTCPConnection -LocalPort 8112 -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 200
    }
    if (Get-NetTCPConnection -LocalPort 8112 -State Listen -ErrorAction SilentlyContinue) { throw 'PORT_8112_STILL_OCCUPIED' }
}
Write-Host 'STARTING_UPDATED_IRAN_ONLY_SANDBOX'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-sandbox-iran.ps1')
if ($LASTEXITCODE -ne 0) { throw 'SANDBOX_RESTART_FAILED' }
