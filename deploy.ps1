# deploy.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Optional overrides:
# $env:VERSION = "0.4.0"
# $env:VERSION_BUMP = "auto"   # auto|major|minor|patch|none
# $env:WRANGLER_VERSION = "latest"
# $env:FRONTEND_DIR = "..\coselig_staff_portal_frontend"
# $env:DEPLOY_BASE_URL = "https://employeeservice.coseligtest.workers.dev"
# $env:KV_NAMESPACE_ID = "..."

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = $ScriptDir
$RulesFile = Join-Path $ScriptDir 'conventional_commit_rules.sh'
$WranglerConfig = Join-Path $BackendDir 'wrangler.jsonc'
$UploadScript = Join-Path $BackendDir 'upload.js'
$AssetsPath = Join-Path $BackendDir 'assets.json'
$DefaultDeployBaseUrl = 'https://employeeservice.coseligtest.workers.dev'
$RequestedVersion = if ($env:VERSION) { $env:VERSION } else { '' }
$RequestedVersionBump = if ($env:VERSION_BUMP) { $env:VERSION_BUMP } else { 'auto' }
$WranglerVersion = if ($env:WRANGLER_VERSION) { $env:WRANGLER_VERSION } else { 'latest' }

function Resolve-AbsolutePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }

    return [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $PathValue))
}

function Convert-RuleToken {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Token
    )

    $trimmed = $Token.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return ''
    }

    if (($trimmed.StartsWith('"') -and $trimmed.EndsWith('"')) -or ($trimmed.StartsWith("'") -and $trimmed.EndsWith("'"))) {
        return $trimmed.Substring(1, $trimmed.Length - 2)
    }

    return $trimmed
}

function Get-BashArray {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return @()
    }

    $items = @()
    $insideArray = $false

    foreach ($line in Get-Content $Path) {
        if (-not $insideArray) {
            if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*\(\s*$") {
                $insideArray = $true
            }
            continue
        }

        if ($line -match '^\s*\)\s*$') {
            break
        }

        $value = Convert-RuleToken -Token $line
        if (-not [string]::IsNullOrWhiteSpace($value)) {
            $items += $value
        }
    }

    return $items
}

$CcMinorTypes = @(Get-BashArray -Name 'CC_MINOR_TYPES' -Path $RulesFile)
if ($CcMinorTypes.Count -eq 0) {
    $CcMinorTypes = @('feat')
}

$CcPatchTypes = @(Get-BashArray -Name 'CC_PATCH_TYPES' -Path $RulesFile)
if ($CcPatchTypes.Count -eq 0) {
    $CcPatchTypes = @('fix', 'perf', 'refactor')
}

$CcNoneTypes = @(Get-BashArray -Name 'CC_NONE_TYPES' -Path $RulesFile)
if ($CcNoneTypes.Count -eq 0) {
    $CcNoneTypes = @('docs', 'test', 'build', 'ci', 'chore', 'style', 'revert')
}

$CcVersionIgnoredPaths = @(Get-BashArray -Name 'CC_VERSION_IGNORED_PATHS' -Path $RulesFile)
$CcVersionMinorPaths = @(Get-BashArray -Name 'CC_VERSION_MINOR_PATHS' -Path $RulesFile)
$CcVersionPatchPaths = @(Get-BashArray -Name 'CC_VERSION_PATCH_PATHS' -Path $RulesFile)

function Get-VersionBumpRank {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Bump
    )

    switch ($Bump) {
        'none' { return 0 }
        'patch' { return 1 }
        'minor' { return 2 }
        'major' { return 3 }
        'manual' { return 4 }
        default { return 0 }
    }
}

function Get-MaxVersionBump {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Left,
        [Parameter(Mandatory = $true)]
        [string]$Right
    )

    if ((Get-VersionBumpRank -Bump $Right) -gt (Get-VersionBumpRank -Bump $Left)) {
        return $Right
    }

    return $Left
}

