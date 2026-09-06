import { registerAs } from '@nestjs/config';
import { durationMilliseconds } from './duration';

export default registerAs('geocoding', () => ({
  nominatim: {
    baseUrl: process.env.GEOCODING_NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
    timeoutMs: durationMilliseconds(process.env.GEOCODING_NOMINATIM_TIMEOUT, 5_000),
    userAgent:
      process.env.GEOCODING_NOMINATIM_USER_AGENT || 'SignTrustMap/0.1 (local development)',
    acceptLanguage: process.env.GEOCODING_NOMINATIM_ACCEPT_LANGUAGE || 'vi,en',
    cacheTtlMs: durationMilliseconds(process.env.GEOCODING_NOMINATIM_CACHE_TTL, 10 * 60_000),
    minimumRequestIntervalMs: durationMilliseconds(
      process.env.GEOCODING_NOMINATIM_MINIMUM_REQUEST_INTERVAL,
      1_000,
    ),
    maximumCacheEntries: Math.min(
      10_000,
      Math.max(
        1,
        parseInt(process.env.GEOCODING_NOMINATIM_MAXIMUM_CACHE_ENTRIES || '1000', 10) || 1_000,
      ),
    ),
  },
}));
