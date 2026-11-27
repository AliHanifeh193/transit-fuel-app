param(
    [string]$Root = 'C:\TransitFuel',
    [Parameter(Mandatory)][string]$Release,
    [Parameter(Mandatory)][string]$BackupName
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TransitFuel.psm1')
$config = Get-TransitConfiguration $Root
Assert-TransitPortFree $config.Port
if ($Release -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$') { throw 'Invalid release directory.' }
if ($BackupName -cnotmatch '^transit-[0-9]{8}-[0-9]{6}-[0-9]{3}\.sqlite$') { throw 'Invalid backup name.' }
$releaseDir = Join-Path $config.Root ('releases\' + $Release)
$backupDir = Join-Path $config.Root 'backups'
$backup = Join-Path $backupDir $BackupName
foreach ($location in @($releaseDir, $backupDir, $backup, $config.Db)) {
    if ((Get-Item -LiteralPath $location).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Rollback requires separate files and directories. Reparse point found at $location."
    }
}
if (!(Test-Path -LiteralPath (Join-Path $releaseDir 'server\app.js'))) { throw 'Release was not staged.' }
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
$configPath = Join-Path $config.Root 'config.json'
$priorDb = $config.Db + '.prior-' + $stamp
$stagedDb = $config.Db + '.staged-' + $stamp
& $config.Node (Join-Path $config.App 'server\backup.js') $backup $stagedDb
if ($LASTEXITCODE -ne 0) { throw 'The rollback backup could not be verified.' }
$settings = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$settings.release = $Release
$nextConfig = $configPath + '.staged-' + $stamp
$settings | ConvertTo-Json | Set-Content -LiteralPath $nextConfig -Encoding UTF8
foreach ($suffix in @('-wal', '-shm')) {
    if (Test-Path -LiteralPath ($config.Db + $suffix)) {
        throw 'SQLite auxiliary files exist. Verify the process stopped cleanly before rollback.'
    }
}
[System.IO.File]::Replace($stagedDb, $config.Db, $priorDb)
try {
    [System.IO.File]::Replace($nextConfig, $configPath, ($configPath + '.prior-' + $stamp))
} catch {
    [System.IO.File]::Replace($priorDb, $config.Db, ($config.Db + '.failed-' + $stamp))
    throw
}
Write-Output 'Rollback staged. Start Transit Fuel and run its health check manually.'
