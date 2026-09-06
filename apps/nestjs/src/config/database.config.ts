import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  host: process.env.DB_HOST || 'postgres',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || process.env.DB_USERNAME || 'stm_user',
  password: process.env.POSTGRES_PASSWORD || process.env.DB_PASSWORD || 'stm_password',
  database: process.env.POSTGRES_DB || process.env.DB_DATABASE || 'signtrustmap',
}));
