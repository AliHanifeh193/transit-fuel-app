Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-TransitConfiguration {
    param([string]$Root)
    $resolved = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    if ($resolved -ine 'C:\TransitFuel') { throw 'This deployment is scoped to C:\TransitFuel.' }
    $settings = Get-Content -LiteralPath (Join-Path $resolved 'config.json') -Raw | ConvertFrom-Json
    $port = [int]$settings.port
    if ($port -lt 1024 -or $port -gt 65535) { throw 'Invalid port.' }
    $origin = [Uri]$settings.origin
    if (!$origin.IsAbsoluteUri -or ($origin.Scheme -ne 'https' -and !$origin.IsLoopback)) {
        throw 'HTTPS is required for a non-loopback origin.'
    }
    $release = [string]$settings.release
    if ($release -cnotmatch '^v[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$') { throw 'Invalid release directory.' }
    $app = Join-Path $resolved ('releases\' + $release)
    foreach ($location in @($resolved, (Join-Path $resolved 'releases'), $app, (Join-Path $resolved 'data'), (Join-Path $resolved 'runtime'))) {
        if ((Test-Path -LiteralPath $location) -and ((Get-Item -LiteralPath $location).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "TransitFuel deployment must use independent folders. Reparse point found at $location."
        }
    }
    [pscustomobject]@{
        Root = $resolved
        Port = $port
        Origin = $origin.GetLeftPart([UriPartial]::Authority)
        App = $app
        Node = Join-Path $resolved 'runtime\node.exe'
        Db = Join-Path $resolved 'data\transit.sqlite'
    }
}

function Assert-TransitPortFree {
    param([int]$Port)
    if (Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -EQ $Port) {
        throw "Port $Port already has a listener. Choose an unused port."
    }
}

Export-ModuleMember -Function Get-TransitConfiguration, Assert-TransitPortFree
