#!/bin/sh
# =============================================================================
# SignTrustMap — Schemathesis Automated Failure Testing Runner
# Designed for Coolify Docker Compose deployment
# =============================================================================
set -u

LOG_DIR="/tmp/schemathesis-logs"
REPORTS_DIR="${REPORTS_DIR:-/tmp/reports}"
mkdir -p "$LOG_DIR" "$REPORTS_DIR/nestjs" "$REPORTS_DIR/fastapi" 2>/dev/null || true

NESTJS_HOST="${NESTJS_HOST:-http://api-nestjs:3000}"
FASTAPI_HOST="${FASTAPI_HOST:-http://api-fastapi:8000}"
MAX_EXAMPLES="${MAX_EXAMPLES:-30}"
NOTIFY_SUCCESS="${NOTIFY_ON_SUCCESS:-false}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NOTIFIER="${SCRIPT_DIR}/notify-discord.py"

echo "================================================================="
echo "[$(date -u +"%Y-%m-%d %H:%M:%SZ")] Starting Automated Endpoint Failure Scan"
echo "  NestJS Host:    $NESTJS_HOST"
echo "  FastAPI Host:   $FASTAPI_HOST"
echo "  Max Examples:   $MAX_EXAMPLES per operation"
echo "================================================================="

# -----------------------------------------------------------------------------
# 1. Check Authentication (Optional)
# -----------------------------------------------------------------------------
AUTH_HEADER=""
if [ -n "${TEST_USER_EMAIL:-}" ] && [ -n "${TEST_USER_PASSWORD:-}" ]; then
  echo "Attempting to obtain authentication token from $NESTJS_HOST/api/v1/auth/login..."
  LOGIN_RESP=$(wget -qO- --header="Content-Type: application/json" \
    --post-data="{\"email\":\"$TEST_USER_EMAIL\",\"password\":\"$TEST_USER_PASSWORD\"}" \
    "$NESTJS_HOST/api/v1/auth/login" 2>/dev/null || true)

  TOKEN=$(echo "$LOGIN_RESP" | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4 || true)
  if [ -n "$TOKEN" ]; then
    AUTH_HEADER="-H Authorization:Bearer $TOKEN"
    echo "Successfully acquired JWT authentication token."
  else
    echo "Warning: Could not obtain token, continuing with unauthenticated testing."
  fi
fi

# -----------------------------------------------------------------------------
# 2. Test NestJS Core API Endpoints
# -----------------------------------------------------------------------------
echo ""
echo "--> Scanning NestJS Core API endpoints ($NESTJS_HOST/docs-json)..."
NESTJS_LOG="$LOG_DIR/nestjs.log"

# Note: -u forces internal routing; --exclude-method DELETE prevents accidental deletion
st run "$NESTJS_HOST/docs-json" \
  -u "$NESTJS_HOST" \
  --wait-for-schema 30 \
  -c not_a_server_error \
  -n "$MAX_EXAMPLES" \
  --exclude-method DELETE \
  --suppress-health-check=filter_too_much \
  $AUTH_HEADER \
  --no-color > "$NESTJS_LOG" 2>&1
NESTJS_EXIT=$?

if [ $NESTJS_EXIT -eq 0 ]; then
  echo "✅ NestJS: ALL ENDPOINTS PASSED without 500 errors."
  if [ "$NOTIFY_SUCCESS" = "true" ]; then
    python3 "$NOTIFIER" "NestJS Core API" "SUCCESS" "$NESTJS_LOG" || true
  fi
else
  echo "❌ NestJS: 500 ERRORS DETECTED! See details below:"
  cat "$NESTJS_LOG"
  python3 "$NOTIFIER" "NestJS Core API" "FAILED" "$NESTJS_LOG" || true
fi

# -----------------------------------------------------------------------------
# 3. Test FastAPI Spatial Endpoints
# -----------------------------------------------------------------------------
echo ""
echo "--> Scanning FastAPI Spatial endpoints ($FASTAPI_HOST/openapi.json)..."
FASTAPI_LOG="$LOG_DIR/fastapi.log"

st run "$FASTAPI_HOST/openapi.json" \
  -u "$FASTAPI_HOST" \
  --wait-for-schema 30 \
  -c not_a_server_error \
  -n "$MAX_EXAMPLES" \
  --exclude-method DELETE \
  --suppress-health-check=filter_too_much \
  --no-color > "$FASTAPI_LOG" 2>&1
FASTAPI_EXIT=$?

if [ $FASTAPI_EXIT -eq 0 ]; then
  echo "✅ FastAPI: ALL ENDPOINTS PASSED without 500 errors."
  if [ "$NOTIFY_SUCCESS" = "true" ]; then
    python3 "$NOTIFIER" "FastAPI Spatial Engine" "SUCCESS" "$FASTAPI_LOG" || true
  fi
else
  echo "❌ FastAPI: 500 ERRORS DETECTED! See details below:"
  cat "$FASTAPI_LOG"
  python3 "$NOTIFIER" "FastAPI Spatial Engine" "FAILED" "$FASTAPI_LOG" || true
fi

echo ""
echo "================================================================="
echo "[$(date -u +"%Y-%m-%d %H:%M:%SZ")] Endpoint failure scan completed."
echo "================================================================="
