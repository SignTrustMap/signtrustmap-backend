import { registerAs } from '@nestjs/config';
import { durationMilliseconds } from './duration';

export default registerAs('routing', () => ({
  provider: process.env.ROUTING_PROVIDER || 'OSRM',
  osrm: {
    baseUrl: process.env.ROUTING_OSRM_BASE_URL || 'https://router.project-osrm.org',
    profile: process.env.ROUTING_OSRM_PROFILE || 'driving',
    timeoutMs: durationMilliseconds(process.env.ROUTING_OSRM_TIMEOUT, 5_000),
  },
}));
