# Local-only diagnostic: temporarily copy a checked password to the Windows clipboard.
# WARNING: Windows clipboard and clipboard history may retain secrets. Use only on trusted local PC.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$secure=$null
$ptr=[IntPtr]::Zero
$plain=$null
try {
  Write-Host 'Clipboard diagnostic: only on trusted local Windows PC. No password reset or database writes.'
  $secure=Read-Host 'Enter your current Transit Fuel administrator password' -AsSecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  $plain=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  $check=($plain | node '.\scripts\check-sandbox-admin-password.cjs' 2>&1) -join [Environment]::NewLine
  if($LASTEXITCODE -ne 0 -or $check -notmatch 'ADMIN_PASSWORD_MATCH:\s*YES') {
    Write-Host 'PASSWORD_VERIFICATION_FAILED — nothing copied.'
    exit 1
  }
  Write-Host 'DATABASE_PASSWORD_MATCH: YES'
  # SetText uses exact Unicode characters; Set-Clipboard can append line breaks.
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.Clipboard]::SetText($plain, [System.Windows.Forms.TextDataFormat]::UnicodeText)
  $clipboardReadback=[System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)
  if(-not [string]::Equals($clipboardReadback,$plain,[System.StringComparison]::Ordinal)) {
    [System.Windows.Forms.Clipboard]::Clear()
    throw 'CLIPBOARD_TEXT_NOT_IDENTICAL'
  }
  Write-Host 'CLIPBOARD_EXACT_MATCH: YES'
  Write-Host ('VERIFIED_PASSWORD_LENGTH: '+$plain.Length)
  Write-Host 'PASSWORD_COPIED_TEMPORARILY. Paste into Firefox password field with Ctrl+V.'
  Write-Host 'In Firefox, check password length shown by input diagnostics before pressing login.'
  Write-Host 'Do NOT copy, paste, or share this password anywhere else.'
  Read-Host 'After pasting into Firefox, return here and press Enter to CLEAR clipboard' | Out-Null
} finally {
  try { [System.Windows.Forms.Clipboard]::Clear() } catch { try { Set-Clipboard -Value '' } catch {} }
  $plain=$null
  if($ptr -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  if($secure){$secure.Dispose()}
  Write-Host 'CLIPBOARD_CLEARED'
}
