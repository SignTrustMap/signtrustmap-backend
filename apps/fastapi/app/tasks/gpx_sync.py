"""GPX telemetry synchronization and spherical Earth coordinate estimation.

Provides telemetry timestamp alignment, trajectory bearing calculation,
pinhole distance heuristics, and Great-Circle spherical projection for
detected traffic signs.
"""
from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Sequence


@dataclass
class GpxTrackPoint:
    lat: float
    lon: float
    ele: float | None
    time: datetime


def parse_gpx_content(gpx_content: bytes | str) -> list[GpxTrackPoint]:
    """Parse GPX XML bytes or string into chronologically ordered trackpoints."""
    if isinstance(gpx_content, str):
        gpx_content = gpx_content.encode("utf-8")
    if not gpx_content.strip():
        return []

    try:
        root = ET.fromstring(gpx_content)
    except ET.ParseError:
        return []

    # Strip XML namespaces for tag matching
    for elem in root.iter():
        if "}" in elem.tag:
            elem.tag = elem.tag.split("}", 1)[1]

    points: list[GpxTrackPoint] = []
    for elem in root.findall(".//trkpt") + root.findall(".//wpt"):
        lat_str = elem.get("lat")
        lon_str = elem.get("lon")
        if lat_str is None or lon_str is None:
            continue
        try:
            lat = float(lat_str)
            lon = float(lon_str)
        except ValueError:
            continue

        if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
            continue

        time_elem = elem.find("time")
        if time_elem is None or not time_elem.text:
            continue

        time_str = time_elem.text.strip()
        try:
            dt = datetime.fromisoformat(time_str.replace("Z", "+00:00"))
        except Exception:
            continue

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)

        ele = None
        ele_elem = elem.find("ele")
        if ele_elem is not None and ele_elem.text:
            try:
                ele = float(ele_elem.text.strip())
            except ValueError:
                pass

        points.append(GpxTrackPoint(lat=lat, lon=lon, ele=ele, time=dt))

    points.sort(key=lambda p: p.time)
    return points


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate forward azimuth (initial bearing) from (lat1, lon1) to (lat2, lon2) in [0, 360)."""
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_lambda = math.radians(lon2 - lon1)

    y = math.sin(delta_lambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(delta_lambda)
    theta = math.degrees(math.atan2(y, x))
    return (theta + 360.0) % 360.0


def interpolate_gpx_position(
    points: Sequence[GpxTrackPoint],
    target_time: datetime,
) -> tuple[float, float, float]:
    """Interpolate vehicle GPS coordinates and heading at target_time.

    Returns:
        tuple of (vehicle_lat, vehicle_lon, vehicle_bearing_deg).
    """
    if not points:
        return (21.0285, 105.8342, 0.0)

    if target_time.tzinfo is None:
        target_time = target_time.replace(tzinfo=timezone.utc)
    else:
        target_time = target_time.astimezone(timezone.utc)

    if target_time <= points[0].time:
        p0 = points[0]
        bearing = (
            calculate_bearing(p0.lat, p0.lon, points[1].lat, points[1].lon)
            if len(points) > 1
            else 0.0
        )
        return (p0.lat, p0.lon, bearing)

    if target_time >= points[-1].time:
        p_last = points[-1]
        bearing = (
            calculate_bearing(points[-2].lat, points[-2].lon, p_last.lat, p_last.lon)
            if len(points) > 1
            else 0.0
        )
        return (p_last.lat, p_last.lon, bearing)

    # Linear interpolation between bracketing trackpoints
    for i in range(len(points) - 1):
        p1 = points[i]
        p2 = points[i + 1]
        if p1.time <= target_time <= p2.time:
            t1 = p1.time.timestamp()
            t2 = p2.time.timestamp()
            target_t = target_time.timestamp()
            alpha = (target_t - t1) / (t2 - t1) if t2 > t1 else 0.0
            alpha = max(0.0, min(1.0, alpha))
            lat = p1.lat + alpha * (p2.lat - p1.lat)
            lon = p1.lon + alpha * (p2.lon - p1.lon)
            bearing = calculate_bearing(p1.lat, p1.lon, p2.lat, p2.lon)
            return (lat, lon, bearing)

    return (points[-1].lat, points[-1].lon, 0.0)


def estimate_sign_coordinates(
    vehicle_lat: float,
    vehicle_lon: float,
    vehicle_bearing: float,
    box_xyxy: Sequence[float] | None = None,
    image_width: int = 1920,
    image_height: int = 1080,
    hfov_deg: float = 60.0,
    real_sign_height_m: float = 0.7,
) -> dict[str, Any]:
    """Estimate traffic sign physical coordinates and traffic direction.

    Uses camera pinhole projection heuristics to determine estimated distance,
    lateral camera offset angle, and spherical Earth Great-Circle projection.

    Returns:
        Dict with keys: vehicle_lat, vehicle_lon, sign_lat, sign_lon,
        estimated_distance, bearing_angle, traffic_direction, spatial_confidence,
        projection_method.
    """
    if box_xyxy and len(box_xyxy) == 4 and all(v is not None for v in box_xyxy):
        x1, y1, x2, y2 = box_xyxy
        box_h = max(1.0, float(y2 - y1))
        x_center = float(x1 + x2) / 2.0

        # Normalized horizontal offset from optical center in [-1.0, 1.0]
        w = max(1.0, float(image_width))
        norm_x = (x_center - (w / 2.0)) / (w / 2.0)
        norm_x = max(-1.0, min(1.0, norm_x))
        lateral_angle_deg = norm_x * (hfov_deg / 2.0)

        # Distance estimation: d = f_norm * real_height / norm_h
        norm_h = box_h / max(1.0, float(image_height))
        f_norm = 1.0 / (2.0 * math.tan(math.radians(hfov_deg / 2.0)))
        estimated_distance = (f_norm * real_sign_height_m) / max(0.01, norm_h)
        estimated_distance = max(3.0, min(50.0, estimated_distance))
    else:
        lateral_angle_deg = 0.0
        estimated_distance = 12.0

    # True bearing from vehicle to physical sign
    sign_bearing_deg = (vehicle_bearing + lateral_angle_deg + 360.0) % 360.0

    # Great-circle destination on spherical Earth
    earth_radius = 6_371_000.0  # meters
    delta = estimated_distance / earth_radius
    phi1 = math.radians(vehicle_lat)
    lambda1 = math.radians(vehicle_lon)
    theta = math.radians(sign_bearing_deg)

    sin_phi2 = math.sin(phi1) * math.cos(delta) + math.cos(phi1) * math.sin(delta) * math.cos(theta)
    sin_phi2 = max(-1.0, min(1.0, sin_phi2))
    phi2 = math.asin(sin_phi2)

    y = math.sin(theta) * math.sin(delta) * math.cos(phi1)
    x = math.cos(delta) - math.sin(phi1) * math.sin(phi2)
    delta_lambda = math.atan2(y, x)
    lambda2 = lambda1 + delta_lambda

    sign_lat = math.degrees(phi2)
    sign_lon = (math.degrees(lambda2) + 540.0) % 360.0 - 180.0

    spatial_confidence = "HIGH" if estimated_distance <= 20.0 else "LOW"

    return {
        "vehicle_lat": round(vehicle_lat, 7),
        "vehicle_lon": round(vehicle_lon, 7),
        "sign_lat": round(sign_lat, 7),
        "sign_lon": round(sign_lon, 7),
        "estimated_distance": round(estimated_distance, 2),
        "bearing_angle": round(vehicle_bearing, 2),
        "traffic_direction": round(vehicle_bearing, 2),
        "spatial_confidence": spatial_confidence,
        "projection_method": "spherical_trig",
    }
