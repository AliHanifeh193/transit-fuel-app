# Transit Fuel — safe production readiness check
# Read-only: no deployment, no SMS sends, no database writes, no secrets printed.
param(
    [string]$PublicUrl = "",
    [string]$TurkeyWebhookUrl = "",
    [string]$IranTemplateId = "",
    [switch]$IranOnly,
    [switch]$CheckWebsite
)
$ErrorActionPreference = 'Stop'
$failed = 0
function Check([string]$name, [bool]$ok, [string]$details) {
    if ($ok) { Write-Host "PASS $name" }
    else { Write-Host "BLOCKED $name : $details"; $script:failed++ }
}
Write-Host 'TRANSIT_FUEL_PRODUCTION_READINESS'
Check 'NODE' ([bool](Get-Command node -ErrorAction SilentlyContinue)) 'Node.js missing'
Check 'PUBLIC_HTTPS_URL' ($PublicUrl -match '^https://[^/]+') 'Public HTTPS website needed'
Check 'SMSIR_LIVE_TEMPLATE' ($IranTemplateId -match '^[1-9][0-9]+$' -and $IranTemplateId -ne '123456') 'Approved real SMS.ir template required; Sandbox 123456 prohibited'
if ($IranOnly) {
    Write-Host 'DEFERRED TURKEY_HTTPS_GATEWAY : Turkey disabled for Iran-only rollout'
} else {
    Check 'TURKEY_HTTPS_GATEWAY' ($TurkeyWebhookUrl -match '^https://[^/]+') 'Separate licensed HTTPS Turkish SMS gateway needed'
}
if ($CheckWebsite -and $PublicUrl -match '^https://[^/]+') {
    try {
        $r = Invoke-WebRequest -Uri $PublicUrl -Method GET -TimeoutSec 12 -MaximumRedirection 3 -UseBasicParsing
        $body = [string]$r.Content
        Check 'PUBLIC_SITE_ACCESSIBLE' ($r.StatusCode -eq 200 -and $body.Length -ge 100) 'Site must return accessible public content'
    } catch {
        Check 'PUBLIC_SITE_ACCESSIBLE' $false 'Public site unavailable or HTTPS invalid'
    }
}
if ($IranOnly) { Write-Host 'IRAN_ONLY: Turkey OTP must remain unavailable; no Turkish users can be onboarded' }
Write-Host 'SANDBOX_KEY_NEVER_USED_FOR_PRODUCTION'
Write-Host 'REAL_SMS_DELIVERY_AND_ROLE_LOGIN_REQUIRE_LATER_VERIFICATION'
Write-Host ('BLOCKERS: ' + $failed)
if ($failed -gt 0) { exit 2 }
Write-Host 'CONFIGURATION_PRECHECK_PASS_ONLY: not a deployment authorization'
