# Read-only account check plus one real login attempt against local Transit Fuel port 8112.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$secure=$null
$ptr=[IntPtr]::Zero
$plain=$null
try{
    $secure=Read-Host 'Enter your NEW admin password' -AsSecureString
    $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $plain | node '.\scripts\diagnose-sandbox-admin-login.cjs'
    if($LASTEXITCODE -ne 0){throw 'LOCAL_LOGIN_DIAGNOSTIC_FAILED'}
}finally{
    $plain=$null
    if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
    if($secure){$secure.Dispose()}
}
