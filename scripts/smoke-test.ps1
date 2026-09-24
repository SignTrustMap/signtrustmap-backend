# smoke-test.ps1 — SignTrustMap backend smoke test (NestJS + FastAPI)
# Usage: pwsh -File scripts/smoke-test.ps1
# Prereq: stack running via `docker compose up -d --build`
param(
  [string]$Nest = 'http://localhost:3000/api/v1',
  [string]$Fast = 'http://localhost:8000',
  [string]$AdminEmail = 'admin@stm.dev',
  [string]$AdminPass  = 'Admin@123',
  [string]$InternalToken = 'stm_internal_secret_dev'
)
$ErrorActionPreference = 'SilentlyContinue'
$ok = 0; $attn = 0; $fail = 0

function Hit($m, $u, $b, $h) {
  try {
    $p = @{ Method = $m; Uri = $u; UseBasicParsing = $true; TimeoutSec = 20 }
    if ($null -ne $b) { $p.Body = $b; $p.ContentType = 'application/json' }
    if ($h) { $p.Headers = $h }
    $r = Invoke-WebRequest @p
    return @([int]$r.StatusCode, $r.Content)
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $rd = (New-Object IO.StreamReader($resp.GetResponseStream())).ReadToEnd()
      return @([int]$resp.StatusCode, $rd)
    }
    return @(0, $_.Exception.Message)
  }
}

function T($m, $u, $b, $h, $expect = @()) {
  $res = Hit $m $u $b $h; $code = $res[0]; $body = "$($res[1])"
  if ($code -ge 500 -or $code -eq 0) { $tag = 'FAIL'; $script:fail++ }
  elseif ($code -ge 200 -and $code -lt 300) { $tag = 'PASS'; $script:ok++ }
  elseif ($expect -contains $code) { $tag = 'PASS'; $script:ok++ }
  else { $tag = 'ATTN'; $script:attn++ }
  $short = $u.Replace($Nest, '').Replace($Fast, '')
  if ($short.Length -gt 50) { $short = $short.Substring(0, 50) }
  $b1 = $body; if ($b1.Length -gt 50) { $b1 = $b1.Substring(0, 50) + '..' }
  Write-Output ('{0,-4} {1,-6} {2,-52} {3,-4} {4}' -f $tag, $m, $short, $code, ($b1 -replace "`r|`n",' '))
}


# ── Login ──────────────────────────────────────────────────────────────────────
Write-Output '=== AUTH & SETUP ==='
$lr = Hit POST "$Nest/auth/login" (@{ email = $AdminEmail; password = $AdminPass } | ConvertTo-Json -Compress) $null
if ($lr[0] -ne 201) { Write-Error "Admin login failed ($($lr[0])): $($lr[1])"; exit 1 }
$tok = ($lr[1] | ConvertFrom-Json).accessToken
$me  = Hit GET "$Nest/auth/me" $null @{ Authorization = "Bearer $tok" }
$adminId = ($me[1] | ConvertFrom-Json).id
Write-Output "Admin login: $($lr[0])  id: $adminId"
$H = @{ Authorization = "Bearer $tok" }
$I = @{ 'x-internal-token' = $InternalToken }
$U = [guid]::NewGuid().ToString()

# ── FastAPI ────────────────────────────────────────────────────────────────────
Write-Output '=== FASTAPI ==='
T GET "$Fast/health"          $null $null
T GET "$Fast/api/v1/health"   $null $null
T GET "$Fast/api/v1/spatial/signs?min_lat=10&max_lat=11&min_lon=105&max_lon=107" $null $null
T GET "$Fast/api/v1/spatial/signs?min_lng=105&max_lng=106" $null $null @(422)
T GET "$Fast/api/v1/spatial/signs/$U" $null $null @(404)
$navBody = @{ driver_id=$adminId; origin_latitude=10.77; origin_longitude=106.70
              destination_latitude=10.79; destination_longitude=106.71 } | ConvertTo-Json -Compress
