<#
.SYNOPSIS
  Audits the codebase and environment to ensure a clean, bugless review release
  with all demo shortcuts and bypasses turned OFF.

.EXAMPLE
  .\scripts\audit-clean-release.ps1
#>

Write-Host "==============================================================" -ForegroundColor Cyan
Write-Host "   SignTrustMap - Pre-Flight Clean Review Release Audit       " -ForegroundColor Cyan
Write-Host "==============================================================" -ForegroundColor Cyan

$hasErrors = $false

# 1. Environment Variables Audit
Write-Host "`n[1/3] Checking environment files for active demo flags..." -ForegroundColor Yellow
$envFiles = Get-ChildItem -Path . -Filter ".env*" -File -Recurse -ErrorAction SilentlyContinue
$forbiddenPatterns = @("DEMO_MODE=true", "ALLOW_SELF_REVIEW=true")

foreach ($file in $envFiles) {
    $content = Get-Content $file.FullName -Raw
    foreach ($pat in $forbiddenPatterns) {
        if ($content -match $pat) {
            Write-Host "  [FAIL] Found active flag '$pat' in $($file.FullName)" -ForegroundColor Red
            $hasErrors = $true
        }
    }
}
if (-not $hasErrors) {
    Write-Host "  [PASS] No hardcoded demo flags enabled in environment files." -ForegroundColor Green
}

# 2. Source Code Audit for Hardcoded SQL Bypasses
Write-Host "`n[2/3] Checking NestJS source code for hardcoded SQL demo checks..." -ForegroundColor Yellow
$sqlHits = Get-ChildItem -Path "apps/nestjs/src/modules" -Recurse -Include "*.ts" | 
    Select-String -Pattern "WHERE email = 'demo@stm.dev'|AND u.email = 'demo@stm.dev'"

if ($sqlHits) {
    foreach ($hit in $sqlHits) {
        Write-Host "  [FAIL] Hardcoded SQL demo email found at $($hit.Path):$($hit.LineNumber)" -ForegroundColor Red
    }
    $hasErrors = $true
} else {
    Write-Host "  [PASS] Zero hardcoded SQL bypasses found in application services." -ForegroundColor Green
}

# 3. Dynamic Switchboard Migration Audit
Write-Host "`n[3/3] Verifying feature flag migration existence..." -ForegroundColor Yellow
$migration041 = "infra/postgres/migrations/041_system_feature_flags.sql"
$migration027 = "apps/nestjs/src/database/migrations/027_system_feature_flags.sql"

if ((Test-Path $migration041) -and (Test-Path $migration027)) {
    Write-Host "  [PASS] System feature flag migrations 041 and 027 verified." -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Feature flag migration files missing!" -ForegroundColor Red
    $hasErrors = $true
}

Write-Host "`n--------------------------------------------------------------" -ForegroundColor Cyan
if ($hasErrors) {
    Write-Host "AUDIT FAILED: Resolve the items marked [FAIL] before publishing a review release." -ForegroundColor Red
    exit 1
} else {
    Write-Host "AUDIT PASSED: Repository is clean and compliant for review release!" -ForegroundColor Green
    exit 0
}
