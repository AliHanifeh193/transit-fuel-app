# Local-only evaluation launcher. No system service or global configuration changes.
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$port=8124
$origin="http://127.0.0.1:$port"
$local=[Environment]::GetFolderPath('LocalApplicationData')
if([string]::IsNullOrWhiteSpace($local)){throw 'LOCAL_APP_DATA_UNAVAILABLE'}
$dataDir=Join-Path $local 'TransitFuel-Evaluation'
$db=Join-Path $dataDir 'evaluation.sqlite'
$node=Get-Command node.exe -ErrorAction SilentlyContinue
if(!$node){throw 'NODE_24_REQUIRED: Install official Node.js 24 LTS.'}
$version=& $node.Source --version
if($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.'){throw "NODE_24_REQUIRED: Detected $version"}
if(!(Test-Path -LiteralPath (Join-Path $root 'server\app.js'))){throw 'APP_FILES_MISSING'}
if(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue){throw 'PORT_8124_BUSY: No other process modified.'}
New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
$env:TRANSIT_HOST='127.0.0.1'
$env:TRANSIT_PORT=[string]$port
$env:TRANSIT_ORIGIN=$origin
$env:TRANSIT_DB=$db
$env:TRANSIT_AUTH_MODE='password'
foreach($key in @('TRANSIT_SMS_PROVIDER','TRANSIT_SMS_ENV','TRANSIT_SMSIR_API_KEY','TRANSIT_SMSIR_TEMPLATE_ID','TRANSIT_SANDBOX_SHOW_OTP','TRANSIT_SMS_WEBHOOK_TOKEN','TRANSIT_SMS_WEBHOOK_URL')){
  Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue
}
Write-Host 'TRANSIT_FUEL_EVALUATION_ONLY'
Write-Host "URL: $origin"
Write-Host "DATA_DIRECTORY: $dataDir"
Write-Host 'No SMS. Manager browser sign-in is not yet validated.'
Write-Host 'Keep this window open; Ctrl+C stops the local server.'
Start-Process $origin
& $node.Source (Join-Path $root 'server\app.js')
if($LASTEXITCODE -ne 0){throw "EVALUATION_SERVER_EXITED: $LASTEXITCODE"}