function Normalize-VersionBump {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Bump
    )

    switch ($Bump) {
        'auto' { return 'auto' }
        'major' { return 'major' }
        'minor' { return 'minor' }
        'patch' { return 'patch' }
        'none' { return 'none' }
        default { throw "Unsupported VERSION_BUMP: $Bump" }
    }
}

function Test-Semver {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version
    )

    return $Version -match '^\d+\.\d+\.\d+$'
}

function Get-BumpedSemver {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Version,
        [Parameter(Mandatory = $true)]
        [string]$Bump
    )

    if (-not (Test-Semver -Version $Version)) {
        throw "Invalid semver version: $Version"
    }

    $parts = $Version.Split('.')
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    switch ($Bump) {
        'major' {
            $major += 1
            $minor = 0
            $patch = 0
        }
        'minor' {
            $minor += 1
            $patch = 0
        }
        'patch' {
            $patch += 1
        }
        'none' { }
        default { throw "Unsupported semver bump: $Bump" }
    }

    return "$major.$minor.$patch"
}

function Resolve-GitRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Directory
    )

    try {
        $result = (& git -C $Directory rev-parse --show-toplevel 2>$null)
        if ($LASTEXITCODE -eq 0) {
            return ($result -join "`n").Trim()
        }
    } catch { }

    return ''
}

function Resolve-FrontendDir {
    if ($env:FRONTEND_DIR) {
        $explicitDir = Resolve-AbsolutePath -PathValue $env:FRONTEND_DIR
        if (Test-Path (Join-Path $explicitDir 'pubspec.yaml')) {
            return $explicitDir
        }

        throw "FRONTEND_DIR does not contain pubspec.yaml: $explicitDir"
    }

    $parentDir = Split-Path -Parent $ScriptDir
    $backendName = Split-Path -Leaf $ScriptDir
    $candidates = @(
        (Join-Path $parentDir 'front')
    )

    if ($backendName.EndsWith('_backend')) {
        $candidates += (Join-Path $parentDir ($backendName.Substring(0, $backendName.Length - 8) + '_frontend'))
    }

    if ($backendName.EndsWith('-backend')) {
        $candidates += (Join-Path $parentDir ($backendName.Substring(0, $backendName.Length - 8) + '-frontend'))
    }

    if ($backendName.EndsWith('_back')) {
        $candidates += (Join-Path $parentDir ($backendName.Substring(0, $backendName.Length - 5) + '_front'))
    }

    $candidates += Get-ChildItem -Path $parentDir -Directory |
        Where-Object { $_.FullName -ne $ScriptDir -and $_.Name -match 'front|frontend' } |
        Select-Object -ExpandProperty FullName

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path (Join-Path $candidate 'pubspec.yaml'))) {
            return $candidate
        }
    }

    throw 'Unable to locate Flutter frontend directory. Set FRONTEND_DIR or place the app in a sibling frontend repo / ..\front.'
}

function Read-PubspecVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PubspecPath
    )

    foreach ($line in Get-Content $PubspecPath) {
        if ($line -match '^version:\s*(\S+)') {
            return $Matches[1]
        }
    }

    return ''
}

function Resolve-VersionAnchorEpoch {
    $gitRoot = Resolve-GitRoot -Directory $FrontendDir
    if (-not $gitRoot) {
        return ''
    }

    try {
        $result = (& git -C $gitRoot log -n 1 --format=%ct -- pubspec.yaml 2>$null)
        if ($LASTEXITCODE -eq 0) {
            return ($result -join "`n").Trim()
        }
    } catch { }

    return ''
}

function Test-ArrayContains {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Needle,
        [Parameter(Mandatory = $true)]
        [string[]]$Items
    )

    return $Items -contains $Needle
}

