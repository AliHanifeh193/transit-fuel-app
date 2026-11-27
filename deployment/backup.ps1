param([string]$Root = 'C:\TransitFuel')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TransitFuel.psm1')
$config = Get-TransitConfiguration $Root
$folder = Join-Path $config.Root 'backups'
if ((Test-Path -LiteralPath $folder) -and ((Get-Item -LiteralPath $folder).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'The backup directory must be independent.'
}
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$backup = Join-Path $folder ('transit-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '.sqlite')
& $config.Node (Join-Path $config.App 'server\backup.js') $config.Db $backup
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed.' }
$backup
