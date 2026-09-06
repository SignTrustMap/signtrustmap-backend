const EARTH_RADIUS_METERS = 6_371_000;

export function distanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const lat1 = radians(latitudeA);
  const lat2 = radians(latitudeB);
  const deltaLat = radians(latitudeB - latitudeA);
  const deltaLon = radians(longitudeB - longitudeA);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
