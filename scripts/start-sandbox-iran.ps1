# Start isolated Transit Fuel Sandbox after Windows reboot. No auto-start, no production deployment.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$db = 'I:\TransitFuel-SMS-Test\data\transit-sms-test.sqlite'
if (!(Test-Path $db)) { throw 'ISOLATED_TEST_DB_MISSING' }
$listen = Get-NetTCPConnection -LocalPort 8112 -State Listen -ErrorAction SilentlyContinue
if ($listen) {
    Write-Host 'PORT_8112_IN_USE: Nothing started or stopped'
    exit 1
}
$env:TRANSIT_DB = $db
$env:TRANSIT_PORT = '8112'
$env:TRANSIT_HOST = '127.0.0.1'
$env:TRANSIT_ORIGIN = 'http://localhost:8112'
$env:TRANSIT_AUTH_MODE = 'sms'
$env:TRANSIT_SMS_PROVIDER = 'smsir'
$env:TRANSIT_SMS_ENV = 'sandbox'
$env:TRANSIT_COUNTRY_SCOPE = 'iran'
$env:TRANSIT_SMSIR_TEMPLATE_ID = '123456'
$env:TRANSIT_SMSIR_PARAMETER = 'Code'
$secure = $null
$p = [IntPtr]::Zero
try {
    $secure = Read-Host 'Paste SMS.ir Sandbox API Key' -AsSecureString
    $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $env:TRANSIT_SMSIR_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)
    if ($env:TRANSIT_SMSIR_API_KEY.Length -lt 8 -or $env:TRANSIT_SMSIR_API_KEY -match '[\x00-\x1F\x7F]') {
        throw 'INVALID_API_KEY_INPUT'
    }
    Write-Host 'SANDBOX_SERVER_STARTING: http://localhost:8112'
    Write-Host 'Close this PowerShell window or press Ctrl+C to stop the server'
    node .\server\app.js
    if ($LASTEXITCODE -ne 0) { throw 'SERVER_EXITED_WITH_ERROR' }
}
finally {
    Remove-Item Env:\TRANSIT_SMSIR_API_KEY -ErrorAction SilentlyContinue
    if ($p -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
    if ($secure) { $secure.Dispose() }
}
