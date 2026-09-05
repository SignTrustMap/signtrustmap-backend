import { registerAs } from '@nestjs/config';

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
