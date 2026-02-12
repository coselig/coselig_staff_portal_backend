# deploy.ps1
chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# param([string]$version, [string]$buildNumber)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pubspec = Join-Path $scriptDir "..\coselig_staff_portal_frontend\pubspec.yaml"

if (-not $version) {
    $fullVer = (Select-String -Path $pubspec -Pattern '^version:\s*(\S+)').Matches[0].Groups[1].Value
    $parts = $fullVer -split '\+'
    $version = $parts[0]
    $buildNumber = if ($parts[1]) { $parts[1] } else { 1 }
}

Write-Host "======================================"
Write-Host "Coselig Staff System Auto Deployment"
Write-Host "Version: $version (Build #$buildNumber)"
Write-Host "======================================"

Write-Host ""
Write-Host "[1/4] Building Flutter Frontend..."
$frontendDir = Join-Path $scriptDir "..\coselig_staff_portal_frontend"
Set-Location $frontendDir
$cmd = "flutter build web --release --build-name=$version --build-number=$buildNumber"
Write-Host "Running: $cmd"
& flutter build web --release --build-name=$version --build-number=$buildNumber
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "Step 1 completed"

Write-Host ""
Write-Host "[2/4] Generating asset list..."
$backendDir = 'D:\workspace\coselig_staff_portal_backend'
Set-Location $backendDir
& node upload.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "Asset list generation failed!"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "Step 2 completed"

Write-Host ""
Write-Host "[3/4] Uploading static files to KV..."
$assetsPath = 'D:\workspace\coselig_staff_portal_backend\assets.json'
Write-Host "assetsPath: $assetsPath"
& npx wrangler kv bulk put $assetsPath --namespace-id e7ff4caa1f96456aadc4c1c5bf71b584 --remote
if ($LASTEXITCODE -ne 0) {
    Write-Host "Upload failed!"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "Step 3 completed"

Write-Host ""
Write-Host "[4/4] Deploying Workers..."
& npx wrangler deploy
if ($LASTEXITCODE -ne 0) {
    Write-Host "Deployment failed!"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "Step 4 completed"

Write-Host ""
Write-Host "======================================"
Write-Host "Deployment successful! Version: $version (Build #$buildNumber)"
Write-Host "Access: https://employeeservice.coseligtest.workers.dev"
Write-Host "======================================"

Write-Host ""
Write-Host "Updating version number..."
$nextBuildNumber = [int]$buildNumber + 1
$nextVersion = "$version+$nextBuildNumber"
(Get-Content $pubspec) -replace '^version:\s*\S+', "version: $nextVersion" | Set-Content $pubspec
Write-Host "Next deployment version will be: $nextVersion"

Read-Host "Press Enter to exit"