function Get-CommitMessageVersionBump {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Subject,
        [Parameter(Mandatory = $true)]
        [string]$Body
    )

    $match = [regex]::Match($Subject, '^(?<type>[A-Za-z]+)(\([^)]+\))?(?<breaking>!)?:\s')
    if (-not $match.Success) {
        return 'none'
    }

    $type = $match.Groups['type'].Value.ToLowerInvariant()
    $breaking = $match.Groups['breaking'].Success

    if ($breaking -or $Body.Contains('BREAKING CHANGE:') -or $Body.Contains('BREAKING-CHANGE:')) {
        return 'major'
    }

    if (Test-ArrayContains -Needle $type -Items $CcMinorTypes) {
        return 'minor'
    }

    if (Test-ArrayContains -Needle $type -Items $CcPatchTypes) {
        return 'patch'
    }

    if (Test-ArrayContains -Needle $type -Items $CcNoneTypes) {
        return 'none'
    }

    return 'none'
}

function Get-RepoCommitVersionBump {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoDir,
        [Parameter(Mandatory = $false)]
        [string]$SinceEpoch
    )

    $gitRoot = Resolve-GitRoot -Directory $RepoDir
    if (-not $gitRoot -or -not $SinceEpoch) {
        return 'none'
    }

    $detectedBump = 'none'
    $raw = ((& git -C $gitRoot log --format='%s%x1f%b%x1e' --since="@${SinceEpoch}" 2>$null) -join "`n")
    if (-not $raw) {
        return 'none'
    }

    $records = $raw -split [char]0x1e
    foreach ($record in $records) {
        if ([string]::IsNullOrWhiteSpace($record)) {
            continue
        }

        $parts = $record -split [char]0x1f, 2
        $subject = $parts[0].Trim("`r", "`n")
        $body = if ($parts.Count -gt 1) { $parts[1] } else { '' }
        $commitBump = Get-CommitMessageVersionBump -Subject $subject -Body $body
        $detectedBump = Get-MaxVersionBump -Left $detectedBump -Right $commitBump
    }

    return $detectedBump
}

function Test-PathMatchesPatterns {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string[]]$Patterns
    )

    foreach ($pattern in $Patterns) {
        if ($Path -like $pattern) {
            return $true
        }
    }

    return $false
}

function Get-RepoPathVersionBump {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoDir
    )

    $gitRoot = Resolve-GitRoot -Directory $RepoDir
    if (-not $gitRoot) {
        return 'none'
    }

    $detectedBump = 'none'
    $statusLines = & git -C $gitRoot status --short --untracked-files=all 2>$null

    foreach ($line in $statusLines) {
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        $status = $line.Substring(0, [Math]::Min(2, $line.Length))
        $path = if ($line.Length -gt 3) { $line.Substring(3) } else { '' }
        $trimmedPath = if ($path.Contains(' -> ')) { $path.Split(' -> ')[-1] } else { $path }

        if (Test-PathMatchesPatterns -Path $trimmedPath -Patterns $CcVersionIgnoredPaths) {
            continue
        }

        if (Test-PathMatchesPatterns -Path $trimmedPath -Patterns $CcVersionMinorPaths) {
            $detectedBump = Get-MaxVersionBump -Left $detectedBump -Right 'minor'
            continue
        }

        if ($status -eq '??' -or $status.Contains('A') -or $status.Contains('D')) {
            $detectedBump = Get-MaxVersionBump -Left $detectedBump -Right 'minor'
            continue
        }

        if (Test-PathMatchesPatterns -Path $trimmedPath -Patterns $CcVersionPatchPaths) {
            $detectedBump = Get-MaxVersionBump -Left $detectedBump -Right 'patch'
        }
    }

    return $detectedBump
}

function Resolve-AutoVersionBump {
    $anchorEpoch = Resolve-VersionAnchorEpoch
    $commitBackendBump = Get-RepoCommitVersionBump -RepoDir $BackendDir -SinceEpoch $anchorEpoch
    $commitFrontendBump = Get-RepoCommitVersionBump -RepoDir $FrontendDir -SinceEpoch $anchorEpoch
    $commitBump = Get-MaxVersionBump -Left $commitBackendBump -Right $commitFrontendBump

    if ($commitBump -ne 'none') {
        return [pscustomobject]@{
            Bump = $commitBump
            Source = 'conventional-commits'
        }
    }

    $pathBackendBump = Get-RepoPathVersionBump -RepoDir $BackendDir
    $pathFrontendBump = Get-RepoPathVersionBump -RepoDir $FrontendDir
    $pathBump = Get-MaxVersionBump -Left $pathBackendBump -Right $pathFrontendBump

    return [pscustomobject]@{
        Bump = $pathBump
        Source = 'path-rules'
    }
}

