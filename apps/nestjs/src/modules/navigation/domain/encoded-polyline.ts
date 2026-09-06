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
