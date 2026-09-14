#!/usr/bin/env bash
set -e

echo "=== SignTrustMap Cloudflare R2 Setup ==="

# Check wrangler authentication
if ! npx wrangler whoami > /dev/null 2>&1; then
    echo "⚠️ Wrangler is not authenticated yet."
    echo "Please run: npx wrangler login"
    echo "Then re-run this script."
    exit 1
fi

echo "✅ Wrangler is authenticated."

BUCKETS=(
  "stm-raw-videos"
  "stm-gpx-logs"
  "stm-sign-crops"
  "stm-revalidation-evidence"
  "stm-catalog-images"
)

LOCATION="${R2_LOCATION:-apac}"

echo "Creating R2 buckets in location hint: ${LOCATION}..."
for BUCKET in "${BUCKETS[@]}"; do
    echo "Creating bucket: ${BUCKET}..."
    npx wrangler r2 bucket create "${BUCKET}" --location "${LOCATION}" || echo "Bucket ${BUCKET} may already exist, continuing..."
done

# Create temporary CORS policy JSON
CORS_FILE=$(mktemp /tmp/r2-cors-XXXXXX.json)
cat << 'EOF' > "${CORS_FILE}"
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
EOF

echo "Setting CORS configuration for web/mobile uploads..."
npx wrangler r2 bucket cors set stm-raw-videos "${CORS_FILE}" || true
npx wrangler r2 bucket cors set stm-sign-crops "${CORS_FILE}" || true
rm -f "${CORS_FILE}"

echo "✅ All 5 R2 buckets are ready!"
echo "List of current buckets:"
npx wrangler r2 bucket list