function Resolve-VersionBumpWithSource {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RequestedBump
    )

    $normalized = Normalize-VersionBump -Bump $RequestedBump
    if ($normalized -eq 'auto') {
        return Resolve-AutoVersionBump
    }

    return [pscustomobject]@{
        Bump = $normalized
        Source = 'manual'
    }
}

function Resolve-WranglerPackage {
    if ($WranglerVersion -ne 'latest') {
        return "wrangler@$WranglerVersion"
    }

    try {
        $resolvedVersion = ((& npm view wrangler version 2>$null) -join "`n").Trim()
        if ($resolvedVersion) {
            return "wrangler@$resolvedVersion"
        }
    } catch { }

    return 'wrangler@latest'
}

function Get-WranglerConfigObject {
    if (-not (Test-Path $WranglerConfig)) {
        return $null
    }

    $raw = Get-Content -Raw $WranglerConfig
    $withoutCommentLines = (($raw -split "`r?`n") | Where-Object { $_ -notmatch '^\s*//' }) -join "`n"
    return $withoutCommentLines | ConvertFrom-Json
}

function Read-WranglerConfigValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Mode
    )

    $config = Get-WranglerConfigObject
    if (-not $config) {
        return ''
    }

    switch ($Mode) {
        'worker-name' {
            return [string]$config.name
        }
        'kv-namespace-id' {
            $binding = if ($env:KV_NAMESPACE_BINDING) { $env:KV_NAMESPACE_BINDING } else { 'STATIC_ASSETS' }
            foreach ($namespace in @($config.kv_namespaces)) {
                if ($namespace.binding -eq $binding) {
                    return [string]$namespace.id
                }
            }
            return ''
        }
        'route-base-url' {
            $routes = @($config.routes)
            if ($routes.Count -eq 0) {
                return ''
            }

            $firstRoute = $routes[0]
            $pattern = if ($firstRoute -is [string]) {
                [string]$firstRoute
            } elseif ($firstRoute.pattern) {
                [string]$firstRoute.pattern
            } else {
                ''
            }

            if (-not $pattern) {
                return ''
            }

            $normalized = $pattern -replace '/\*$', ''
            if ($normalized -match '^https?://') {
                return $normalized
            }

            return "https://$normalized"
        }
        default {
            return ''
        }
    }
}

function Detect-UtilsWorkersDevUrl {
    param(
        [Parameter(Mandatory = $false)]
        [string]$WorkerName
    )

    $utilsFile = Join-Path $BackendDir 'src\utils.js'
    if (-not (Test-Path $utilsFile)) {
        return ''
    }

    $matchingUrl = ''
    $fallbackUrl = ''

    foreach ($line in Get-Content $utilsFile) {
        $match = [regex]::Match($line, 'https://[^"]+workers\.dev')
        if (-not $match.Success) {
            continue
        }

        $url = $match.Value
        if ($WorkerName -and $url.Contains("://$WorkerName.")) {
            $matchingUrl = $url
            break
        }

        if (-not $fallbackUrl) {
            $fallbackUrl = $url
        }
    }

    if ($matchingUrl) {
        return $matchingUrl
    }

    return $fallbackUrl
}

function Resolve-DeployBaseUrl {
    if ($env:DEPLOY_BASE_URL) {
        return $env:DEPLOY_BASE_URL
    }

    $routeBase = Read-WranglerConfigValue -Mode 'route-base-url'
    if ($routeBase) {
        return $routeBase
    }

    $workerName = Read-WranglerConfigValue -Mode 'worker-name'
    $utilsBase = Detect-UtilsWorkersDevUrl -WorkerName $workerName
    if ($utilsBase) {
        return $utilsBase
    }

    return $DefaultDeployBaseUrl
}

