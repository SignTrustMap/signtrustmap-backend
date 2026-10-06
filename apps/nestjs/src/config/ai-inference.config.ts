import { registerAs } from '@nestjs/config';

export default registerAs('aiInference', () => ({
  baseUrl: process.env.AI_INFERENCE_URL || process.env.AI_SERVER_URL || 'https://ai.signmap.site',
  timeoutMs: parseInt(process.env.AI_INFERENCE_TIMEOUT_MS || '30000', 10),
  internalToken: process.env.INTERNAL_TOKEN || process.env.INTERNAL_API_TOKEN || 'stm_internal_secret_dev',
}));
