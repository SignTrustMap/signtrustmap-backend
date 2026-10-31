#!/bin/sh
# =============================================================================
# SignTrustMap — Schemathesis Automated Failure Testing Runner
# Designed for Coolify Docker Compose deployment
# =============================================================================
set -u

LOG_DIR="/tmp/schemathesis-logs"
REPORTS_DIR="${REPORTS_DIR:-/reports}"
TIMESTAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
mkdir -p "$LOG_DIR" "$REPORTS_DIR/nestjs" "$REPORTS_DIR/fastapi" 2>/dev/null || true

NESTJS_HOST="${NESTJS_HOST:-http://api-nestjs:3000}"
FASTAPI_HOST="${FASTAPI_HOST:-http://api-fastapi:8000}"
MAX_EXAMPLES="${MAX_EXAMPLES:-30}"
NOTIFY_SUCCESS="${NOTIFY_ON_SUCCESS:-false}"
# Fixed Hypothesis seed for reproducible failure IDs across hourly runs.
HYPOTHESIS_SEED="${SCHEMATHESIS_SEED:-42}"
# Exclude destructive / state-mutating privileged paths from fuzzing when set.
# Comma-separated operationId or path substrings (Schemathesis --exclude-path / --exclude-operation-id).
EXCLUDE_PATHS="${SCHEMATHESIS_EXCLUDE_PATHS:-}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFIER="${SCRIPT_DIR}/notify-discord.py"

echo "================================================================="
echo "[$(date -u +"%Y-%m-%d %H:%M:%SZ")] Starting Automated Endpoint Failure Scan"
echo "  NestJS Host:    $NESTJS_HOST"
echo "  FastAPI Host:   $FASTAPI_HOST"
echo "  Max Examples:   $MAX_EXAMPLES per operation"
echo "  Hypothesis Seed:$HYPOTHESIS_SEED"
echo "  Reports Dir:    $REPORTS_DIR"
echo "================================================================="

# -----------------------------------------------------------------------------
# 1. NestJS JWT (optional) + FastAPI internal token (optional)
# -----------------------------------------------------------------------------
TEST_USER_EMAIL="${TEST_USER_EMAIL:-${SCHEMATHESIS_TEST_EMAIL:-}}"
TEST_USER_PASSWORD="${TEST_USER_PASSWORD:-${SCHEMATHESIS_TEST_PASSWORD:-}}"

AUTH_HEADER=""
if [ -n "$TEST_USER_EMAIL" ] && [ -n "$TEST_USER_PASSWORD" ]; then
  echo "Attempting to obtain authentication token from $NESTJS_HOST/api/v1/auth/login..."
  LOGIN_RESP=$(wget -qO- --header="Content-Type: application/json" \
    --post-data="{\"email\":\"$TEST_USER_EMAIL\",\"password\":\"$TEST_USER_PASSWORD\"}" \
    "$NESTJS_HOST/api/v1/auth/login" 2>/dev/null || true)

  TOKEN=$(echo "$LOGIN_RESP" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4 || true)
  if [ -n "$TOKEN" ]; then
    AUTH_HEADER="-H Authorization:Bearer $TOKEN"
    echo "Successfully acquired JWT authentication token."
  else
    echo "Warning: Could not obtain token, continuing with unauthenticated NestJS testing."
    echo "         Set SCHEMATHESIS_TEST_EMAIL / SCHEMATHESIS_TEST_PASSWORD to exercise secured paths."
  fi
else
  echo "Info: SCHEMATHESIS_TEST_EMAIL/PASSWORD unset — NestJS scan is unauthenticated (expect 401/403 on secured ops)."
fi

FASTAPI_AUTH_HEADER=""
if [ -n "${INTERNAL_API_TOKEN:-}" ]; then
  FASTAPI_AUTH_HEADER="-H X-Internal-Token:$INTERNAL_API_TOKEN"
  echo "FastAPI internal token header configured for catalog/service endpoints."
else
  echo "Info: INTERNAL_API_TOKEN unset — FastAPI catalog endpoints will return 401 (expected when protected)."
fi

EXCLUDE_ARGS=""
if [ -n "$EXCLUDE_PATHS" ]; then
  OLD_IFS=$IFS
  IFS=,
  for path_pat in $EXCLUDE_PATHS; do
    path_pat=$(echo "$path_pat" | tr -d ' ')
    if [ -n "$path_pat" ]; then
      EXCLUDE_ARGS="$EXCLUDE_ARGS --exclude-path $path_pat"
    fi
  done
  IFS=$OLD_IFS
fi

# -----------------------------------------------------------------------------
# 2. Test NestJS Core API Endpoints
# -----------------------------------------------------------------------------
echo ""
echo "--> Scanning NestJS Core API endpoints ($NESTJS_HOST/docs-json)..."
NESTJS_LOG="$LOG_DIR/nestjs.log"
NESTJS_JUNIT="$REPORTS_DIR/nestjs/junit-$TIMESTAMP.xml"
NESTJS_HTML="$REPORTS_DIR/nestjs/report-$TIMESTAMP.html"

