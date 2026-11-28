# Isolated Transit Fuel Sandbox: reset only transit-admin password. No production changes.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$adminDb = 'I:\TransitFuel-SMS-Test\data\transit-sms-test.sqlite'
if (!(Test-Path -LiteralPath $adminDb)) { throw 'TEST_DATABASE_NOT_FOUND' }
$secure = $null
$ptr = [IntPtr]::Zero
$plain = $null
try {
    Write-Host 'Reset ONLY local transit-admin account in isolated test database.'
    Write-Host 'Use a NEW 12-128 character ASCII password. It will not be shown or saved to shell history.'
    $secure = Read-Host 'New local test administrator password' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    if ($plain.Length -lt 12 -or $plain.Length -gt 128 -or $plain -cnotmatch '^[\x21-\x7e]+$') {
        throw 'USE_12_TO_128_PRINTABLE_ASCII_CHARACTERS_WITHOUT_SPACES'
    }
    $plain | node '.\scripts\reset-sandbox-admin.cjs'
    if ($LASTEXITCODE -ne 0) { throw 'LOCAL_ADMIN_PASSWORD_RESET_FAILED' }
} finally {
    $plain = $null
    if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    if ($secure) { $secure.Dispose() }
}
