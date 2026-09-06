import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export interface HealthResponse {
  status: 'ok' | 'ready';
  service: string;
  version: string;
  timestamp: string;
  uptimeSeconds: number;
  checks?: { database: 'up' };
}

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) {}

  liveness(): HealthResponse {
    return this.response('ok');
  }

  async readiness(): Promise<HealthResponse> {
    try {
      await this.dataSource.query('SELECT 1');
      return {
        ...this.response('ready'),
        checks: { database: 'up' },
      };
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        service: 'stm-nestjs',
        timestamp: new Date().toISOString(),
        checks: { database: 'down' },
      });
    }
  }

  private response(status: 'ok' | 'ready'): HealthResponse {
    return {
      status,
      service: 'stm-nestjs',
      version: process.env.npm_package_version ?? '0.1.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