# shellcheck disable=SC2086
st run "$NESTJS_HOST/docs-json" \
  -u "$NESTJS_HOST" \
  --wait-for-schema 30 \
  -c not_a_server_error \
  -n "$MAX_EXAMPLES" \
  --stateful=links \
  --hypothesis-seed "$HYPOTHESIS_SEED" \
  --exclude-method DELETE \
  --suppress-health-check=filter_too_much \
  --report junit="$NESTJS_JUNIT" \
  --report html="$NESTJS_HTML" \
  $EXCLUDE_ARGS \
  $AUTH_HEADER \
  --no-color > "$NESTJS_LOG" 2>&1
NESTJS_EXIT=$?

# Keep a stable "latest" pointer for operators
cp -f "$NESTJS_LOG" "$REPORTS_DIR/nestjs/latest.log" 2>/dev/null || true

if [ $NESTJS_EXIT -eq 0 ]; then
  echo "✅ NestJS: ALL ENDPOINTS PASSED without 500 errors."
  if [ "$NOTIFY_SUCCESS" = "true" ]; then
    python3 "$NOTIFIER" "NestJS Core API" "SUCCESS" "$NESTJS_LOG" || true
  fi
else
  echo "❌ NestJS: FAILURES DETECTED! See details below:"
  cat "$NESTJS_LOG"
  python3 "$NOTIFIER" "NestJS Core API" "FAILED" "$NESTJS_LOG" || true
fi

# -----------------------------------------------------------------------------
# 3. Test FastAPI Spatial Endpoints
# -----------------------------------------------------------------------------
echo ""
echo "--> Scanning FastAPI Spatial endpoints ($FASTAPI_HOST/openapi.json)..."
FASTAPI_LOG="$LOG_DIR/fastapi.log"
FASTAPI_JUNIT="$REPORTS_DIR/fastapi/junit-$TIMESTAMP.xml"
FASTAPI_HTML="$REPORTS_DIR/fastapi/report-$TIMESTAMP.html"

# shellcheck disable=SC2086
st run "$FASTAPI_HOST/openapi.json" \
  -u "$FASTAPI_HOST" \
  --wait-for-schema 30 \
  -c not_a_server_error \
  -n "$MAX_EXAMPLES" \
  --stateful=links \
  --hypothesis-seed "$HYPOTHESIS_SEED" \
  --exclude-method DELETE \
  --suppress-health-check=filter_too_much \
  --report junit="$FASTAPI_JUNIT" \
  --report html="$FASTAPI_HTML" \
  $EXCLUDE_ARGS \
  $FASTAPI_AUTH_HEADER \
  --no-color > "$FASTAPI_LOG" 2>&1
FASTAPI_EXIT=$?

cp -f "$FASTAPI_LOG" "$REPORTS_DIR/fastapi/latest.log" 2>/dev/null || true

if [ $FASTAPI_EXIT -eq 0 ]; then
  echo "✅ FastAPI: ALL ENDPOINTS PASSED without 500 errors."
  if [ "$NOTIFY_SUCCESS" = "true" ]; then
    python3 "$NOTIFIER" "FastAPI Spatial Engine" "SUCCESS" "$FASTAPI_LOG" || true
  fi
else
  echo "❌ FastAPI: FAILURES DETECTED! See details below:"
  cat "$FASTAPI_LOG"
  python3 "$NOTIFIER" "FastAPI Spatial Engine" "FAILED" "$FASTAPI_LOG" || true
fi

# -----------------------------------------------------------------------------
# 4. Unauthenticated negative security pass (NestJS) — expect 401/403, fail on 500
# -----------------------------------------------------------------------------
if [ -n "$AUTH_HEADER" ]; then
  echo ""
  echo "--> NestJS negative auth scan (no Authorization header)..."
  NESTJS_NEG_LOG="$LOG_DIR/nestjs-unauth.log"
  st run "$NESTJS_HOST/docs-json" \
    -u "$NESTJS_HOST" \
    --wait-for-schema 30 \
    -c not_a_server_error \
    -n 5 \
    --hypothesis-seed "$HYPOTHESIS_SEED" \
    --exclude-method DELETE \
    --suppress-health-check=filter_too_much \
    --no-color > "$NESTJS_NEG_LOG" 2>&1
  NESTJS_NEG_EXIT=$?
  cp -f "$NESTJS_NEG_LOG" "$REPORTS_DIR/nestjs/latest-unauth.log" 2>/dev/null || true
  if [ $NESTJS_NEG_EXIT -ne 0 ]; then
    echo "❌ NestJS unauthenticated scan found server errors:"
    cat "$NESTJS_NEG_LOG"
    NESTJS_EXIT=1
    python3 "$NOTIFIER" "NestJS Core API (unauth)" "FAILED" "$NESTJS_NEG_LOG" || true
  else
    echo "✅ NestJS unauthenticated scan: no 500s (401/403 expected on secured ops)."
  fi
fi

echo ""
echo "================================================================="
echo "[$(date -u +"%Y-%m-%d %H:%M:%SZ")] Endpoint failure scan completed."
echo "  NestJS exit=$NESTJS_EXIT  FastAPI exit=$FASTAPI_EXIT"
echo "  Reports under $REPORTS_DIR/{nestjs,fastapi}/"
echo "================================================================="

# Non-zero exit preserves Coolify/CI regression signal.
if [ "$NESTJS_EXIT" -ne 0 ] || [ "$FASTAPI_EXIT" -ne 0 ]; then
  exit 1
fi
exit 0