function Update-PubspecVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PubspecPath,
        [Parameter(Mandatory = $true)]
        [string]$NewVersion
    )

    $content = Get-Content -Raw $PubspecPath
    if ($content -match '^version:\s*\S+') {
        $updated = [regex]::Replace($content, '^version:\s*\S+', "version: $NewVersion", [System.Text.RegularExpressions.RegexOptions]::Multiline)
    } else {
        $updated = $content.TrimEnd("`r", "`n") + "`r`nversion: $NewVersion`r`n"
    }

    Set-Content -Path $PubspecPath -Value $updated -Encoding utf8
}

function Get-UrlStatusCode {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    $curlPath = (Get-Command curl.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
    if ($curlPath) {
        return ((& $curlPath -sS -L -o NUL -w '%{http_code}' $Url) -join "`n").Trim()
    }

    try {
        $response = Invoke-WebRequest -Uri $Url -MaximumRedirection 5 -UseBasicParsing
        return [string][int]$response.StatusCode
    } catch {
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            return [string][int]$_.Exception.Response.StatusCode.value__
        }
        throw
    }
}

function Get-UrlBody {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    $curlPath = (Get-Command curl.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
    if ($curlPath) {
        return ((& $curlPath -sS -L $Url) -join "`n")
    }

    $response = Invoke-WebRequest -Uri $Url -MaximumRedirection 5 -UseBasicParsing
    return [string]$response.Content
}

function Run-SmokeTests {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BaseUrl
    )

    Write-Host '[6/6] Running smoke tests...'
    Write-Host "Testing base URL: $BaseUrl"

    $rootStatus = Get-UrlStatusCode -Url "$BaseUrl/"
    $loginStatus = Get-UrlStatusCode -Url "$BaseUrl/login"
    $healthJson = Get-UrlBody -Url "$BaseUrl/api/health"

    if ($rootStatus -ne '200') {
        throw "Smoke test failed: / returned $rootStatus"
    }

    if ($loginStatus -ne '200') {
        throw "Smoke test failed: /login returned $loginStatus"
    }

    if ($healthJson -notmatch '"ok"\s*:\s*true') {
        throw "Smoke test failed: /api/health returned unexpected payload`nResponse: $healthJson"
    }

    Write-Host 'Smoke tests passed'
    Write-Host ''
}

$FrontendDir = Resolve-FrontendDir
$Pubspec = Join-Path $FrontendDir 'pubspec.yaml'
$LocaleGenerator = Join-Path $FrontendDir 'tool\generate_locale_catalog.dart'
$WranglerPackage = Resolve-WranglerPackage
$FullVersion = Read-PubspecVersion -PubspecPath $Pubspec
if (-not $FullVersion) {
    throw "Failed to read version from $Pubspec"
}

$BaseVersion = $FullVersion.Split('+')[0]
if (-not (Test-Semver -Version $BaseVersion)) {
    throw "pubspec.yaml version must resolve to pure semver. Found: $FullVersion"
}

if ($RequestedVersion) {
    if (-not (Test-Semver -Version $RequestedVersion)) {
        throw 'VERSION must be pure semver, for example 0.4.0'
    }

    $Version = $RequestedVersion
    $ResolvedVersionBump = 'manual'
    $VersionSource = 'VERSION override'
} else {
    $VersionInfo = Resolve-VersionBumpWithSource -RequestedBump $RequestedVersionBump
    $ResolvedVersionBump = $VersionInfo.Bump
    $VersionSource = $VersionInfo.Source
    $Version = Get-BumpedSemver -Version $BaseVersion -Bump $ResolvedVersionBump
}

$KvTargetNamespaceId = if ($env:KV_NAMESPACE_ID) { $env:KV_NAMESPACE_ID } else { Read-WranglerConfigValue -Mode 'kv-namespace-id' }
$DeployBaseUrlResolved = Resolve-DeployBaseUrl

