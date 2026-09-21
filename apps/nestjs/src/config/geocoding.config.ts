import { registerAs } from '@nestjs/config';
import { durationMilliseconds } from './duration';

export default registerAs('geocoding', () => ({
  photon: {
    baseUrl: process.env.GEOCODING_PHOTON_BASE_URL || process.env.GEOCODING_BASE_URL || 'https://photon.komoot.io',
    timeoutMs: durationMilliseconds(process.env.GEOCODING_TIMEOUT, 5_000),
    userAgent:
      process.env.GEOCODING_USER_AGENT || 'SignTrustMap/0.1 (local development)',
    acceptLanguage: process.env.GEOCODING_ACCEPT_LANGUAGE || 'vi,en',
    cacheTtlMs: durationMilliseconds(process.env.GEOCODING_CACHE_TTL, 10 * 60_000),
    minimumRequestIntervalMs: durationMilliseconds(
      process.env.GEOCODING_MINIMUM_REQUEST_INTERVAL,
      100,
    ),
    maximumCacheEntries: Math.min(
      10_000,
      Math.max(
        1,
        parseInt(process.env.GEOCODING_MAXIMUM_CACHE_ENTRIES || '1000', 10) || 1_000,
      ),
    ),
  },
}));
