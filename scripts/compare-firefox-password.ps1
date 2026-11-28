# Read-only local comparison with browser input. Never share the random token or comparison codes.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$nonceBytes=New-Object byte[] 16
[System.Security.Cryptography.RandomNumberGenerator]::Fill($nonceBytes)
$nonce=[Convert]::ToHexString($nonceBytes).ToLowerInvariant()
Write-Host 'Use this random code in the Firefox comparison field:'
Write-Host "NONCE: $nonce"
$secure=$null
$ptr=[IntPtr]::Zero
$plain=$null
try {
  $secure=Read-Host 'Enter same admin password for local comparison' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $payload=$nonce+"\n"+$plain
  $data=[System.Text.Encoding]::UTF8.GetBytes($payload)
  $hash=[System.Security.Cryptography.SHA256]::HashData($data)
  $fingerprint=[Convert]::ToHexString($hash).Substring(0,16)
  Write-Host "POWERSHELL_PASSWORD_CHECK: $fingerprint"
  Write-Host 'Compare only locally with BROWSER_PASSWORD_CHECK. Do not share codes or passwords.'
} finally {
  $plain=$null
  if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  if($secure){$secure.Dispose()}
}
