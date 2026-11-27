param([string]$Root = 'C:\TransitFuel', [switch]$InitAdmin, [string]$Username, [string]$Name)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TransitFuel.psm1')
$config = Get-TransitConfiguration $Root
$env:TRANSIT_HOST = '127.0.0.1'
$env:TRANSIT_PORT = [string]$config.Port
$env:TRANSIT_ORIGIN = $config.Origin
$env:TRANSIT_DB = $config.Db
$app = Join-Path $config.App 'server\app.js'
if ($InitAdmin) {
    $secret = Read-Host 'Initial administrator password' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
        [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) | & $config.Node $app init-admin $Username $Name
        if ($LASTEXITCODE -ne 0) { throw 'Administrator initialization failed.' }
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $secret.Dispose()
    }
    exit
}
Assert-TransitPortFree $config.Port
& $config.Node $app
if ($LASTEXITCODE -ne 0) { throw "Transit Fuel failed with code $LASTEXITCODE." }
