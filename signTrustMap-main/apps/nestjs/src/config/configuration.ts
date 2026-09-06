import { registerAs } from '@nestjs/config';

function durationMilliseconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i);
  if (!match) return fallback;

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
  };
  const milliseconds = Number(match[1]) * multipliers[(match[2] ?? 'ms').toLowerCase()];
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : fallback;
}

export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || process.env.DB_USERNAME || 'stm_user',
  password: process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || 'stm_password',
  database: process.env.POSTGRES_DB || process.env.DB_DATABASE || 'signtrustmap',
}));

export const jwtConfig = registerAs('jwt', () => ({
  secret: process.env.JWT_SECRET || 'dev_jwt_secret_change_me',
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleCallbackUrl:
    process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/v1/auth/google/callback',
}));

export const minioConfig = registerAs('minio', () => ({
  endpoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'stm_minio',
  secretKey: process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || 'stm_minio_secret_123',
}));

export const geocodingConfig = registerAs('geocoding', () => ({
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
      Math.max(1, parseInt(process.env.GEOCODING_NOMINATIM_MAXIMUM_CACHE_ENTRIES || '1000', 10) || 1_000),
    ),
  },
}));

export const routingConfig = registerAs('routing', () => ({
  provider: process.env.ROUTING_PROVIDER || 'OSRM',
  osrm: {
    baseUrl: process.env.ROUTING_OSRM_BASE_URL || 'https://router.project-osrm.org',
    profile: process.env.ROUTING_OSRM_PROFILE || 'driving',
    timeoutMs: durationMilliseconds(process.env.ROUTING_OSRM_TIMEOUT, 5_000),
  },
}));
