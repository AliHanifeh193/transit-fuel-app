param([string]$Root = 'C:\TransitFuel')
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'TransitFuel.psm1')
$config = Get-TransitConfiguration $Root
$result = Invoke-RestMethod -Uri ("http://127.0.0.1:" + $config.Port + "/api/health") -TimeoutSec 5
if ($result.status -ne 'ok') { throw 'Transit Fuel health check failed.' }
$result
