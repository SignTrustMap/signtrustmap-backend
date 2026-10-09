#!/usr/bin/env bash
set -e

OSRM_DATA_DIR="$(pwd)/pmtiles/osrm-data"
PBF_FILE="$(pwd)/pmtiles/vietnam-latest.osm.pbf"

mkdir -p "$OSRM_DATA_DIR"

if [ ! -f "$PBF_FILE" ]; then
    echo "❌ Missing $PBF_FILE. Please download it first."
    exit 1
fi

echo "=== Copying PBF to OSRM data volume ==="
cp "$PBF_FILE" "$OSRM_DATA_DIR/vietnam-latest.osm.pbf"

echo "=== 1/3: Extracting OpenStreetMap graph (car profile) ==="
docker run --rm -t -v "$OSRM_DATA_DIR:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-extract -p /opt/car.lua /data/vietnam-latest.osm.pbf

echo "=== 2/3: Partitioning cells (MLD algorithm) ==="
docker run --rm -t -v "$OSRM_DATA_DIR:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-partition /data/vietnam-latest.osrm

echo "=== 3/3: Customizing cell weights and speeds ==="
docker run --rm -t -v "$OSRM_DATA_DIR:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-customize /data/vietnam-latest.osrm

# Remove duplicated PBF to save disk space
rm -f "$OSRM_DATA_DIR/vietnam-latest.osm.pbf"

echo "✅ OSRM graph compiled successfully in $OSRM_DATA_DIR!"
