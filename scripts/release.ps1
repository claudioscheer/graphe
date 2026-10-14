<#
.SYNOPSIS
    Bumps version, updates manifests, runs tests, commits, tags, and pushes a release.

.DESCRIPTION
    Automates releasing a new version of Graphe:
    1. Checks for clean working tree and main branch
    2. Determines new version (patch, minor, major, or explicit semver)
    3. Updates Cargo.toml [workspace.package], packaging/windows/setup.iss, packaging/macos/Info.plist
    4. Updates Cargo.lock via cargo check
    5. Runs cargo test
    6. Creates git commit and tag
    7. Pushes commit and tag to origin to trigger GitHub Actions release

.PARAMETER Bump
    Bump type ('patch', 'minor', 'major') or explicit version (e.g. '1.0.13').
    Defaults to 'patch'.

.PARAMETER DryRun
    Simulate the release without modifying files, committing, or pushing.

.PARAMETER NoPush
    Update files, commit, and tag locally without pushing to origin.

.EXAMPLE
    .\scripts\release.ps1 patch
    .\scripts\release.ps1 minor
    .\scripts\release.ps1 major
    .\scripts\release.ps1 1.0.13
    .\scripts\release.ps1 patch -DryRun
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Bump = "patch",

    [switch]$DryRun,
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"

# Navigate to repo root
$repoRoot = (git rev-parse --show-toplevel 2>$null)
if (-not $repoRoot) {
    Write-Error "Not inside a git repository."
    exit 1
}
Set-Location $repoRoot

# 1. Check working directory status
$status = git status --porcelain
if ($status) {
    if ($DryRun) {
        Write-Warning "Working directory is not clean (ignored for DryRun)."
    } else {
        Write-Error "Working directory is not clean. Commit or stash changes before releasing.`n$status"
        exit 1
    }
}

# 2. Check current branch
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne "main") {
    Write-Warning "Current branch is '$branch', expected 'main'."
    $confirm = Read-Host "Proceed anyway? (y/N)"
    if ($confirm -notmatch "^[yY]$") {
        Write-Host "Aborted."
        exit 0
    }
}

# 3. Read current version from Cargo.toml
$cargoToml = Get-Content "Cargo.toml" -Raw
if ($cargoToml -match '\[workspace\.package\][^\[]*version\s*=\s*"([^"]+)"') {
    $currentVersion = $Matches[1]
} else {
    Write-Error "Could not find [workspace.package] version in Cargo.toml."
    exit 1
}

Write-Host "Current version: $currentVersion"

# 4. Calculate new version
$parts = $currentVersion.Split('.')
if ($parts.Length -ne 3) {
    Write-Error "Current version '$currentVersion' is not valid semver (major.minor.patch)."
    exit 1
}

[int]$major = $parts[0]
[int]$minor = $parts[1]
[int]$patch = $parts[2]

switch -Regex ($Bump) {
    "^patch$" {
        $patch++
        $newVersion = "$major.$minor.$patch"
    }
    "^minor$" {
        $minor++
        $patch = 0
        $newVersion = "$major.$minor.$patch"
    }
    "^major$" {
        $major++
        $minor = 0
        $patch = 0
        $newVersion = "$major.$minor.$patch"
    }
    "^\d+\.\d+\.\d+$" {
        $newVersion = $Bump
    }
    default {
        Write-Error "Invalid bump argument '$Bump'. Expected 'patch', 'minor', 'major', or a valid semver like '1.0.13'."
        exit 1
    }
}

Write-Host "Target release version: $newVersion"

# Check if tag already exists
$tag = "v$newVersion"
$tagExists = git tag -l $tag
if ($tagExists) {
    Write-Error "Tag '$tag' already exists in git. Cannot release an existing version."
    exit 1
}

if ($DryRun) {
    Write-Host "[DRY RUN] Would update version from $currentVersion to $newVersion in:"
    Write-Host "  - Cargo.toml"
    Write-Host "  - Cargo.lock"
    Write-Host "  - packaging/windows/setup.iss"
    Write-Host "  - packaging/macos/Info.plist"
    Write-Host "[DRY RUN] Would run cargo test"
    Write-Host "[DRY RUN] Would create git commit: 'Release version $newVersion.'"
    Write-Host "[DRY RUN] Would create git tag: '$tag'"
    if (-not $NoPush) {
        Write-Host "[DRY RUN] Would push commit and tag to origin"
    }
    exit 0
}

# 5. Update files
Write-Host "Updating Cargo.toml..."
$updatedCargo = [regex]::Replace(
    $cargoToml,
    '(\[workspace\.package\][^\[]*version\s*=\s*)"[^"]+"',
    "`${1}`"$newVersion`""
)
Set-Content "Cargo.toml" -Value $updatedCargo -NoNewline

Write-Host "Updating packaging/windows/setup.iss..."
if (Test-Path "packaging/windows/setup.iss") {
    $iss = Get-Content "packaging/windows/setup.iss" -Raw
    $updatedIss = [regex]::Replace(
        $iss,
        '(#define MyAppVersion\s+)"[^"]+"',
        "`${1}`"$newVersion`""
    )
    Set-Content "packaging/windows/setup.iss" -Value $updatedIss -NoNewline
}

Write-Host "Updating packaging/macos/Info.plist..."
if (Test-Path "packaging/macos/Info.plist") {
    $plist = Get-Content "packaging/macos/Info.plist" -Raw
    $updatedPlist = [regex]::Replace(
        $plist,
        '(<key>CFBundleShortVersionString</key>\s*<string>)[^<]+(</string>)',
        "`${1}$newVersion`${2}"
    )
    $updatedPlist = [regex]::Replace(
        $updatedPlist,
        '(<key>CFBundleVersion</key>\s*<string>)[^<]+(</string>)',
        "`${1}$newVersion`${2}"
    )
    Set-Content "packaging/macos/Info.plist" -Value $updatedPlist -NoNewline
}

Write-Host "Syncing Cargo.lock via cargo check..."
cargo check --quiet

# 6. Run tests
Write-Host "Running tests..."
cargo test
if ($LASTEXITCODE -ne 0) {
    Write-Error "Tests failed! Reverting modified files..."
    git checkout -- Cargo.toml Cargo.lock packaging/windows/setup.iss packaging/macos/Info.plist
    exit 1
}

# 7. Git commit and tag
Write-Host "Committing release version $newVersion..."
git add Cargo.toml Cargo.lock packaging/windows/setup.iss packaging/macos/Info.plist
git commit -m "Release version $newVersion."
git tag -a $tag -m "Release $tag"

# 8. Push
if ($NoPush) {
    Write-Host ""
    Write-Host "Release $tag created locally (commit and tag)." -ForegroundColor Green
    Write-Host "To publish, run:"
    Write-Host "  git push origin $branch"
    Write-Host "  git push origin $tag"
} else {
    Write-Host "Pushing commit and tag to origin..."
    git push origin $branch
    git push origin $tag
    Write-Host ""
    Write-Host "Successfully released and pushed $tag!" -ForegroundColor Green
    Write-Host "GitHub Actions has been triggered to build and publish the release." -ForegroundColor Cyan
}
