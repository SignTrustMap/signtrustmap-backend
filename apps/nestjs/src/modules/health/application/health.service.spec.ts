import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const query = jest.fn();
  const service = new HealthService({ query } as unknown as DataSource);

  beforeEach(() => jest.resetAllMocks());

  it('returns liveness without querying the database', () => {
    expect(service.liveness()).toMatchObject({
      status: 'ok',
      service: 'stm-nestjs',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports ready after checking the database', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ready',
      checks: { database: 'up' },
    });
    expect(query).toHaveBeenCalledWith('SELECT 1');
  });

  it('returns 503 when the database check fails', async () => {
    query.mockRejectedValue(new Error('connection refused'));

    await expect(service.readiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
