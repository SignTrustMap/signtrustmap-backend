import { registerAs } from '@nestjs/config';

export default registerAs('catalogSync', () => ({
  fastapiBaseUrl: process.env.FASTAPI_BASE_URL || process.env.AI_SYNC_URL || 'http://localhost:8000',
  timeoutMs: parseInt(process.env.CATALOG_SYNC_TIMEOUT_MS || '10000', 10),
  internalToken: process.env.INTERNAL_TOKEN || '',
}));