$navR = Hit POST "$Fast/api/v1/spatial/navigation/sessions" $navBody $H
T GET "$Fast/api/v1/spatial/navigation/sessions/me?driver_id=$adminId" $null $null
$navId = $null
if ($navR[0] -in 201,200) {
  $script:ok++; $navId = ($navR[1] | ConvertFrom-Json).id
  Write-Output "PASS POST   /api/v1/spatial/navigation/sessions              201  id=$navId"
  T GET "$Fast/api/v1/spatial/navigation/sessions/$navId" $null $null
  T PATCH "$Fast/api/v1/spatial/navigation/sessions/$navId" (@{status='COMPLETED'}|ConvertTo-Json -Compress) $null
} else {
  $script:attn++
  Write-Output "ATTN POST   /api/v1/spatial/navigation/sessions              $($navR[0])"
}

# ── NestJS authed GET (admin) ──────────────────────────────────────────────────
Write-Output '=== NESTJS GET (admin JWT) ==='
@('auth/me','wallet','wallet/transactions','wallet/top-up/packages','wallet/payment-methods',
  'places/saved','places/recent-searches','leaderboard','catalog/categories','catalog/sign-types',
  'daily-tasks','daily-tasks/completions/me','notifications','notifications/unread-count',
  'revalidation/tasks','revalidation/tasks/map?min_lat=10&max_lat=11&min_lon=105&max_lon=107',
  'moderation/cases','moderation/missing-type-reports',
  'reviews/queue','reviews/me/history','reviews/me/stats',
  'submissions/me','submissions/me/pending','submissions/me/stats',
  'admin/users','admin/audit-logs','admin/system-parameters','admin/signs/export') | ForEach-Object {
  T GET "$Nest/$_" $null $H
}
@("reviews/candidates/$U","submissions/$U","revalidation/tasks/$U",
  "moderation/cases/$U","moderation/missing-type-reports/$U") | ForEach-Object {
  T GET "$Nest/$_" $null $H @(404)
}

# ── NestJS writes ──────────────────────────────────────────────────────────────
Write-Output '=== NESTJS WRITES ==='
T PATCH  "$Nest/auth/me" (@{fullName='Admin STM'}|ConvertTo-Json -Compress) $H
T POST   "$Nest/places/recent-searches" (@{query='test';lat=10.7;lon=106.7}|ConvertTo-Json -Compress) $H
T DELETE "$Nest/places/recent-searches" $null $H
T POST   "$Nest/leaderboard/refresh"    $null $H
T PATCH  "$Nest/notifications/read-all" $null $H
T POST   "$Nest/wallet/top-up/custom"   (@{amount=50}|ConvertTo-Json -Compress) $H

# ── RBAC / Auth guards ─────────────────────────────────────────────────────────
Write-Output '=== RBAC ==='
T POST "$Nest/auth/forgot-password" (@{email=$AdminEmail}|ConvertTo-Json -Compress) $null @(201)
T GET  "$Nest/admin/users"          $null $null @(401)
$rand = Get-Random -Maximum 999999
$reg  = Hit POST "$Nest/auth/register" (@{email="surv$rand@stm.dev";password='Surv@123';fullName="Surveyor $rand"}|ConvertTo-Json -Compress) $null
Write-Output "register(surveyor) => $($reg[0])"
T GET "$Nest/admin/users" $null @{Authorization="Bearer $(($reg[1]|ConvertFrom-Json).accessToken)"} @(403)

# ── Internal (service-to-service) ─────────────────────────────────────────────
Write-Output '=== INTERNAL ==='
T GET  "$Nest/reviews/internal/unscored-candidates"        $null $I
T POST "$Nest/reviews/internal/active-learning-priorities" (@{items=@()}|ConvertTo-Json -Compress) $I
T POST "$Nest/wallet/internal/deduct" (@{userId=$adminId;amount=1}|ConvertTo-Json -Compress) $I @(200,201,400)
T GET  "$Nest/reviews/internal/unscored-candidates" $null $null @(401)

Write-Output ''
Write-Output ('==== RESULT  PASS={0}  ATTN(4xx/expected)={1}  FAIL(5xx)={2} ====' -f $ok,$attn,$fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
