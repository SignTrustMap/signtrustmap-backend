import { registerAs } from '@nestjs/config';
import { durationMilliseconds } from './duration';

export default registerAs('routing', () => ({
  provider: process.env.ROUTING_PROVIDER || 'OSRM',
  osrm: {
    baseUrl: process.env.ROUTING_OSRM_BASE_URL || 'https://router.project-osrm.org',
    profile: process.env.ROUTING_OSRM_PROFILE || 'driving',
    motorcycleProfile: process.env.ROUTING_OSRM_MOTORCYCLE_PROFILE || 'motorcycle',
    timeoutMs: durationMilliseconds(process.env.ROUTING_OSRM_TIMEOUT, 5_000),
    motorcycleDurationFactor: numberInRange(
      process.env.ROUTING_OSRM_MOTORCYCLE_FACTOR,
      0.95,
      0.1,
      2.0,
    ),
  },
  routeSigns: {
    corridorWidthMeters: numberInRange(
      process.env.NAVIGATION_SIGN_CORRIDOR_WIDTH_METERS,
      30,
      1,
      200,
    ),
    headingToleranceDegrees: numberInRange(
      process.env.NAVIGATION_SIGN_HEADING_TOLERANCE_DEGREES,
      45,
      0,
      90,
    ),
  },
}));

function numberInRange(
  rawValue: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (rawValue == null || rawValue.trim() === '') return defaultValue;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < minimum || value > maximum) return defaultValue;
  return value;
}
