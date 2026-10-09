import { RoutePointResponse } from './routing.types';

const POLYLINE_PRECISION = 100_000;

export function encodePolyline(points: RoutePointResponse[]): string {
  let previousLatitude = 0;
  let previousLongitude = 0;
  let encoded = '';

  for (const point of points) {
    const latitude = Math.round(point.latitude * POLYLINE_PRECISION);
    const longitude = Math.round(point.longitude * POLYLINE_PRECISION);
    encoded += encodeDelta(latitude - previousLatitude);
    encoded += encodeDelta(longitude - previousLongitude);
    previousLatitude = latitude;
    previousLongitude = longitude;
  }

  return encoded;
}

function encodeDelta(delta: number): string {
  let value = delta < 0 ? ~(delta << 1) : delta << 1;
  let encoded = '';
  while (value >= 0x20) {
    encoded += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
    value >>>= 5;
  }
  return encoded + String.fromCharCode(value + 63);
}

export function decodePolyline(encoded: string): RoutePointResponse[] {
  if (!encoded) return [];
  const points: RoutePointResponse[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push({
      latitude: lat / POLYLINE_PRECISION,
      longitude: lng / POLYLINE_PRECISION,
    });
  }

  return points;
}
