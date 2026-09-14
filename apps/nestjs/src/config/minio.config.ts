import { registerAs } from '@nestjs/config';

export default registerAs('minio', () => ({
  endpoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000', 10),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || 'stm_minio',
  secretKey:
    process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || 'stm_minio_secret_123',
  region: process.env.MINIO_REGION,
}));