Write-Host '======================================'
Write-Host 'Coselig Staff Portal Deployment'
Write-Host "Version: $Version"
Write-Host "Base version: $BaseVersion"
Write-Host "Version bump: $ResolvedVersionBump ($VersionSource)"
Write-Host "Frontend: $FrontendDir"
Write-Host "Wrangler: $WranglerPackage"
Write-Host "Smoke URL: $DeployBaseUrlResolved"
Write-Host '======================================'
Write-Host ''

Write-Host '[1/6] Generating locale catalog...'
Set-Location $FrontendDir
if (Test-Path $LocaleGenerator) {
    Write-Host 'Running: dart run tool/generate_locale_catalog.dart'
    & dart run tool/generate_locale_catalog.dart
    if ($LASTEXITCODE -ne 0) {
        throw 'Locale catalog generation failed.'
    }
    Write-Host 'Step 1 completed'
} else {
    Write-Host 'Locale generator not found, skipping catalog generation'
}
Write-Host ''

Write-Host '[2/6] Building Flutter frontend...'
Write-Host "Running: flutter build web --release --build-name=$Version"
& flutter build web --release --build-name=$Version
if ($LASTEXITCODE -ne 0) {
    throw 'Flutter web build failed.'
}
Write-Host 'Step 2 completed'
Write-Host ''

Write-Host '[3/6] Generating asset list...'
Set-Location $BackendDir
if (Test-Path $UploadScript) {
    $previousFrontendDir = $env:FRONTEND_DIR
    $env:FRONTEND_DIR = $FrontendDir
    try {
        Write-Host "Running: node $UploadScript"
        & node $UploadScript
        if ($LASTEXITCODE -ne 0) {
            throw 'Asset list generation failed.'
        }
    } finally {
        if ($null -eq $previousFrontendDir) {
            Remove-Item Env:FRONTEND_DIR -ErrorAction SilentlyContinue
        } else {
            $env:FRONTEND_DIR = $previousFrontendDir
        }
    }
    Write-Host 'Step 3 completed'
} else {
    Write-Host 'upload.js not found, skipping asset generation'
}
Write-Host ''

Write-Host '[4/6] Uploading static files to KV...'
if (Test-Path $AssetsPath) {
    if (-not $KvTargetNamespaceId) {
        throw 'No KV namespace id found. Set KV_NAMESPACE_ID or configure STATIC_ASSETS in wrangler.jsonc.'
    }

    Write-Host "assetsPath: $AssetsPath"
    Write-Host "namespaceId: $KvTargetNamespaceId"
    Write-Host "Running: npm exec --package=$WranglerPackage -- wrangler kv bulk put $AssetsPath --namespace-id $KvTargetNamespaceId --remote"
    & npm @('exec', "--package=$WranglerPackage", '--', 'wrangler', 'kv', 'bulk', 'put', $AssetsPath, '--namespace-id', $KvTargetNamespaceId, '--remote')
    if ($LASTEXITCODE -ne 0) {
        throw 'KV upload failed.'
    }
    Write-Host 'Step 4 completed'
} else {
    Write-Host 'assets.json not found, skipping KV upload'
}
Write-Host ''

Write-Host '[5/6] Deploying Workers...'
Write-Host "Running: npm exec --package=$WranglerPackage -- wrangler deploy"
& npm @('exec', "--package=$WranglerPackage", '--', 'wrangler', 'deploy')
if ($LASTEXITCODE -ne 0) {
    throw 'Workers deployment failed.'
}
Write-Host 'Step 5 completed'
Write-Host ''

Run-SmokeTests -BaseUrl $DeployBaseUrlResolved

Write-Host 'Updating pubspec version...'
Update-PubspecVersion -PubspecPath $Pubspec -NewVersion $Version
Write-Host "Pubspec version is now: $Version"
Write-Host ''

Write-Host '======================================'
Write-Host 'Deployment successful'
Write-Host "Version: $Version"
Write-Host "Access: $DeployBaseUrlResolved"
Write-Host '======================================'
