# One-command Iran-only prelaunch verification: no SMS sent, no publication, no secrets read.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
Write-Host 'PRELAUNCH_IRAN_BEGIN'
node --test
if ($LASTEXITCODE -ne 0) { throw 'AUTOMATED_TESTS_FAILED' }
Write-Host 'TESTS_PASS'
$site = Join-Path $root 'public-site\index.html'
$policy = Join-Path $root 'public-site\privacy.html'
if (!(Test-Path $site) -or !(Test-Path $policy)) { throw 'PUBLIC_SITE_FILES_MISSING' }
Write-Host 'PUBLIC_SITE_FILES: READY'
$db = 'I:\TransitFuel-SMS-Test\data\transit-sms-test.sqlite'
$dest = 'I:\TransitFuel-SMS-Test\backups'
if (!(Test-Path $db)) { throw 'ISOLATED_TEST_DB_MISSING' }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
node (Join-Path $root 'scripts\backup-sqlite.cjs') $db $dest
if ($LASTEXITCODE -ne 0) { throw 'SQLITE_BACKUP_FAILED' }
$releaseDir = 'I:\TransitFuel-SMS-Test\releases'
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null
$archive = Join-Path $releaseDir ('transitfuel-prelaunch-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip')
Compress-Archive -Path (Join-Path $root 'public-site\*') -DestinationPath $archive -ErrorAction Stop
Write-Host ('PUBLIC_SITE_ARCHIVE: ' + $archive)
Write-Host ('PUBLIC_SITE_SHA256: ' + (Get-FileHash -Path $archive -Algorithm SHA256).Hash)
Write-Host 'PRODUCTION_BLOCKERS: PUBLIC_DOMAIN_ACTIVATION, APPROVED_SMSIR_LIVE_TEMPLATE, LIVE_DELIVERY_TEST'
Write-Host 'TURKEY: DEFERRED'
Write-Host 'NO_PRODUCTION_DEPLOYMENT_PERFORMED'
Write-Host 'PRELAUNCH_IRAN_RESULT: PASS'
